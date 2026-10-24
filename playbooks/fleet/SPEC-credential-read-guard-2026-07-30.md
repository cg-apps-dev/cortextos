# SPEC: credential-read guard (raw read -> transcript leak)

Owner: security-agent (spec + fixture). Implementer: a dev agent. Filed 2026-07-30.

## The recurrence this closes

A raw read of a credential-bearing file prints secret values into the agent's session
transcript, which is long-lived, greppable, and copied around for debugging. Confirmed
instances:

- 2026-07-27: orchestrator `jq` on `accounts.json` -> 7 creds into transcript (this is
  why `accounts-inspect.js` was built).
- 2026-07-28: me-com incident, same class.
- 2026-07-30: orchestrator `python -c` on `accounts.json` -> usage/refresh creds +
  cg-team/icloud access tokens; separately, config/.env reads put **8 agents' live
  BOT_TOKENs** and a `FUNCTION_HEALTH_PASSWORD` into transcripts.

**The safe reader exists but is OUT OF TREE and keeps not being reached for.** A tool that
must be *remembered* decays (the tier-3-vs-tier-4 lesson). **Corrected 2026-07-31:** the
reader (`accounts-inspect.js`, zero-bytes-emitted, `--drift` + credential-class) exists at
`~/cortextos-deliverables/guard-provenance/accounts-inspect.js` — a SIBLING of the repo,
outside it, so `git ls-files`/`git grep` cannot see it and it is absent on a fresh clone and
from the agent-state backup. It is real (verified, secret-free), but **it must be RELOCATED
INTO the repo before the guard can point at it** — a guard whose block message redirects to
a tool outside the repo redirects to nothing on any checkout but this one, which is worse
than no guard. The fix is to *position* the safe read as the only path — and to put it where
"the only path" resolves.

## The mechanism: a PreToolUse Bash guard

Use the fleet's existing enforcement surface (the same PreToolUse layer as the rtk hook
and the leak-shape send-guard). It runs BEFORE execution and blocks, so a leak is
prevented, not detected after the value is already in the transcript.

Scope note: this guards **agent Bash tool calls**, which is the actual leak vector. It
does NOT touch the daemon's internal TypeScript readers (`oauth.ts`, `usage-accounts.ts`,
etc.) — those are trusted code, not ad-hoc agent commands, and are not the vector.

### FAIL-CLOSED / ALLOWLIST, not a verb blocklist

**Corrected 2026-07-30 after claude-dev caught the original as a verb blocklist.** The first
draft listed value-capable verbs (`cat|jq|python -c|grep-without-lc|...`) and blocked them.
That is a BLACKLIST and it is unbounded-bypassable — verified live, every one of these emits
a credential value and is not a listed verb: `awk 1`, `sed -n p`, `cut -d= -f2`, `od -c`,
`base64`, `perl -ne print`, `nl/tac/rev/fold`, `grep -o` (a listed tool with an EMITTING
flag), and worst, the bash builtins with **no external verb at all**: `echo "$(<f)"`,
`x=$(<f)`, `cat < f`, `< f cat`, `read x < f`, `mapfile < f`. A guard green on the original
8 fixture rows passes ALL of these — the exact blacklist-passes-what-you-did-not-name defect
this same session established, written into the guard the same night it was named.

**The guard is ALLOWLIST / fail-closed:**

> BLOCK a command IF it **references a credential path** AND it is **not** wholly within the
> SAFE allowlist.

1. **Credential-path reference — in ANY position, not just as an argument:** as an argument,
   in a **redirect** (`< path`), or in a `$(<path)` / `<(...)` read. (The builtin/redirect
   forms are why a verb list fails: there is no reader verb to match.) Paths:
   `**/oauth/accounts.json`, `**/*.env` (except `*.env.example`), `**/secrets.env`,
   `**/multi-account-usage.json`, `**/.mcp.json`.
2. **SAFE allowlist — the only things allowed to touch a credential path:**
   - the sanctioned readers: `accounts-inspect.js`, `env-inspect` (below);
   - files-only / count greps: `grep -l|-c|-rIl|-rIc` (no value emitted);
   - non-reading metadata ops: `ls`, `stat`, `wc`, `file`, `test -f`, `[ -f`;
   - permission / move ops to a non-transcript destination: `chmod`, `chown`, `cp`/`mv`;
   - Write/Edit tool calls (this is a READ guard; those do not print to the transcript).

Anything else referencing a credential path — `awk`, `od`, `perl`, `$(<f)`, a redirect, and
every verb neither author enumerated — BLOCKS **by construction**, because it is not in the
small closed allowlist. The allowlist is short and auditable; the blocklist was infinite and
we were losing. Bounded-safe beats unbounded-bad.

### The block action

Do not silently fail. Print the redirect:
`BLOCKED: raw read of <path> would print secrets to your transcript. Use the safe reader:
node accounts-inspect.js [--drift]  (or: env-inspect <path>)  — emits fingerprints, never values.`

## The other half: the safe reader must cover every legitimate need

A guard is only followable if the sanctioned path does everything the raw read did.
Whoever bypasses does so because the safe tool lacked a capability. So:

- **STEP 0 (blocking prerequisite): relocate `accounts-inspect.js` into the repo.** It
  exists and is secret-free but lives at `~/cortextos-deliverables/guard-provenance/` outside
  the repo. Move it to an in-repo path (e.g. `scripts/security/accounts-inspect.js` or a
  `bus/` subcommand) so the guard's redirect resolves on every checkout. The guard CANNOT
  ship until its redirect target is in-repo.
- Then extend it with the incident capability used tonight: `--match-secrets` (fingerprint
  every known fleet secret against a target file/tree, emit fp+location only). That is the
  forensic need that would otherwise justify a raw `python -c`.
- Add `env-inspect` — the `.env` analogue: token class, length, fingerprint, multi-line /
  export-form / malformed-quote flags (the hygiene checks already in `token-drift-scan.py`),
  zero values emitted.
- NOTE `accounts-inspect.js` (safe READER, the guard target) and `token-drift-scan.py`
  (drift MONITOR — ORPHAN/attrib-drift, dedup, routing) OVERLAP on fingerprinting but are
  different jobs. Do NOT merge them; the guard redirects to the reader, not the monitor.

**Even security-agent uses the safe reader.** If a forensic need is missing, extend the
reader — never bypass. One sanctioned path, no exceptions, including for the auditor.

## Acceptance (the fixture security-agent supplies)

The original 8 rows are NECESSARY BUT NOT SUFFICIENT — a bypassable blocklist guard passes
them all. The bypass rows below are what give the fixture teeth against the fail-closed
requirement; a guard cannot go green without actually being an allowlist.

**Must BLOCK — obvious readers:**
1. `cat accounts.json`
2. `python3 -c "import json;print(json.load(open('...accounts.json')))"` (the exact
   2026-07-30 shape)
3. `jq . secrets.env`

**Must BLOCK — the bypass surface (verified live to emit values; a verb blocklist misses
all of these):**
4. `awk 1 .env` / `awk '{print}' .env`
5. `sed -n p secrets.env`
6. `cut -d= -f2 .env` (emits the value half directly)
7. `od -c accounts.json` / `base64 .env` / `xxd .env`
8. `perl -ne 'print' .env`
9. `grep -o . .env` (listed tool, EMITTING flag)
10. `echo "$(<.env)"` and `x=$(<.env); echo "$x"` (no external verb)
11. `cat < .env` and `< .env cat` (path in redirect position)
12. `read x < .env; echo $x`

**Must ALLOW — the allowlist, pinned against over-firing (an over-firing guard gets
disabled — the --no-verify lesson):**
13. `grep -l TOKEN */.env` (files-only)
14. `node accounts-inspect.js --drift` (sanctioned reader)
15. `ls -la .env` / `stat .env` / `wc -l .env` / `file .env` (metadata, no value)
16. `chmod 600 .env` (permission op)
17. `cat README.md` (not a credential path)

**Must BLOCK — COMPOUND commands (claude-dev, 2026-07-30): one safe segment does NOT clear a
reading segment. The unit of evaluation is the segment, and any segment that reads a cred
value blocks the whole command.**
18. `grep -l X *.env && cat $(grep -l X *.env)` (safe segment THEN a reading segment — the
    canonical bypass: lead with an allowlisted op to look clean)
19. `ls .env && cat .env` (allowlisted op `;`/`&&` a reader)
20. `cat .env | grep TOKEN` (reader piped onward — the read already happened)
21. `grep -c X .env ; cat .env` (safe `;` reader)

**Must ALLOW — compound where EVERY segment is safe (pins that compound handling does not
over-fire into blocking legitimate chains):**
22. `ls .env && wc -l .env` (both allowlisted)

**Teeth both ways:** an always-block guard fails 13-17 and 22; an always-allow guard fails
1-12 and 18-21. The suite rejects both. **Rows 4-12 (bypass verbs/builtins) and 18-21
(compound) are the real gate** — a blocklist implementation passes them; only a fail-closed,
per-segment allowlist catches them. Resolution rule the implementation must satisfy: *any
credential-path reference not provably inside the safe allowlist blocks*, evaluated per
segment across `|`, `;`, `&&`, `||`, and command substitution.

### Adversarial additions (claude-dev build round, moved into the shared contract)

These came out of the implementer's own adversarial pass and are promoted into the fixture
so the knowledge lives in the contract, not one build. All emit-verified live by
security-agent before adoption (a mislabeled MUST-ALLOW trains under-blocking — the
dangerous direction — so the allows were checked, not assumed).

**Must BLOCK:**
23. shell wrappers: `bash -c "cat .env"`, `sh -c "cat .env"`, `eval "cat .env"`
24. more emitters (the blocklist would never end): `sort|diff|tail|comm|dd|nl|tac|rev|
    strings|hexdump|paste|column .env`, `vim -es .env`
25. backtick substitution: `` cat `grep -l X *.env` ``
26. process substitution: `cat <(cat .env)`
27. quoted path: `cat ".env"` / `cat '.env'`
28. **variable indirection — the hardest, needs assignment tracking or fail-closed on
    var-args:** `f=.env; cat $f` and `X=.env cat $X`. A static literal-path matcher misses
    these because `.env` is not a literal on the reading segment. The implementation must
    either track intra-command assignments or fail-closed on a reader whose argument is a
    variable that cannot be proven non-credential. **This is the one row whose MECHANISM
    (not just its pass/fail) the build should confirm** — verified live that all forms emit.

**Must ALLOW (pin against over-fire / substring over-match):**
29. `cat README.md && ls .env` — per-segment correctness: `cat` reads a NON-cred file, `ls`
    on `.env` is metadata. Neither reads a cred value. This is the row that separates
    per-segment-correct from the lazy "block any compound touching .env".
30. `cat environment.json` / `cat env.sample` — substring safety: `environment.json`
    contains "env" and `env.sample` is a template; neither is `*.env`. The path matcher must
    not substring-match.
31. `grep -lc TOKEN .env` (files+count) / `stat -f %m .env` (metadata) — allowlisted.

### Row 28 mechanism, confirmed (claude-dev) + its exact boundary

The build blocks `f=.env; cat $f` on the ASSIGNMENT segment (`f=.env`) because `.env` is a
LITERAL in a segment whose verb (after stripping `\w+=`) is empty and thus not allowlisted.
The variable NAME is irrelevant — it fires on the literal path, so any name blocks
identically. **Closed by construction for: the credential path appears as a LITERAL anywhere
in the command, in a non-provably-safe segment.**

**Named residual (out of scope by construction, tied to the §Residual static-guard limit):**
the path never appears as a literal — `f=$(cat pathfile); cat $f`, `f=$(ls|grep env); cat $f`
— where the path only exists at runtime. A static, pre-execution guard has no literal to
match and ALLOWS. This is NOT closable in this guard (it would need runtime output
inspection, a different surface). The fixture must NOT imply coverage of it. Recorded as a
KNOWN-UNCATCHABLE row, not a MUST-BLOCK the guard fails.

### Over-fire boundary: env-prefixed program invocation (security-agent, verify the incidence)

The row-28 mechanism (fire on a literal cred-path in a non-safe segment) also fires on
`ENV_FILE=.env node app.js` — a single segment: an env-assignment prefix to `node app.js`.
But `node <scriptfile>` is a CONSUMER (reads its own config internally), not a printer that
dumps the file to the transcript. So this is an OVER-FIRE by the fail-closed rule.

Resolution — **accept and document, do NOT add var/consumer-tracking** (that complexity is
a hole surface):
- Incidence is near-zero: agents env-prefix NON-credential config paths (`KB_CONFIG=...`,
  `CODEX_AUTH_*=...`, `NOW=$now`), which never trigger; passing an actual credential path
  (`accounts.json`/`.env`/`secrets.env`) to a program is rare and scrutiny-worthy anyway.
- So `VAR=<cred-path> program` BLOCKS by design, and that is acceptable — provided the block
  MESSAGE routes to the safe reader so the agent has a path forward.
- The distinction the guard CANNOT and should not try to draw statically: printer (`cat`,
  `-c`/`-e` inline) vs consumer (`node app.js`). Fail-closed treats both as block; the
  consumer case is a rare, tolerable false-positive, not a followability-killer.

Fixture rows:
32. `ENV_FILE=.env node app.js` -> BLOCK (fail-closed over-fire, accepted-by-design; the
    block message must route to the safe reader).
33. `KB_CONFIG=./config.json node app.js` -> ALLOW (config.json is NOT a credential path —
    pins that the over-fire is scoped to credential paths only, not all env-prefixes).
34. `cat config.json` and `cat .../oauth/config.json` -> ALLOW. **config.json is NOT a
    credential path — verified 2026-07-31:** `oauth/config.json` does not exist (oauth/ holds
    `accounts.json` + `setup-tokens`); no config.json anywhere holds a secret value; the agent
    `config.json` is crons / max_session_seconds (read routinely, secret-free per CLAUDE.md).
    **An earlier draft of this spec listed "agent config.json under oauth/" — that was a
    phantom path (removed).** The guard must NOT match config.json, or it over-fires on
    routine agent config reads. (The one config.json whose SCHEMA can hold a secret is
    `knowledge-base/config.json`'s optional `gemini_api_key` fallback — currently empty; the
    real Gemini key lives in `secrets.env`, already covered. Not worth a config.json matcher.)

### Implementation note that the fixture forces but should be on record (claude-dev)

The segment splitter must **NOT** split on command-substitution boundaries (`$( )`, `<( )`,
backtick). Splitting `cat $(grep -l X *.env)` on `$()` yields an outer `cat` with no visible
path plus an inner safe `grep -l` — and bypasses. Keep the substitution INSIDE its segment
so the outer reader is judged together with the path in the sub. Split on `| ; && || & \n`
only. Row 18 fails any split-on-`$()` build, so the fixture already enforces this; the "how"
is recorded here so it is in the contract, not only in the implementer's head.

## Residual, stated not hidden

- Pre-execution, the guard judges the COMMAND, not the OUTPUT. It cannot distinguish a
  `python -c` that prints a fingerprint from one that prints the value. Resolution:
  block value-capable reads regardless, and route ALL inspection (including forensic
  fingerprinting) through the extended safe reader. The guard is a path-router, not an
  output-classifier.
- It guards Bash. A future non-Bash leak vector (an MCP tool that reads a cred file and
  returns it) is a different surface and a different guard. Named so nobody reads this as
  "all credential reads are guarded."
