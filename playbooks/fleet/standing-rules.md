---
type: standing-rules
scope: fleet
status: active
date: 2026-07-08
tags: [fleet, standing-rules, governance]
---

# Fleet Standing Rules

The canonical home for cross-agent STANDING RULES - hard rules every agent follows, distinct from the per-agent playbooks (which document a single agent's process). A playbook says "here is how this process runs"; a standing rule says "here is a constraint that holds across the fleet, regardless of process." Rules live here, beside the processes they govern.

Each rule is titled, dated, and states the rule + why it exists. New rules land here as they are ratified. The fleet-wide non-negotiables that are structural to every agent (no em dashes; Pacific Time for human-facing times) live in each agent's `GUARDRAILS.md`; this file is for cross-agent operating rules that are not per-agent guardrails.

## Standing rule: playbook maintenance is part of Definition of Done

**Rule.** Updating the affected playbook is part of the definition of done for any workflow, cron, or skill change. A change is not "done" until the playbook that documents it is current - the code/config change and the playbook update land together, not as a follow-up.

**Why.** The playbook tree is only trustworthy if it is continuously current. A workflow that changes without its playbook updating silently turns the SOP into a stale claim - the exact failure mode the playbook system exists to prevent. Treating the doc update as optional or deferrable is how documentation rots; treating it as part of "done" is how it stays load-bearing. The-sop-keeper maintains the tree, but the trigger is any agent's change: flag the-sop-keeper (via the-orchestrator) on any workflow/cron/skill change so the playbook is updated via a reviewed branch, never a silent live edit.

**Applies to.** Every agent, every workflow/cron/skill change. See the fleet playbook index at [../README.md](../README.md).

## Standing rule: every caught error becomes a codified gate (error-class registry)

Ratified 2026-07-08 PT (Adam accuracy directive, orchestrator-approved plan WS-A3).

**Rule.** Every fleet error caught by Adam or any agent gets encoded within ONE DAY of being caught: always as a playbook gate (a terse DONE-WHEN post-condition in the owning playbook), and additionally as a scripted machine check where one is feasible. The error class is registered below so the same class is never re-solved from scratch. Route: the catching/owning agent root-causes its own lane; the-sop-keeper codifies via reviewed branch; the-orchestrator merges.

**Why.** The col-A previews case proved that a documented rule an agent is trusted to remember is necessary but not sufficient - accuracy comes from enforcement. Machine-checkable gates fail loudly when a step's output is wrong; prose does not. Registering the class (not just the instance) is what turns one mistake into fleet-wide immunity.

**Gate placement boundary.** Verify-gates live in PLAYBOOKS (on-demand reads) and scripts, never in boot files - hardening adds zero boot weight. Gates are one terse DONE-WHEN line per step; gate-bloat is its own accuracy risk (agents skim long checklists).

**Format contract (machine-countable, feeds the A4 accuracy metric).** The registry is an input to the analyst's fleet accuracy metric, so its format is a contract (the-sop-keeper holds it): every instance in a row carries its own `YYYY-MM-DD PT` date stamp with escaped-vs-self-caught noted where known (escaped = it left the owning agent, per the A4 boundary definition); registry-touching commit messages state the row-count transition, and a candidate promotion says PROMOTION explicitly. Three counters derive mechanically from git history: new classes/wk (discovery), new instances of an encoded class/wk (gate failure - the one that must trend to zero), promotions/wk (recurrence of deliberately-unencoded candidates). Counting method: the-sop-keeper's A4 registry-side method doc (agent workspace, local - flagged); metric spec: the analyst's A4 spec.

### Registry (seed entries, 2026-07-08 PT)

| Error class | Origin case | The gate |
|---|---|---|
| Stale recorded status trusted at read time (verdicts, task titles/urgency labels, TODO markers, operational instructions/canary targets in bootstrap docs) | Four instances: col-B IMG_376 (origin - stale FAIL wrongly gated 2 clean variants); a stale rules.md TODO; a stale task title ("URGENT", 07-06) re-broadcast verbatim into the analyst's 7am digest after its motive had resolved (source fix: task retired + re-scoped fresh); instance 4 (escalation) - a stale canary TARGET in a bootstrap doc: the analyst's heartbeat auth cross-check still aimed at the old account after mmb moved, a stale INSTRUCTION misdirecting a recurring check every cycle rather than a record misread once (monitor-blindness-adjacent, cross-family with the fresh+ok row below); self-caught, source-fixed | Recorded status/urgency is a claim about WHEN IT WAS WRITTEN - re-verify against current state before acting on it or re-broadcasting it into a fresh artifact (a digest/report/brief launders the staleness cue: its reader has none). col-B lane mechanism: re-scan-on-touch, file-id-anchored freshness - authoritative rule in [../meta-compliance-agent/scan-and-verdict.md](../meta-compliance-agent/scan-and-verdict.md), pointers in consuming lanes |
| Impossibility asserted without verification (premise drift) | Axon lane: "no API draft path" meant unwired-for-us, not impossible - the Campaign Management API existed all along | Before recording "X is impossible / has no API / cannot be done", verify against the primary source; record "unwired for us" when that is what is actually known |
| Template mirrored from a live artifact propagates its defects | col-A previews: manual intake mirrored an already-incomplete row as its column template | Derive column-sets/templates from the SPEC list (skill/playbook), never by copying a live row/file; a live artifact is not a spec |
| Migration silently drops a side path | col-A previews: bearer migration took the engine (which built previews correctly) out of the loop; the manual fallback lacked its gates. Recurring class: bearer kills the connector bridge; python sync leaving stale bytecode | ANY runtime/auth/tooling migration gets a POST-MIGRATION FUNCTIONAL SWEEP of every lane it touches - not just boot-clean. Any manual fallback carries the SAME machine-checkable gates as the path it replaces. Scripted-check candidate |
| Live credentials aggregated at rest in synced storage | 2026-07-08 PT: an agent-key copy in owner cloud storage led to discovery of a live-credential aggregation there; owner confirmed never-shared, accepted the risk, retained it as his private store (no rotation required); outside automated scan scope (resolved handling per security-agent; deliberately path-free) | Fleet side unchanged: keys go straight to `.env` (0600), never into .rtf/synced/exportable files, shred delivery files after apply. When a cred-at-rest IS found: scope the WHOLE container before disposition (single-file tunnel vision misses aggregation); owner-personal stores are the owner's decision; registry/doc entries stay path-free - a pointer to a leaked location is itself a leak-amplifier |
| Two authoritative rules with opposite defaults meeting at an undistinguished boundary case | Intake dedup: the Card-ID-authoritative rule (ignore file-id MISSING lists - guards re-EXPORT, origin: a 20-duplicate-row incident) vs the re-EDIT rule (new creatives on an old card MUST be intaken). Applied naively, the second recreates the first's incident: zero file-id overlap misread as "all new". Both rules were correct for their own case; the boundary between the cases was never written down | When two hard rules collide, the fix is a DISTINGUISHER for the boundary case, never picking one rule to win: encode the test that selects which rule applies (here: re-EDIT vs re-EXPORT decided by variant-identity + newer-finished-subfolder, not file-id), cross-reference it at BOTH rule sites so they stop contradicting, and default-to-FLAG-for-human on the ambiguous middle. Refinement (mc): the human flag holds only the ROW disposition - a compliance verdict never waits on it (immediate re-scan, or a SUPERSEDED/do-not-trust stamp). Encoded at meta-ads clickup-intake STEP 5 + the meta-intake Card-ID rule cross-ref |
| Fresh + ok + impossible value trusted (monitor blindness) | 2026-07-09 PT: an overnight-rotated usage credential read the fleet's PRIMARY account (8 heavy agents) as exactly 0/0 with ok:true and a fresh timestamp - the monitor had validated FRESHNESS, not the VALUE; the blindness surfaced only because a human noticed the impossibility. Worse than an obviously-broken read: nothing looks wrong. Sibling of the constant-zero dead-scan smell (the [zero-model-monitors](zero-model-monitors.md) contract) | A monitor's ok:true asserts freshness, never truth: cross-check the value against an INDEPENDENT liveness signal (a known-active lane must read non-zero), and a structurally-impossible value DEGRADES the read to suspect/ok:false - it never passes as confident. Plant-a-positive: assert non-zero where activity is known. Sampler-side enforcement SHIPPED and VERIFIED-LIVE (guard commit bcbf8cd, on main): passed its acceptance test (known-active 0/0 -> ok:false) AND fired in production the same day on a real false-zero. Auditable diagnostics row: 2026-07-09T19:41:17Z status=suspect, reason "7d=0 but $3228 attributed burn in last 24h - credential likely mis-scoped" (the burn cross-check degrading a known-active account's fresh 0/0 to suspect during the ~18:00-19:46Z blind window). Both directions production-proven: the degrade fired on the false zero, AND a genuine-low account stayed ok:true (no over-fire). Security-agent post-deploy verification |
| Cross-method fingerprint mismatch (same secret, different hashes) | Security cred-reconciliation near-miss 2026-07-08 PT: `echo "$s" \| shasum` hashes the value PLUS a trailing newline, while python `hashlib.sha256` and JS `createHash().update()` hash the bare value - comparing fingerprints computed by different methods raised a false "different credential / rotated" alarm for the same secret (nearly caused a wrong abort). Verified reproducible by the-sop-keeper before encoding | Standardize on BARE-VALUE hashing (`printf '%s'` / `echo -n` / hashlib / createHash) and state the METHOD alongside every reported fingerprint. The cortextOS system fingerprint is bare (JS createHash sha256, first 8 hex - `fingerprint()` in `src/bus/usage-accounts.ts`), so every manual comparison against a system fingerprint must use the bare method. A fingerprint without its method is not comparable evidence |
| Memory-authored citation trusted without target-verification (sibling-file conflation, phantom markers) | Two instances 2026-07-09 PT: (1) a playbook pointer named the wrong sibling skill file (low-impact: the wrong file cross-references back; caught post-merge by the owning agent); (2) RECURRENCE WITH SHIPPED IMPACT, firing the promotion criterion set that same morning: a pilot recipe cited a marker line that does not exist in the target file (the recipe was adopted into a plan and a fleet pilot before anyone read the target) | Any pointer, citation, or recipe that names a file + location/content is verified against the TARGET file content at authoring time (grep the claim, not just the path) - path-existence QA is not claim-truth QA. Markers and recipes get RE-verified against the live target at use time; sibling files edited in the same wave are conflation-prone |
| Guard gate-window tighter than production cadence (silent dead guard) | 2026-07-09 PT sampler guard root-cause (b): the delta-sanity block gated on a 10min window while the sampler runs ~every 15min, so the block was skipped EVERY cycle - the guard itself never executed in production. Constant-zero family one level up: the monitor ran, the guard inside it never did. Surfaced only in the impossible-zero post-mortem (security-agent's own premise, corrected by ground truth) | Size a guard's gate-window against PRODUCTION cadence: >= ~2x the NOMINAL cadence, to absorb sampler jitter and not just the nominal gap (a ~15min cycle stretches past 20min under load, so 1.5x can still skip a slow cycle; the shipped fix used 30min for a ~15min cadence). Exercise the guard in test AT production cadence, never a synthetic sub-window. A guard that cannot demonstrate a live or planted fire is presumed dead |
| Guard premised on "never legit-resets" false-positives when the window DOES reset (unverified reset premise) | 2026-07-09 PT sampler guard root-cause (a): the onset 7d-drop guard assumed a 7d rolling sum never legitimately resets to 0, but weekly_all resets weekly (resets_at advances); a mis-scoped cred also returns resets=None, so the reset-gate could not evaluate at all (security-agent's own premise, corrected by ground truth) | Ground-truth a metric's reset behavior before premising a guard on it. Suppress the legit-reset case ONLY on positive evidence - resets_at present + parseable + strictly advanced; absent, unparseable, or unchanged all FIRE (a dropped-resets mis-scope must never be mistaken for a legit reset). Matches the shipped guard's contract (bcbf8cd hasAdvancedReset), so row and code cannot drift at birth |

## Standing rule: fleet defect-event logging convention (A4 accuracy metric)

Authored by the-analyst 2026-07-09 (A4 Phase-0, orch-ruled vehicle: this section, beside the registry format contract above - the artifact that feeds the metric carries its own conventions). Feeds the analyst's nightly-metrics daily accrual + theta-wave weekly readout; corroborated by the registry counters in the adjacent section.

**Why.** "The fleet got more accurate" only becomes a *number* if defects are logged consistently. This convention makes every agent's error/rework/correction machine-countable so the analyst can compute a per-agent **escaped-defect rate**. Under-logging is the failure mode: a falling count then means "logged less", not "more accurate". Log the event **every time** - self-caught **and** escaped.

**The event.**
```
cortextos bus log-event error <defect_class> <severity> --meta '{
  "agent":"<name>",
  "escaped": true|false,
  "reached": "deliverable|agent|user|none",
  "rework_of": "<task_id|null>",
  "corrected_at": "<iso|null>",
  "fleet_caught": true|false
}'
```

**Field definitions.**
- **`defect_class`** - the error type (kebab-case). Reuse an encoded registry class name where one fits; a novel class is fine (it feeds registry Counter 1 = discovery).
- **`escaped`** - `true` if the error **left the owning agent** (reached a deliverable, another agent, or the user) before correction; `false` if the agent caught and fixed it **before it left**. This is the accuracy hinge (see integrity rule).
- **`reached`** - how far it got: `deliverable` | `agent` | `user` | `none` (none = self-caught before leaving).
- **`rework_of`** - the `task_id` being reworked/corrected, or `null`.
- **`corrected_at`** - ISO timestamp when remediated, or `null` if open. (Enables recovery-time = a blast-radius signal; fast remediation of an escaped defect is materially better than slow.)
- **`fleet_caught`** - `true` if **another agent** caught it before it reached the user.

**Integrity rule (verbatim - do not soften).** **`escaped=true` even when `fleet_caught=true` - the owning agent does not get credit for someone else's catch.** The owning agent's rate counts the escape; the fleet readout credits the catch separately. This keeps per-agent accuracy honest while still surfacing fleet-level self-correction.

**Self-caught vs escaped.**
- **Self-caught** (`escaped:false`) = good discipline. It is logged (so the metric can *reward* it via the self-caught ratio), not hidden. An agent that makes an error and fixes it before it leaves must NOT score the same as one whose error reached the user.
- **Escaped** (`escaped:true`) = a real defect, counted in the escaped-defect rate. Worked example (analyst, 2026-07-09): a digest usage error that reached the user then self-corrected in ~15 min = `escaped:true`, `reached:user`, fast `corrected_at` = counted as escaped **with** a good recovery time, not concealed.

**Honesty gate (before any published rate).** Per orch ruling 2026-07-09, a **plant-a-positive coverage baseline** (1-2 weeks) runs first: a seeded known error must appear in the log. A seeded error that fails to appear = a dead pipeline, and publishing rates off a dead pipeline would measure logging discipline while claiming to measure accuracy (the constant-zero lesson institutionalized). No per-agent EDR is published until coverage is proven.

## Standing rule: cross-agent facts are referenced live, never baked into bootstrap docs

Ratified 2026-07-09 PT (orchestrator graduation criterion met during the A1 verify-gate sweep: 2+ further instances found beyond the origin case).

**Rule.** A bootstrap doc (AGENTS / CLAUDE / HEARTBEAT / IDENTITY / SYSTEM / TOOLS - anything an agent reads at boot or on every turn) never hardcodes a fact owned by another agent or by live system state: which account an agent rides, tier labels, the enabled-agent roster, another agent's cron schedule. Reference the live source at read time instead (`cortextos bus list-agent-accounts`, `list-agents`, `list-crons <agent>`). Where a static mention is unavoidable, it carries the live-source pointer beside it and is treated as a hint, never as truth.

**Why.** Baked cross-agent facts are stale-by-default: the owner changes them without knowing who copied them. Origin: the analyst heartbeat canary (registry row 1, instance 4) silently checked the WRONG account every cycle. The A1 sweep then found two more: the fix itself baked fresh which-account facts (a light-agent account roster + a tier label) that go stale on the next rebalance, and a static team roster in a bootstrap doc already missing the two newest enabled agents. This is the fleet's live-authority doctrine (brain repo, sheets, rules - always read live) applied inward to our own system state.

**Applies to.** Bootstrap docs fleet-wide, at authoring time and whenever an existing doc is touched. Playbooks may state cross-agent facts only under the DoD-maintenance rule above, and prefer the canonical-once + pointers pattern even there.

## Standing rule: two-touch security review (auth/infra-mutating surfaces)

Ratified 2026-07-09 PT (orchestrator; authored by claude-dev-agent from the first live case, carried by the-sop-keeper).

**Rule.** Any change that mutates auth state (tokens, sessions, roles) or infrastructure (spawns processes, restarts agents, writes `.env`) gets security-agent at BOTH stages, and both are hard gates before the orchestrator ship-gate:

1. **SPEC-STAGE**: security-agent reviews the spec/threat model BEFORE codex builds - rules the architecture (authZ model, CSRF mechanism, privilege/execution boundary, IPC/job-file threats, concurrency/locking). The dev spec routes to security FIRST, not to codex.
2. **DIFF-STAGE**: security-agent INDEPENDENTLY re-verifies the FROZEN diff - reads source directly (not the dev reviewer's pointers), scans added lines, confirms each spec-stage must-fix is actually in code (not just documented).

**Order**: dev spec -> security spec-review -> codex -> dev raw review + security diff re-verify (both hard gates) -> orch ship-gate. The ship-gate SHOULD include a live negative proof for write paths (e.g. unauthed request -> correct reject with NO side effect).

**Why.** Proven live 2026-07-09 on the first auth-mutating dashboard write path (agent-account switch). Spec-stage caught the privilege-boundary ruling (detached-spawn vs daemon-worker, decided on the network-bind + same-uid-fleet facts) plus jobId-path-traversal, pid-reuse, and stale-lock must-fixes; diff-stage verified all four in code; the orch ship-gate proved unauthed-POST -> 401 with no side effect on the live route. A same-day relabel-of-a-half-measure would have missed at least the traversal hole.
