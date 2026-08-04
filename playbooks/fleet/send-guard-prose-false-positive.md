# Runbook: send-guard prose false-positive fix (+ all-tokens inspection)

**Status: LIVE on `main`, verified in `dist`.** Two commits, both on `main` and compiled into the
running hook artifact:

- `f9170fe1` — *send-guard now inspects all tokens, not just the first* (2026-08-02)
- `4039d794` — *Fix send guard prose command detection* (2026-08-02)

Verified live (the-sop-keeper, 2026-08-04): both commits are ancestors of `main`; `dist/hooks/hook-send-guard.js`
was rebuilt 2026-08-03 19:50 (after the commits) and contains all four fix signatures
(`isCommandPosition`, `extractGuardedBodyArgs`, `tokenList`, `isBareDoubleQuotedVariableReference`).
The send-guard is a hook that loads from `dist` **per-invocation**, so a `dist` rebuild is the whole
deploy — **no daemon bounce is required** and none was performed. This is a genuine live behavior, not
a built-not-running one.

---

## What the send-guard is

`src/hooks/hook-send-guard.ts` is the pre-execution hook that blocks `cortextos bus` commands whose
guarded body argument contains unquoted shell-expansion syntax — the `$(...)`/bare-`$VAR`/backtick
hazard that silently corrupts message bodies and task results (see `shell-expansion-safety.md` for the
doctrine and the lived examples). It is the mechanised backstop behind the "compose bus bodies with a
quoted heredoc" rule.

## The two defects it fixed

### 1. First-token-only inspection (`f9170fe1`)

The guard extracted a **single** body argument and checked only that one token for expansion syntax.
A guarded body assembled from multiple tokens (e.g. a `--desc`/`--result`/`--meta` value, or a
positional body) could carry the hazard in any token past the first and slip through.

The fix renamed `extractGuardedBodyArg` → **`extractGuardedBodyArgs`** (plural), routed every guarded
body slot through a new **`tokenList(...)`** helper, and made the guard iterate
`for (const bodyArg of busSend.bodyArgs)` — so **every** token in the guarded position is inspected,
not just the first.

### 2. Prose false-positive (`4039d794`)

`findGuardedCommandStart` decided whether a `cortextos bus …` occurrence was a real command by a naive
test: skip the match only if the preceding char was alphanumeric —
`if (i > 0 && /[A-Za-z0-9_-]/.test(command[i - 1])) continue;`. That meant a `cortextos bus send-message …`
appearing **inside prose or an argument value** — e.g. a message body that *describes* the command, or
documentation quoting it — was mistaken for a command in command position and **falsely DENIED**. This
is the exact failure mode that makes a guard untrustworthy: it blocks legitimate sends whose text merely
mentions the guarded command.

The fix replaced that test with a real command-position check:

```ts
function isCommandPosition(command: string, index: number): boolean {
  let j = index - 1;
  while (j >= 0 && /[ \t\r]/.test(command[j])) j--;   // skip inline whitespace
  if (j < 0) return true;                              // start of string
  const ch = command[j];
  if (ch === '\n' || ch === ';' || ch === '|' || ch === '&' || ch === '(') return true;
  if (ch === '!') return true;
  if (ch === '`') return j === index - 1;
  return ch === '(' && j > 0 && command[j - 1] === '$'; // $( ... )
}
```

A `cortextos …` is treated as a command only when what precedes it (after skipping spaces/tabs/CR) is a
genuine command-position delimiter: start-of-string, newline, `;`, `|`, `&`, `(`, `!`, an immediately
preceding backtick, or `$(`. Anything else — a letter, a quote, mid-sentence prose — is argument/prose
context and is left alone.

**The two fixes are complementary:** prose that merely mentions the command no longer trips the guard
(fewer false positives), while a command that *is* in command position gets **all** of its body tokens
checked (no false negatives). Loosening either half re-opens one class.

## Tests

`tests/unit/hooks/send-guard.test.ts` — 33 `it(` cases. The two that pin this fix:

- `allows prose or arguments that mention a guarded send with expansion-looking text` — the false-positive guard.
- `still denies the same body text when the send is in command position` — proves the fix narrowed, not gutted, detection.

Run: `npx vitest run tests/unit/hooks/send-guard.test.ts`.

## How to verify it is live (repeat before trusting)

```bash
# 1. Both commits on main
for c in f9170fe1 4039d794; do git merge-base --is-ancestor $c main && echo "$c on main"; done
# 2. Signatures compiled into the running dist artifact
for fn in isCommandPosition extractGuardedBodyArgs tokenList isBareDoubleQuotedVariableReference; do
  grep -c "$fn" dist/hooks/hook-send-guard.js; done
# 3. dist newer than the last source edit
stat -f '%Sm' dist/hooks/hook-send-guard.js src/hooks/hook-send-guard.ts
```

Because the hook loads from `dist` per-invocation, step 2 (signatures present in `dist`) is the
authoritative "is it live" check — not the commit date, not a summary. If `dist` is ever rebuilt from a
branch that lacks these commits, the guard silently reverts; re-run step 2 after any `dist` rebuild.

## Pass-case behavior is load-bearing (and an open RTK interaction)

**Verified from source (the-sop-keeper, 2026-08-04; derivation credit: claude-dev-agent).** The guard
returns `permissionDecision: 'allow'` on **every** non-hazard path — non-bus commands (l.419), non-guarded
sends (l.423), the clean pass (l.442), and the not-confidently-inspectable fallbacks (l.449/459) — and
`deny` only on the three hazard branches. A PreToolUse `allow` **short-circuits the permission prompt**, so
this pass-case allow is not incidental: it auto-authorizes bus commands and removes permission friction.
**Any change that makes the guard "go silent" (return no decision) on the pass case would fall back to the
normal permission flow and reintroduce prompts.** Treat the auto-allow as a feature, not noise.

**Open interaction — HYPOTHESIS, not proven — tracked in `task_1785812468129`.** A separate investigation
into why the sibling `rtk` PreToolUse hook (same Bash-matcher entry) does not engage has a well-evidenced
*but unconfirmed* leading hypothesis: because multiple hooks in one matcher run in parallel, this guard's
blanket `permissionDecision:'allow'` may authorize the *original* command and suppress `rtk`'s
`hookSpecificOutput.updatedInput` rewrite. **Claude Code's precedence for a parallel `allow` vs a sibling's
`updatedInput` is undocumented**, so this is not established. **Do NOT edit the live send-guard on inference**
— a controlled confirmation test (single-hook / non-allowing-guard session + bare-injection probe) is
required first; the guard is a live safety belt.

**Fix-design caveat for whoever eventually acts on `task_1785812468129`:** the fix cannot be a naive "stop
allowing / go silent on pass." It must do **both** — free a sibling hook's rewrite **and** preserve this
guard's auto-allow (prompt suppression). Dropping the allow to free the rewrite trades one regression
(reintroduced permission prompts) for the fix. (The RTK-side findings live in claude-dev-agent's agent-local
notes; they are under the `orgs/**` gitignore, so this tracked runbook intentionally links the durable bus
**task handle** rather than that path — a fresh clone would dangle on the file path.)

## Regression signals

- **False positives return** (legitimate sends blocked whose body only *mentions* a guarded command) →
  `isCommandPosition` was weakened or bypassed. Check the delimiter set above is intact.
- **Permission prompts return for bus commands** → the pass-case `permissionDecision:'allow'` was removed or
  made conditional. That allow is load-bearing (see the section above); restore it.
- **False negatives return** (a corrupting body slips through) → the all-tokens loop
  (`for (const bodyArg of busSend.bodyArgs)` / `tokenList`) regressed to single-token extraction.
- Either way the two prose tests above should fail first — keep them green.

## Rollback

Revert `4039d794` and/or `f9170fe1`, rebuild `dist`. Reverting only the prose fix restores the
false-positive class; reverting only the all-tokens fix restores the first-token blind spot. Prefer
fixing forward — the guard is a live safety mechanism the whole fleet relies on for bus-body integrity.

---

*Provenance: fix by Adam Folker / claude-dev lane (`f9170fe1`, `4039d794`). Runbook captured by
the-sop-keeper 2026-08-04 per GOALS goal 1, after verifying the fix is genuinely live in `dist` (deploy-beat
discipline). Related: `shell-expansion-safety.md` (doctrine + lived examples), `standing-rules.md`
(compose-bus-bodies-with-a-quoted-heredoc rule this hook enforces).*
