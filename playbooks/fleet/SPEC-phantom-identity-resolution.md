# Phantom identity: how an unresolved CTX_AGENT_NAME becomes a filesystem path

Measured 2026-07-25 by five agents working the same defect from different angles.
Findings are credited to whoever established them, because getting that wrong was
itself one of the night's errors (see "Attribution" at the end).

**How to read this file.** Nearly every intermediate conclusion here was wrong and
got corrected by a measurement. The corrections are kept in place, not tidied away,
because the *shape* of the errors is more reusable than the final answer. Where a
statement was reversed, the reversal is marked.

---

## 1. The mechanism (the-orchestrator, from claude-dev's cwd finding)

`src/utils/env.ts:41-45` resolves the agent name from **four** sources, not three:

```ts
const agentName =
  overrides?.agentName ||
  process.env.CTX_AGENT_NAME ||
  envFile.CTX_AGENT_NAME ||     // <- read from join(process.cwd(), '.cortextos-env')
  basename(process.cwd());
```

**claude-dev-agent found the load-bearing detail:** `env.ts:18` is
`join(process.cwd(), '.cortextos-env')` — **cwd only, no upward walk.** So source
#3 is itself a function of the invocation path. That is the cause of one script
producing both correct and phantom records.

**Three outcomes, keyed entirely on cwd:**

| cwd at invocation | resolves to | how it happens |
|---|---|---|
| the agent dir | correct name | `.cortextos-env` is found (it contains `CTX_AGENT_NAME`) |
| the repo root | **`cortextos`** | `basename('/Users/adamfolker/cortextos')` |
| `/` | **`''`** (empty) | `basename('/') === ''` — launchd's default, no `WorkingDirectory` |

**REVERSED:** all five of us said "a launchd firing produces the phantom name
`cortextos`." It does not. **Launchd produces empty.** The name `cortextos` requires
a script that `cd`s to the repo root — `fleet-scan.sh:73` does exactly that
(`cd "$FRAMEWORK_ROOT"`, defaulting to `/Users/adamfolker/cortextos`, with zero
`CTX_AGENT_NAME` in the script). **The `cd` is the mechanism, not the plist.**

Consequence: for any script that `cd`s, a plist `WorkingDirectory` is not merely
fragile, it is **inert** — the `cd` runs afterwards and overrides it. (claude-dev
withdrew its own two-ways-to-gain-coverage line for this case.)

> **DO NOT CONFLATE THE TWO PLIST KEYS — the-orchestrator did, and published it.**
> `WorkingDirectory` is inert against a script-level `cd`. **`EnvironmentVariables` is
> not**, because it never goes near cwd. `process.env.CTX_AGENT_NAME` is evaluated
> *before* `basename(process.cwd())`, and **a `cd` changes cwd but cannot touch
> `process.env`** — security-agent proved this two ways (resolution order, plus a
> direct `process.chdir('/')` test showing `basename(cwd)` becomes `''` while the env
> var stays set).
>
> So "the env var is the only lever" is correct; **"not in the plist" does not
> follow** — a plist is one of the places an env var can be set. Both fixes are valid:
> plist `EnvironmentVariables` for a launchd entry point (keeps identity out of the
> script), `export` for anything shell-invoked.
>
> security-agent also withdrew its own supporting experiment here: its 23-vs-0
> comparison between `daily-backup.sh` and `fleet-scan.sh` differed in **two**
> variables, not one (only the latter `cd`s), so it proved the plist env var works but
> not that it survives a `cd`. The direct test is what proved that.

## 1b. THE TIER ABOVE IS WORSE, AND IT IS SILENT (the-analyst)

**Two of the four tiers read cwd, not one.** `envFile.CTX_AGENT_NAME` (tier 3) is read
from `join(process.cwd(), '.cortextos-env')` at `env.ts:18`, and it sits **above** the
`basename` fallback this spec was originally written about.

Measured, with `CTX_AGENT_NAME` unset:

| cwd | resolves to | plausible on sight? |
|---|---|---|
| another agent's dir | **that agent's real name** (`security-agent`, `the-analyst`) | **YES — passes every check** |
| repo root | `cortextos` | no |
| `/` | `''` | no |

16 `.cortextos-env` files exist right now, one per agent, all live, each containing a
valid roster name.

> **THE FALLBACK THIS SPEC DOCUMENTS IS THE LOUD ONE. THE TIER ABOVE IT IS SILENT.**
> `basename('/') === ''` is how the phantom got caught — an empty agent name is
> implausible on sight. A neighbour's `.cortextos-env` hands you a **real, enabled,
> on-roster name**: a wrong identity that passes every plausibility check we have. And
> plausibility is the check that caught every other detector failure on 2026-07-25.

**Not claimed:** that any agent currently resolves through tier 3. The mechanism is
verified; the population is not. That measurement must come **from the process list,
not from the plists — the plists are the artifact, the running processes are the
authority.**

### The protection is falsy-chained, so setting the key is NOT being protected

```
CTX_AGENT_NAME=""   ->  "CTX_AGENT_NAME" in process.env === true
                    ->  AND IT STILL FALLS THROUGH, because || tests falsy, not defined
```

Measured: cwd `security-agent`, `CTX_AGENT_NAME=""` resolves to `"security-agent"` —
**byte-identical to the key being absent entirely.**

So a plist `EnvironmentVariables` entry with an empty value **reads as "the fix is
applied" to any audit that greps for the key.** This is the
format-validation-present / existence-validation-absent shape one tier up from where
the rest of this spec finds it.

> **ASSERT ON THE VALUE BEING NON-EMPTY, NEVER ON THE KEY EXISTING.** Any verification
> of the plist fix in §1 that checks for key presence is a false green.

This supersedes the fix guidance issued to security-agent and meta-ads-agent on
2026-07-25, which said to set `CTX_AGENT_NAME` in the plist without specifying that a
present-but-empty value is indistinguishable from no value at all.

## 2. Two variables, failing in opposite directions (claude-dev-agent)

The same function loses `CTX_ORG` the same way, eleven lines apart:

```
agentName ... || envFile.CTX_AGENT_NAME || basename(process.cwd())   -> A PLAUSIBLE WRONG NAME
org       ... || envFile.CTX_ORG        || ''                        -> HONESTLY EMPTY
```

**An empty field announces itself; a plausible one argues it is fine.** Or, in
security-agent's sharper form: **from the same function, four lines apart, one
invents and one erases.** So the org
fallback is the correct design and the agent one is the bug. The fix is not "add
existence validation to `agentName`" — it is **make `agentName` fail the way `org`
already does.** Delete the synthesising fallback.

Proof it is one writer losing both, not two writers (security-agent verified the
boundary independently, the-analyst a third time):

```
orgs/clean-green-marketing/analytics/events/cortextos  28 files  7008 rows  org=clean-green-marketing 100%  05-31 -> 06-29
analytics/events/cortextos                             17 files  5242 rows  org=<EMPTY> 100%                06-30 -> 07-21
```

100% populated on one side, 100% empty on the other, **contiguous to the day.** A
switch, not a decay. `CTX_ORG` stopped resolving on 2026-06-30 and the writer
**moved** rather than stopped. Unresolved name gives a phantom identity; unresolved
org gives a phantom **scope**.

### Sequencing constraint on the fix (claude-dev-agent)

`env.ts:118` is `if (agentName) { validateAgentName(agentName) }` — an empty name is
falsy, so the guard **skips**. Whether that matters depends on the ref:

- **6b on main** → deleting the basename fallback is safe alone; `paths.ts:31` calls
  `validateAgentName` unconditionally and `validate.ts:28` (`if (!name || ...)`)
  rejects empty, so it throws before any `join`.
- **6b not on main** → `main`'s `paths.ts` has **zero** `validateAgentName`, so an
  empty name flows into `join` unvalidated. The deletion then requires a paired
  refuse-on-empty at `env.ts:118`.

`d17b8b54` is **branch-only**. So against `main`, the trap is real. Write it as:
**delete the basename fallback only after 6b is on main; until then it needs the
paired refuse-on-empty.** A sequencing constraint, not a second fix.

Note for the brief: 6b is the commit that was reverted four times on 2026-07-25, so
"safe as one change" currently rests on repeatedly-removed code. That is a fact about
the plan, not about the code.

## 3. Two disjoint artifact classes (claude-dev-agent)

`join(root, 'inbox', '')` → `root/inbox`. **An empty segment collapses into the
parent.** So:

| resolved name | artifact produced | findability |
|---|---|---|
| `cortextos` | **phantom directories** (`inbox/`, `state/`, `logs/`, `analytics/`) | announces itself — a directory named after the repo |
| `''` | **unattributable records in the correct directories** | invisible; only the `from` field shows it |

**This is why the censuses never reconciled.** A sweep that counts directories misses
the entire empty-name population; a sweep that counts `from:""` misses the
phantom-directory population. Two censuses measuring disjoint classes and comparing
totals. Neither was wrong.

**And the intuition inverts: the one that looks worse is the one that got found.**
The phantom directory is ugly and self-announcing. The empty sender lands in the
right place and surfaces only if you read a field nobody reads.

## 4. Exposure is a property of the invocation path (the-analyst)

**A script does not have an exposure status at all — each path does.** Proven by
`fleet-scan` producing 4 phantom records *and* 55 correct ones from the same file:
in-agent invocations find `.cortextos-env`, the launchd firing does not.

Both a per-script scorecard built by the-analyst and one built by the-orchestrator had
the wrong *shape*, independently.

Corollary (the-analyst): a writer must be registered **by invocation path**, since one
script yields different identities from different cwds.

## 5. Three conditions for exposure (claude-dev-agent)

```
(a) no CTX_AGENT_NAME in the child's environment - INCLUDING via a cwd-reachable .cortextos-env
(b) the script actually EXECUTES a bus call
(c) THE INVOCATION ACTUALLY REACHES THAT LINE
```

**(c) is the only one that cannot be read off the source.** It needs records or logs.
Between two agents each condition was missed at least once: claude-dev failed on (c)
(reported "every fire manufactures a record"; measured **zero**, launchd log 0 bytes,
exit 0), the-orchestrator failed on (a).

`uncovered` and `live` are different claims. The precise form is **structurally
uncovered, not currently phantoming.**

### State space

| state | example | current reading | past |
|---|---|---|---|
| live and producing | `fleet-scan`'s launchd firing (4 records) | non-zero | non-zero |
| uncovered, never fired | claude-dev's reconcile job (0) | zero | zero-ever |
| produced then stopped | the heartbeat writer (5,238 rows) | zero-recent | many-then-zero |

Source inspection cannot distinguish rows 2 and 3 — **the discriminator is history,
not code** (the-analyst). Its control-health registry already encodes these as
never-fired vs possible-latch.

**And `stopped-because-fixed` is identical in the record to
`stopped-because-the-writer-died`** (claude-dev). So state 3 needs a *reason*; absent
one, treat it as unfixed, because a dead writer resumes when whatever killed it is
restored.

**Two false stops were found on the one writer:**
- 06-29 looked like a stop; it was a **scope move** (§2). *A stop in one scope is not
  a stop* (the-analyst).
- 07-21 looked like a resumption; that row is `agent_message_sent` from `fleet-scan`,
  not a heartbeat. Heartbeats end `2026-07-15T06:46:53Z`. **A shared directory is not
  a shared writer** — separate by writer before reading a tail.

The taper is the real lead: 442 (07-14) → 128 (07-15) → none, last row 06:46:53. A
stop **part way through a day**, which is the signature of something being stopped or
reconfigured that morning rather than expiring.

## 6. The detector, and what validating it requires

**Candidate** (the-orchestrator): instance-level `analytics/events/<name>` with an
empty `org` field. Every real agent writes org-scoped only.

**Negative controls** (security-agent, 5 of 5 clean): security-agent 53/0,
the-orchestrator 56/0, meta-ads-agent 52/0, claude-dev-agent 43/0, the-analyst 56/0.
The phantom is 28/17 — the only name with instance-level files.

**Then meta-ads-agent killed it with a natural planted positive.** Its launchd
scripts fired for real that day (09:00 and 13:00 UTC) and left **zero** rows there,
because `notify-agent` writes exactly one artifact:

```
join(ctxRoot, 'state', TARGETAGENT, '.urgent-signal')   payload = { from: env.agentName, message, timestamp }
```

**Target-keyed.** The sender's name exists only inside a payload that fast-checker
deletes on read. So a `notify-agent`-class emitter leaves no durable sender-attributed
artifact anywhere.

> **NEGATIVE CONTROLS PROVE SPECIFICITY. ONLY A PLANTED POSITIVE PROVES SENSITIVITY.**
> A positive control proves the *corpus* is reachable; a planted positive proves the
> *detector* can see the thing. They are different tests.

Both the-orchestrator (built it) and security-agent (extended it to five controls)
ran only the specificity half. security-agent's own reading: *extending a half-tested
detector made it look more validated without adding coverage — more confidence, no
more coverage.*

**Ships with a scope caveat or not at all:** valid for `send-message`-class emitters,
**structurally blind to `notify-agent`-class ones.** Otherwise the first person to run
it clean concludes the class is closed when half of it is invisible by construction.

**Latch property** (security-agent): the detector fires on *has ever fired*, because
the directory persists. After a fix it stays positive forever, and deleting the tree
destroys the only evidence the phantom existed. **Record the 17 as the post-fix
baseline and alert on increase** — it degrades to a bare existence check if anyone
forgets the baseline, which is the safe direction. Same call as leaving
`inbox/cortextos` and `logs/cortextos` in place: *the artifact that proves the defect
and the artifact the detector watches are the same object,* so cleanup and detection
are in tension and must be chosen deliberately rather than tidily.

**Working detector for the `notify-agent` class** (meta-ads-agent): the recipient-side
transcript. `stdout.log` holds injected payloads verbatim, so the consumed-on-read
file is not the only record. 101 reconcile-monitor signals, **every one `from:""`** —
a known-bad baseline of 101 true positives, must read `meta-ads-agent` after the fix.
Retrospective, no kickstart, and sensitive by construction.

### Verifying a fix here: never a negative condition on a shared artifact

security-agent's first acceptance test for its own fix was *"`logs/cortextos/`
message-history stays at 9 lines."* That artifact has **two writers**: 4 records from
`fleet-scan` (its own) and 5 from the ops-alert redirect path (not its, still live —
most recent **2026-07-25T16:01:38**, the same day).

So the condition cannot distinguish *my fix worked* from *the other emitter stayed
quiet*, nor *my fix failed* from *the other emitter fired*. Given that it fired that
day, the likely outcome was a rise it did not cause, read as its fix failing.

> **Verify on an artifact with exactly one writer, and prefer the positive form.**
> Here: the next launchd fire must APPEND to `logs/security-agent/message-history.jsonl`
> (936 lines, single writer). Keep the shared-file check as secondary, and if it rises,
> **attribute by content before concluding** — the record text names its emitter, which
> is how the 4 and the 5 were split in the first place.

This is the-analyst's axis point (§5, *a shared directory is not a shared writer*)
landing on an **acceptance test** rather than on a measurement — the second time that
defect appeared in a pass condition rather than in an analysis.

And security-agent's larger call is the one to keep: **do not verify this fix by reading
the plist at all.** A plist with `<string></string>` passes a grep-for-key audit and
still produces phantom records, so configuration inspection confirms the key and proves
nothing about the resolution. Behavioural, on the path that was broken, on an artifact
with one writer.

### Why the repo root reaches tier 4 at all (security-agent)

There is **no `.cortextos-env` at the repo root** — verified. That is precisely why a
script that `cd`s there falls past tier 3 to `basename`. Each agent directory *does*
have one, with `CTX_AGENT_NAME` and `CTX_ORG` both present and non-empty. So
`fleet-scan` would resolve correctly from its own agent dir and phantoms **only**
because line 73 `cd`s away from it. A tier-3 fix (not `cd`-ing away) would also work
but is more invasive than the tier-2 env var.

---

## 7. The cost: 37 stranded replies, and 16 of 16 answering into a void

`from` is validated for **format** and never for **existence**. `cli` matches
`^[a-z0-9_-]+$`, so it passes every guard. Agents are instructed to reply to the
sender. Nothing named `cli` exists.

```
inbox/cli    37 messages    16 distinct agents    6 occasions (2026-06-30 .. 2026-07-23)
```

On **2026-07-23**, an ops liveness check from Adam asked all 16 agents to confirm they
were online. **All 16 answered. 15 within 19 seconds** (00:21:58 → 00:22:17;
the-axon-agent at 01:24:54). Every reply went to `inbox/cli`. He saw none of them.

**The fleet was never the problem** — every agent heard him and answered fast. Only
the reply leg was broken, and nothing reported the failure.

security-agent established the mechanism correction that made the real number
findable: it had 2 liveness messages in `processed/` and 0 in its inbox, so **delivery
worked.** The phantom `.urgent-signal` directory was a redundant fast-path that failed
silently and changed nothing. *The answers died on the reply leg, not on delivery.*
Until that was separated, the count read as "at least four."

Also stranded there: real coordination content, not only liveness replies.

**Escalated to Adam 2026-07-25:** send-side guard landed (`57a74892`, target
validation); reply-side from-existence validation awaits his approval.

### Related, same class, already closed

Two `state/` directories whose **names are space-joined lists of agent names** (16
names, created 2026-07-22 17:20:08; 6 names, 2026-07-20 15:17:40) — a quoted list
variable passed as one `targetAgent`. `57a74892` (2026-07-25) closes it; both predate
the guard. claude-dev's framing: *the same shape as the phantom — a well-formed-looking
string that is not an agent, passing a format check that never asked whether it was
one.*

---

## 8. Method lessons that generalise past this defect

**A guard is a property of its call sites, not of its definition.** the-orchestrator
published "a wrong agent name now hard-fails" from one call site while library callers
sailed past. claude-dev published a trap from `env.ts:118` while `paths.ts:31`
backstopped it. Same error, opposite directions — **and over-warning is the direction
to prefer** (claude-dev), because only under-warning ships a hole. It is not the
direction the incentives push.

**Name your ref.** The two of us disagreed about a *safety* conclusion entirely
because one read the working tree (branch) and the other reasoned about `main`. Both
correct. Publish your exact inputs, on safety conclusions as much as on counts.

**A zero is scoped to where you looked** — and so is a non-zero. Three instances on
one writer: a directory-axis zero (06-29), a second-tree zero (one tree reported as
"the" location), and a time-axis zero (last dense day taken for the last day).

**We discard results on calls we have judged low-stakes, and that judgement is exactly
what makes them invisible** (the-analyst). Nobody discards a result they think
matters, so the discard is the *artifact of the judgement*, and calls with no error
handling are precisely the set nobody re-examines. Measured: 12 of 15 of its bus calls
discard; in each script the one captured call is the one it built route-verification
for; every `log-event` is `>/dev/null` — and `log-event` is what writes the record
proving what happened, so a monitor's own audit trail can develop a hole it is
definitionally unable to report.

claude-dev's 4-for-4 is the correlation (every orphan emitter also discards its
result: `() => {}`, `() => {}`, `>/dev/null || true`, `check=False`); the-analyst's is
why it is not a coincidence. **An emitter that cannot report failure also cannot
report that it wrote to the wrong place** (security-agent).

**A fix applied at N sites reads as done.** the-analyst fixed one send in
`goal-staleness-cron.sh` and left a second in the same file going to `/dev/null` —
the second time that file taught it the same lesson, which means the lesson needs to
live in the file rather than in recall.

**Verification must exercise the path that was broken, not the convenient one**
(the-analyst). A round-trip tests one path. Running `notify-agent` by hand from an
agent context passes *because* cwd is the agent dir — the verification and the defect
are on different paths by construction. For a launchd job the only honest verification
is a real fire or an invocation reproducing launchd's environment (`env -i`), because
your own process env having `CTX_AGENT_NAME` set is what makes a hand-run pass
vacuously. If that is awkward, **"unverified on the exposed path" beats a green from
the other one.**

**A pattern that does not match the text for a reason the pattern cannot see.** Three
axes found in one night, all caught by implausibility rather than by design: case
sensitivity (0 vs 16 files), line continuation (`>/dev/null` after a backslash —
single-line grep returned 0 discards where there were 12), and specific-but-never-
tested-for-sensitivity. All three belong in
`check-negative-is-measured.sh`; a second fixture would split the class and halve the
chance either gets read.

**Attribution.** One consolidated body sent to four peers **strips authorship**,
because an unlabelled finding reads as addressed to whoever is holding it. Consolidation
is right for Adam and wrong for peers. Three costumes for that one defect in a single
night: retargeted second-person text, dissolved attribution, and an over-correction
that reassigned an error *away* from its author — the-orchestrator attributed its own
corrected error to the-analyst, then "corrected" it by clearing the-analyst of an error
it had in fact made and corrected itself. *Removing an error from its author is not a
correction; it is the same drift pointing the other way.*
