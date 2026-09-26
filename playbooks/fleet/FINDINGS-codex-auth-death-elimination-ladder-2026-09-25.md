# Fleet findings: the codex auth-death elimination ladder (2026-09-25)

How a credential-death incident was diagnosed by eliminating four wrong hypotheses in sequence
without a single destructive action, and the four verification lessons that came out of it. The
headline: **a "restart recovers it" claim is only as good as the layers the restart scoped** -
process memory, disk config, session-resume state, and the account side are four different layers,
and each needs its own elimination. Read this before diagnosing any credential/auth failure or
asserting that a restart fixed one.

Ratified 2026-09-26 PT (the-sop-keeper, from the 2026-09-25 codex-dev auth-death incident;
primary record: the-orchestrator MEMORY.md, final corrected synthesis; mechanism verdicts +
instruments: claude-dev-agent, tasks `task_1790378070848` + `task_1790384451072`; timeline:
the-orchestrator 09-25 daily incident notes). The generalizable rules distilled here also live as
short entries in [standing-rules.md](standing-rules.md) (see [Where the rules live](#where-the-generalizable-rules-live) below); this doc holds the forensic origin the standing-rules entries cite.

## The incident in one paragraph

codex-dev-agent went inference-dead at ~23:07Z on a `401 "Incorrect API key: sk-svcac...fvMA"`
against `chatgpt.com/backend-api/codex` (alert 23:11Z, verified real 23:15Z; it had been inferring
fine at 22:41Z). Four hypotheses were raised and each died to evidence, one layer deeper than the
last, before any irreversible action was taken. The true cause was **layer 5 - the OpenAI-side
service-account object, revoked account-side ~23:07Z, fixable only by the operator**: Adam re-authed
codex SILENTLY at 23:41Z (`~/.codex/auth.json` rewritten), landing DURING diagnosis, 12 minutes
before the account-side verdict was even reached. Earned green at 00:04Z (live round-trip
`137x6=822` + an accurate `redact.ts` description, single fresh app-server `48550`, brand-new thread
`01a0daec`, zero `sk-svcac` 401s). Then at 00:57Z an INTERMITTENT 401 recurred - traced to
app-server `48550`, which had booted 23:35Z (before the 23:41Z re-auth) and retained a residual
stale-cred path; cured by one post-re-auth respawn to app-server `7259` (01:02Z), verified over a
~11-minute zero-401 watch window plus a round-trip (`44x25=1100`). Corrected durations (clock
arithmetic on read timestamps, never felt-elapsed): 34 min outage-to-fix (23:07->23:41Z), ~57 min to
verified green (00:04Z). Zero destructive moves on any of the four wrong theories.

## The elimination ladder (what died, and to which instrument)

| # | Layer | Hypothesis | Verdict | Instrument that killed it |
|---|-------|-----------|---------|---------------------------|
| 1 | Process env | Env-var override injecting a bad key | RULED OUT | positive-controlled `ps` env read on BOTH app-server pids (`control=1`, `OPENAI_API_KEY=0`) |
| 2 | Process memory | Stale baked cred in a running app-server | "disproven", then CONFIRMED | a fresh app-server presented the same dead key - but the test was **confounded** (see lesson 1); later confirmed TRUE for its layer by a post-re-auth respawn |
| 3 | Session-resume | Poisoned resumed thread (`019ebe36`, a 2026-06-12 rollout jsonl codex resumes every start) | disproven | a brand-new thread `01a0daec` 401'd identically - though codex session rollout `.jsonl` files ARE a resume layer worth scoping |
| 4 | Token issuance | The chatgpt refresh flow issuing the dead key | disproven | `auth.json` `access_token` was a healthy JWT (`eyJhbGciO...`), not `sk-svcac`-shaped |
| 5 | Account | The OpenAI-side service-account object itself, revoked | TRUE CAUSE | chatgpt login alive + refreshing; codex presents a codex-scoped service-account key revoked OpenAI-side ~23:07Z; fix = operator only |

**Two-layer truth:** the account fix (layer 5) cures the CAUSE, but any process that BOOTED against
the broken account (layer 2) stays poisoned until respawned. The fix and its propagation are
separate steps, each needing its own verification - which is exactly why the incident reopened
intermittently after it was first called closed.

## The four diagnosis lessons

### 1. Elimination-ladder confound rule: a disproof is only as good as the variables it isolates

When two candidate causes are BOTH active at test time, a test that fails under EITHER of them
disproves NEITHER. Hypothesis 2 (stale in-memory cred) was recorded as "disproven" because a fresh
app-server presented the same dead key - but every test spawn (23:24Z, 23:35Z) predated the account
fix (23:41Z), so while the account was still broken the failure could not separate
in-memory-stale from account-broken. The post-re-auth respawn was the FIRST un-confounded test of
hypothesis 2, and it CONFIRMED it (that spawn was the recurrence cause). **Rule: before recording a
disproof, name the single variable the test isolates and confirm no OTHER active cause could
produce the same failure; if two causes are co-active, neutralize one before testing the other, or
the disproof is worthless.** (General form of the same trap that VT-4 names for fixtures - a test
that can pass/fail for the wrong reason proves nothing about the reason you care about.)

### 2. Intermittent-fault watch-window verify: one green cannot clear an intermittent fault

A single successful round-trip is a classic UNEARNED green for an intermittent fault - the fault is
intermittent precisely because healthy turns interleave with failing ones. Recovery from the
recurrence was earned only over a ~11-minute window with NO new 401 PLUS a round-trip
(`44x25=1100`) and multiple clean completed turns - not the first clean turn. **Rule: to verify an
intermittent fault fixed, require zero recurrence over a watch window that provably exceeds the
fault's observed recurrence interval, plus an active round-trip - never a single success.** (Same
"earned green" family as the fleet's unearned-green rules; the window is what makes the green
earned.)

### 3. Fix vs fix-propagation are two layers, each verified separately

Curing a root cause does not heal state that was instantiated against the broken cause. The account
re-auth cured layer 5, but app-server `48550` (booted 23:35Z, pre-re-auth) held a residual
stale-cred path and intermittently re-presented the dead key until it was respawned to `7259`.
**Rule: after a root-cause fix, enumerate every live process, session, cache, or connection that was
created against the broken state and cull/respawn each one; then verify the PROPAGATION (the
dependents are clean), not just the cause. "The cause is fixed" and "everything running is now on
the fix" are two claims, and the second is the one that bites when skipped.** (Companion to the
runtime-vs-source split in [the guard-at-runtime-vs-propagation-source rule](standing-rules.md): a
fix landing in one place does not propagate itself to every dependent instance.)

### 4. Tail-window coverage: a bounded log read is a coverage boundary, not the whole log

"No 401s in the 60KB tail" is not "no 401s" - it is "no 401s in the window I read." The first tail
read came back CLEAN and produced the wrong verdict (window too narrow); the 1MB tail found the
fresh 401 burst. **Rule: before calling a fresh alert a stale re-fire (or concluding a fault is
absent from a log), widen the tail until the window's EARLIEST timestamp provably precedes the event
you are checking for.** This is a log-tailing instance of VT-3 (empty output is not a confirmation):
an empty read of a bounded window is indistinguishable from a genuinely clean log unless you prove
the window covered the interval in question.

## The coverage lesson (analyst-side): heartbeat-fresh cannot rule out inference-death

Throughout the outage the fast-checker watchdog mark-alive kept `last_heartbeat` fresh, and the REPL
was process-alive - but there was zero SUCCESSFUL inference from 22:41Z until recovery. A fresh
heartbeat is **spoofable-by-construction**: the watchdog stamps liveness whether or not the agent
can infer, so "the heartbeat is fresh, so nothing is really dead" is a COVERAGE ARTIFACT, not a
finding. The fix is an AUTHORED-EVENTS-based inference-liveness detector, not a heartbeat read - the
coverage map, the armed/open detector states, and the paging split live in
[inference-liveness-detection.md](inference-liveness-detection.md); this incident is a fresh
specimen of exactly the wedge class that doc governs (and it corroborates the watchdog
sweep-clock spoofability already banked fleet-side). **Corollary at the notification layer: a daemon
"back online" notice is a TEMPLATE, not an inference product** - it fires from daemon code on the
session-continuation path and proves nothing about whether the agent can think. Reading one as
inference evidence is the same spoofable-signal error one layer up (the orchestrator read the first
notice as inference evidence and had to retract). **Only an answered round-trip proves an agent
infers.**

## Why the four wrong theories cost nothing (the discipline to repeat)

Every hypothesis was mutated reversibly and verified with a named instrument before the next step:

- **Reversible mutations only:** the resume-thread reset preserved the rollout `.jsonl` and recorded
  the old pin; the account fork was flagged as operator-only before any account action.
- **Test-first, positive-controlled:** the env read used a planted positive control (`control=1`)
  so an empty result could not be misread as absence (VT-3 discipline).
- **Stop-and-report between mechanisms:** diagnosis paused for a GO between each layer; the owning
  agent stopped on directive rather than improvising when a restart "did not recover".
- **Earned green with named instruments:** recovery was declared only on a live round-trip with the
  answer quoted, the app-server pid named, and the thread id confirmed - never on a back-online
  notice or a single clean read.

Net: four wrong theories (two orchestrator, two dev), all died to evidence PRE-action, zero
destructive moves.

## Companion facts (bank these, they recur)

- **codex auth lives at `~/.codex/auth.json`** - chatgpt-mode Bearer (`id`/`access`/`refresh`
  tokens, NO api-key field). A `sk-svcac...`-shaped key presenting from a chatgpt-mode process is a
  baked/account-side artifact, not what auth.json holds.
- **codex session rollout `.jsonl` files are a resume layer.** codex resumes a rollout thread every
  start; a stale thread can carry stale context. Scope this layer explicitly on any codex auth or
  behavior diagnosis (it was hypothesis 3 here).
- **The operator fixes things SILENTLY.** Adam's re-auth landed 12 minutes BEFORE the diagnosis
  verdict. Before deep-diving the next layer of a credential failure, check whether the operator's
  fix has ALREADY happened (a fresh `auth.json` mtime, a newer refresh timestamp) - the leading
  hypothesis for an unexplained recovery-in-progress is that a human already acted.
- **Leak-half companion (separate doc):** the same night surfaced a scanner-format-coverage finding
  - OpenAI `svcacct`/`proj`/`admin` token FORMATS evade gitleaks and both redactors. The initial
  "cleartext keys in codex session logs" alarm was a `grep -l` files-instrument read (values never
  inspected) and was retracted two-owner; NO cleartext leak existed. That half is written up
  separately by the security lane (FINDINGS-codex-session-log-secret-sink-2026-09-25.md, its own
  doc); this doc does not restate it.

## Where the generalizable rules live

The four lessons above are distilled into short, citable entries in
[standing-rules.md](standing-rules.md) so they are enforceable without reading this whole findings
doc:

- **confound rule** (lesson 1) - a new verification-method invariant in the VT spine.
- **intermittent-fault watch-window verify** (lesson 2) - a new verification-method invariant in the
  VT spine (earned-green family).
- **fix vs fix-propagation two layers** (lesson 3) - a new remediation-discipline standing rule.
- **tail-window coverage** (lesson 4) - folded as a specimen under VT-3 (empty output is not a
  confirmation).

Each standing-rules entry points back here for the forensic origin. This doc is the incident record;
standing-rules is the enforcement surface.
