# SPEC — pre-push gitleaks: scope scan to the push range, not all refs

- **Task:** task_1790500514074_79973066 `[DEV][sec]`
- **Author:** claude-dev-agent (plan) — 2026-10-09
- **Status:** DRAFT → routed to codex-dev-agent for argue-back (IDENTITY debate protocol, cap 3 rounds)
- **Class:** security control refinement. Fail-open is the catastrophic failure mode here; every change below is subordinate to the invariant.

## Problem (mechanism verified at the artifact)

`scripts/hooks/pre-push` runs:

```sh
gl_out="$(gitleaks git . -c "$cfg" --redact --no-banner 2>&1)" || gl_rc=$?
```

`gitleaks git .` scans the **entire reachable commit graph of the local repo**, not the
commits being pushed. During the daily-backup step-1 code push (`git push backup main`) this
pulls in **agent-state history** reachable in the local object store and FPs on synthetic
agent-tool fixtures — e.g. `security-agent/tools/token-drift-scan.py` planted `token_fp`
(`zz…/len108/shaZZ`) on commit `904a8e52`. Proof it is the all-refs scan and not `main`
history: the offending file is ABSENT from `main` but present in the scanned graph.
(Origin: security-agent FP msg 1790500249084; sibling task_1790435463389.)

Net: a false secret alarm on every backup push → standing invitation to `--no-verify`, which
defeats the only control blocking an unpushed leak.

## Invariant (the thing the fix must NOT break)

**Every commit that this push would publish to the remote is scanned for secrets before the
push proceeds.** Narrowing *what* is scanned is only acceptable if it still scans the full set
of newly-published commits. A narrowing that can skip a to-be-pushed commit is a fail-OPEN and
is strictly worse than today's noisy-but-safe behavior.

## CONVERGED CONTRACT (round 2 — codex-dev + claude-dev, supersedes the draft Fix below)

Codex round-1 verified the pin (gitleaks **8.30.1**, `gitleaks git [repo] --log-opts string` →
`git -C . log -p -U0 <tokens>`) and found three fail-open holes in the draft. All accepted, plus
one claude-dev hardening on the error-propagation point. Agreed contract:

- **Update branch** (remote_sha nonzero, local_sha nonzero): scan validated `remote_commit..local_commit`.
- **New branch** (remote_sha == zeros): scan the **full ancestry of local_sha** (`--log-opts=<local_commit>`).
  **Reject `--not --remotes`** — `--remotes` subtracts every local remote-tracking namespace (incl `fork/*`),
  which can subtract a commit new to *this* destination remote → fail-open. Over-scanning the lineage is
  safe (it still omits unrelated agent-state refs); under-scanning is not.
- **Delete** (local_sha == zeros): no scan (the ONLY computed-empty no-op).
- **Multiple refs:** parse+validate ALL stdin lines first, then **one guarded gitleaks invocation per ref
  range**, early-exit on first block. Do NOT concatenate ranges into one `--log-opts`: git evaluates
  `A..B C..D` as `(reach(B)∪reach(D)) − (reach(A)∪reach(C))`, so a negative boundary from one ref erases a
  commit another ref needs (measured: two 1-commit ranges combined report 1 scanned, not 2). → answers Q3.
- **Range/endpoint validation BEFORE scanning:** validate each nonzero OID as commit-ish
  (`git rev-parse --verify "$sha^{commit}"`) and validate each range with git. Any failure → full-scan fallback.
- **Non-raising-failure guard (point 4 + claude-dev hardening):** gitleaks 8.30.1 is **fail-open on an
  invalid log range** — `unknownOID..HEAD` prints `fatal: Invalid revision range`, `ERR`, `0 commits scanned`,
  `no leaks found`, but **exits 0**. The `gl_rc != 0` guard does NOT catch this. Defenses, in order:
  1. Pre-validation (above) prevents handing gitleaks a range git itself rejects.
  2. **~~Affirmative count cross-check~~ — DROPPED (measured false-block).** claude-dev proposed
     `rev-list --count > 0 ⇒ gitleaks scanned > 0`. Codex measured on 8.30.1: a validated non-empty range
     made of **empty commit `9150c8f2`** or **deletion-only `46c3e1ee`** (0 additions, 86 deletions),
     `rev-list --count = 1`, reports **`0 commits scanned` / rc0** (gitleaks counts commits-with-additions,
     per its own note). So the gate would permanently block legitimate empty/deletion-only pushes and train
     `--no-verify`. The count line is parseable but is **not a valid success invariant.** Dropped.
  3. **Error-level-output guard (codex measured replacement for the count-check):** invoke every scan with
     pinned supported flags **`--log-level error --no-color`** and capture with the guarded assignment.
     Measured: healthy empty AND deletion-only ranges → **rc0 + EMPTY** output; invalid range → **rc0 +
     NONEMPTY** error-level output (`ERR [git] fatal: Invalid revision range`, `ERR error=stderr is not
     empty`). **Contract (rc0 branch, after pre-validation): nonempty error-level output = FAILED TO RUN /
     block; empty = clean.** This matches on "any output survived the CLI error-level filter," NOT on
     version-specific `ERR` text → version-independent and fail-closed. `--no-color` is required so ANSI
     codes cannot make clean output read as nonempty.
  4. `rc != 0` keeps the existing FAILED-TO-RUN (`unable to load|failed to open|no such file`) vs
     FOUND-A-SECRET classification unchanged. Keep the guarded `… || gl_rc=$?` form on every invocation.
     Endpoint/range pre-validation remains the PRIMARY defense for point 4.
- **Input hardening:** exactly 4 fields per nonblank stdin line; OIDs all-hex at the **repo object-format
  width** (do NOT hardcode SHA-1 — SHA-256 repos); all nonzero optimized OIDs locally resolvable as commits;
  parse all lines before any scan. Empty stdin / malformed / wrong-width / unresolved / unsupported target ref
  → one current full scan. **Optimize only `remote_ref` = `refs/heads/*`**; tags/other refs → full-scan
  fallback in v1.
- **Fallback = honest whole-graph scan, NO path exclusion / agent-state allowlist** (Q2: confirmed no).
  Fallback means uncertainty; excluding paths there could mask a real credential.
- **Keep secret-scan range selection independent of the shape-scan refs** — do NOT inherit the shape
  scanner's intentional agent-state exclusion into gitleaks range selection (two controls, independent).

### Added biting regressions (on top of the 6 below)

7. **Cross-remote new-branch:** secret commit reachable from another remote-tracking ref but new to this
   destination → still BLOCKS (guards the rejected `--not --remotes`).
8. **Combined-range under-scan control:** two adjacent 1-commit ranges must scan 2 commits, not 1
   (guards multi-ref concatenation).
9. **Invalid-range rc0 fail-open (revised):** stub/force an invalid range that yields **rc0 + nonempty
   error-level output** → FAILED TO RUN / block (guards the measured rc0 fail-open via the error-output
   guard, NOT the dropped count gate).
10. **Healthy control — empty commit:** range over an empty commit (e.g. `9150c8f2`, rev-list --count=1,
    gitleaks 0 scanned, rc0, EMPTY error-level output) → **clean, push allowed** (proves the error-output
    guard does not false-block).
11. **Healthy control — deletion-only commit:** range over a deletion-only commit (e.g. `46c3e1ee`, 0
    additions / 86 deletions, rev-list --count=1, gitleaks 0 scanned, rc0, EMPTY output) → **clean, push
    allowed.** Assert output is EXACTLY empty so a future version emitting an info line at error-level is
    caught.

Ownership: codex-dev-agent implements the converged contract on a branch; claude-dev reviews every line
(raw reads, security-sensitive). Then PR via the-orchestrator → Adam. No merge/push without Adam.

---

## Fix (DRAFT — superseded by the converged contract above; kept for debate history)

Use the pre-push stdin contract to compute the exact set of commits being published and pass it
to gitleaks via `--log-opts`, instead of scanning `.` wholesale.

Git delivers one line per ref on **stdin**:

```
<local_ref> <local_sha> <remote_ref> <remote_sha>
```

Per line, scan range:

| Case | Detect | Scan |
|---|---|---|
| Update existing remote branch | `remote_sha` != zeros, `local_sha` != zeros | `--log-opts="<remote_sha>..<local_sha>"` |
| New branch (remote has nothing) | `remote_sha` == `0000…` | commits reachable from `local_sha` not already on any remote: `--log-opts="<local_sha> --not --remotes"` |
| Branch delete | `local_sha` == `0000…` | nothing to publish → skip this ref |
| Force / non-ff where `remote_sha` not present locally | `git cat-file -e <remote_sha>` fails | fall back (see below) |

Scan the **union** across all stdin ref lines (loop; a single push can carry multiple refs).

### Fail-safe fallback (non-negotiable)

If stdin is empty, unparseable, or any range cannot be resolved locally (unknown `remote_sha`,
`cat-file` miss, zero lines read), the hook MUST fall back to the **current full
`gitleaks git .` scan** — never skip. Fallback = conservative (noisy, safe), never permissive.
A computed-empty range is only honored when it was computed from a *successfully parsed* delete
line; "I couldn't tell" always means full scan.

### Preserve existing behavior verbatim

- Config-missing → BLOCK (already there).
- `gl_rc != 0` → BLOCK, with the FAILED-TO-RUN vs FOUND-A-SECRET distinction intact.
- `|| gl_rc=$?` command-substitution guard (set -e trap, fixed 2026-07-28) — keep the exact pattern on every gitleaks invocation added here.
- leak-shape-scan.sh capability assertion block stays unchanged and still runs.

## Tests (must bite; prove the invariant both ways)

1. **Blocks a real secret in the push range** — commit a planted fake secret on a branch, set remote_sha to the prior tip, assert hook exit 1. (invariant positive)
2. **Ignores an out-of-range fixture** — an agent-state-style fixture reachable in the object graph but NOT in `remote..local` must NOT trigger. (the FP this fixes)
3. **New-branch case scans all new commits** — remote_sha=zeros, a planted secret in one of the new commits still BLOCKS. (fail-open guard on the new-branch path)
4. **Delete is a no-op** — local_sha=zeros → skip, exit 0, no scan.
5. **Fallback on unresolved range** — unknown remote_sha (cat-file miss) → full scan runs (prove it still blocks a planted secret, i.e. did NOT skip).
6. **Multi-ref push** — two ref lines, secret in the second range → BLOCK.

Test harness: a scratch repo + a stub `gitleaks` on PATH that asserts the `--log-opts` it
received (so we test the range computation, not gitleaks itself), plus one real-gitleaks
end-to-end on a planted secret for cases 1 and 5.

## Risk register

- **Fail-open via wrong range** → mitigated by tests 1/3/5/6 + the mandatory full-scan fallback.
- **`--not --remotes` over-includes** (scans commits already pushed elsewhere) → acceptable: over-scan is safe, only under-scan is dangerous. May re-introduce a benign FP if a backup ref holds a fixture; if observed, narrow to `--not --remotes=origin backup` by name. Note, do not pre-optimize.
- **Hook receives no stdin when invoked manually** (not via git push) → fallback full scan. Keep the current manual-invocation path working.

## Open questions for codex argue-back

1. Is `--log-opts` the right gitleaks surface across our pinned gitleaks version, or should we use `gitleaks git <range>` differently? Verify the installed version's flag semantics before implementing.
2. Should the fallback full-scan ALSO exclude agent-state by path (`.gitleaksignore` / config allowlist) so the backup push is clean even on fallback — or does that risk masking a real secret in agent state? (Leaning: no path exclusion; fix the range, keep fallback honest.)
3. Multi-ref union vs per-ref early-exit on first block — cosmetic, but decide.

## Ship flow

branch → implement → `npx tsc --noEmit` (n/a, shell) + shellcheck + the 6 tests → PR → the-orchestrator routes to Adam. No merge/push without Adam sign-off. Security-sensitive: full review, raw reads.
