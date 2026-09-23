---
type: spec
scope: fleet
process: skill-dist-autosync
status: proposal-draft
date: 2026-09-22
tags: [spec, fleet, skills, dist, propagation, auto-sync, drift]
---

# SPEC: Per-agent skill dist auto-sync (propagation half)

> STATUS: proposal draft for review. This is the PROPAGATION-POLICY half. It defines the model, the safety rules, and the acceptance gates; it does not itself ship code. The framework mechanism (base-persistence, detector enumeration, sync execution) is dev's half and is built against this policy.

## Owner map (which half is whose)

- **Spec / propagation policy + safety model + acceptance gates:** the-sop-keeper (this doc).
- **Base-persistence + detector enumeration + sync execution (framework code):** claude-dev-agent.
- **Canonical fail-open / fail-closed classification (input):** security-agent (SUPPLIED 2026-09-23, two-touch complete; folded into the classification section below).
- **Umbrella structural task:** security-agent, `task_1789744919499_10102642` (referenced, not owned here).

## Problem

A canonical skill doc exists as multiple synced copies across distinct surfaces, and the live copy an agent actually reads is a per-agent DIST copy that is copied at spawn and never re-synced. So every future doc fix to a canonical skill repeats a full manual copy-hunt fleet-wide. Full context + incident of record: [FINDINGS-multi-copy-consumer-trap-2026-09-18.md](FINDINGS-multi-copy-consumer-trap-2026-09-18.md).

The three surfaces:

- `templates/agent/.claude/skills/**` - **spawn source** a new agent inherits at `add-agent` (tracked).
- `community/skills/**` - **catalog** copy for new-ORG installs (tracked).
- `orgs/<org>/agents/<agent>/.claude/skills/**` - **live per-agent DIST** copies the running agent reads at runtime (gitignored / untracked).

The gap: live dist copies are frozen-at-spawn. The `agent-auth` incident needed a 6-copy fix (2 tracked + 4 live dist across the-production-house, vitalis, the-sop-keeper, the-axon-agent). This is a propagation-architecture gap, not a one-off.

## Proposal: the propagation matrix

The mechanism holds a persisted **BASE** per (agent + skill-file) = the source content-hash at last sync. Each disposition is decided by **content-hash POINTER EQUALITY** against `base` and `source-current` - NOT by version lineage. Flat per-agent dist copies have no per-file DAG, so "ancestor of source" is not computable; pointer equality is (dev interface, committed 2026-09-22). The compare primitive is RAW-byte sha256 (see the compare section).

| Case | Condition (raw-byte sha256 pointer test) | Disposition |
|------|-----------|-------------|
| **clean-current** | `live == source-current` | **NO-OP.** If `base != source-current`, REFRESH BASE (no flag) - prevents base-rot mis-classification. |
| **clean-stale** | `live == base` (base older than source-current) | **AUTO-SYNC** source-wins, then advance base to source-current. The ONLY case that writes to a live copy. |
| **diverged** | `live` not in `{base, source-current}` | **PRESERVE + FLAG** - never clobber; owner reconcile. |
| **undecidable, no base, in-sync** | no base persisted yet AND `live == source-current` | **SEED base = source** (silent; it is clean-current). |
| **undecidable, no base, differs** | no base persisted yet AND `live != source-current` | **FLAG-UNDECIDABLE** - cannot tell clean-stale from diverged without a base, so NEVER auto-sync; owner disposition seeds the base. This is the bootstrap state and the detection-and-flag-only interim. |
| **source-only** | skill in source, no live copy for this agent | **DEPLOY** source to live; seed base = source. |
| **live-only** | skill exists live, not in source | **NEVER-DELETE + FLAG for sync-back** - may be a bespoke skill that needs homing to source (see auto-skill sync-back SOP). |

The four decidable content-compare outcomes (clean-current / clean-stale / diverged / undecidable) are dev's committed four-outcome compare; source-only and live-only are the two orthogonal existence cases.

## Safety design: detection is unconditional; classification only sets urgency

The load-bearing rule, and the one a reviewer must hold:

- **Divergence DETECTION runs UNCONDITIONALLY** and is what gates the destructive op (the auto-sync write / any clobber). Auto-sync source-wins fires ONLY in the `clean-stale` case (`live == base` = provably an untouched older sync, safe to advance). Any `live` not in `{base, source}` -> FLAG, never clobber. And with NO base persisted, a `live != source` is UNDECIDABLE -> FLAG or owner-seed, never auto-sync - so auto-sync provably cannot fire on an unseeded copy. Same discipline as ff-only-vs-diverged for branches, expressed as base-pointer equality.
- **The fail-open / fail-closed CLASSIFICATION sets URGENCY / priority ONLY.** It never grants permission to skip the detection check. A branch being "rare" or "near-empty" today is a distribution, not an invariant - a guard justified by a rare distribution fails silently the first time the population shifts. The "diverged -> preserve + flag" branch stays ACTIVE and its detection runs unconditionally even if intentional per-agent skill divergence is believed rare, because dev confirmed it does exist. (Rationale banked: gate a destructive op on an unconditional correctness check, never on a statistical assumption about how often the unsafe case occurs.)

## Fail-open / fail-closed classification (supplied 2026-09-23, folded)

The canonical classification input, SUPPLIED by security-agent on 2026-09-23 after two independent adversarial touches (touch-1 security-agent, touch-2 claude-dev-agent). It classifies each canonical skill by the **fail-direction of an agent running a STALE live dist copy**, which sets the **URGENCY / priority** of that skill's drift. This is the settled fold of the "will be supplied" input the Owner map and Dependencies reference.

**Safety invariant (load-bearing - identical to the Safety design section above, restated here so the table cannot be read out of context):** this classification sets urgency ONLY. It NEVER gates, skips, or conditions divergence DETECTION. Detection runs UNCONDITIONALLY on every one of the 26 skills regardless of class; the auto-sync source-wins clobber fires only in the provably-stale (`clean-stale`, ff-equivalent) case for ANY skill. A LOW-urgency class is NOT permission to stop scanning that skill.

**Classification axis:** for each skill ask - if an agent runs a STALE version of this skill's live dist copy, what is the worst-case fail-direction?

- **FAIL-CLOSED (security-relevant, HIGH/MED urgency):** a stale copy could make the agent take an UNSAFE action believing it is safe - degrade a security/credential/auth control, skip a safety gate (approval / irreversible-action boundary), let a detector go dark, or mishandle an exec / untrusted-content surface. Sub-rank: **HIGH** = direct credential/auth/safety-gate/detector failure; **MED** = control-plane / exec / untrusted-content surface, bounded or independently backstopped (still rated on its own content per don't-lean-on-the-backstop).
- **FAIL-OPEN (LOW urgency):** a stale copy degrades gracefully - cosmetic / UX / process / nonsecurity, or a loud failure (wrong syntax -> command errors), or backstopped by a built-in safety gate. Safe-but-suboptimal.

**Frequency is NOT in the class.** Classification uses content-severity ALONE. A skill's live-read frequency (e.g. onboarding is read once at spawn) is a shiftable distribution - a re-onboarding shifts it - so it is used for TRIAGE-ORDER only, never folded into the class (the same rare-distribution-fails-silently invariant).

### FAIL-CLOSED - HIGH (6) - drift = direct security failure

| Skill | Fail-direction if stale |
|-------|-------------------------|
| **agent-auth** | Wrong auth model -> login-mode / wrong-token-type / at-rest-cred mishandling (the #31095 break class + credential exposure). |
| **env-management** | Mishandle a secret: wrong perms, leak into a backup-riding file, wrong/absent rotation, no restart-after-cred-change. |
| **approvals** | Skip the ask-before-external/irreversible gate or wrong category -> an unapproved external or irreversible action executes. |
| **guardrails-reference** | Missing a banked security guardrail -> repeats a known-dangerous pattern (probe-live-control, cross-org wall, secret-backup-is-a-copy). |
| **heartbeat** | Hosts the step-5b security battery; drift -> a detector is not run or runs wrong = detection goes dark (silent fail-open). |
| **agent-management** | Directly handles CREDENTIALS: Telegram bot tokens, `.env`-before-enable or the agent inherits PARENT creds (the Becky-bug leak), never-share-tokens. Same credential-mishandling axis as env-management. (touch-2 lift MED->HIGH.) |

### FAIL-CLOSED - MED (10) - control-plane / exec / untrusted-content, bounded or backstopped

| Skill | Fail-direction if stale |
|-------|-------------------------|
| **soul-philosophy** | Carries the autonomy / approval boundary -> could let the agent act without a required approval (approvals-surface twin; MED on its own content). |
| **cron-management** | Mis-register / non-persist a SECURITY cron (heartbeat, sweep) -> a detector silently stops firing. |
| **codex** | Code-exec peer tool -> run in a less-safe sandbox mode or miss the at-rest-token / network-egress caveat. |
| **bus-reference** | Shell-expansion / send-safety idioms (`"$BODY"` heredoc, `--` rules) -> unsafe send form = command-injection/mangle path (send-guard hook is an independent backstop; rated on its own per don't-lean-on-backstop). |
| **worker-agents** | Spawns ephemeral full exec sessions on a machine holding spend/key-mint tokens -> unsafe worker spawn / at-rest-token exposure. |
| **m2c1-worker** | Spawns a dedicated autonomous build session and configures its credentials -> unsafe build / credential config. |
| **web-browse** | Fetches untrusted web content (injection / exfil / SSRF vector) -> unsafe content handling. |
| **agent-browser** | Untrusted web + external actions (Slack send, form-fill, login, Electron automation) -> unsafe automation or an external action. |
| **onboarding** | One-shot spawn-time setup incl auth mode -> wrong initial auth/config (content-severity is security; live-read frequency handled as triage-order, not class). |
| **comms** | Carries the SAME shell/send-safety idioms as bus-reference; rated on its own content (not discounted for the send-guard backstop) -> MED. (touch-2 lift LOW->MED = consistency.) |

### FAIL-OPEN - LOW (10) - cosmetic / UX / process / nonsecurity, safe-but-suboptimal

| Skill | Why fail-open |
|-------|---------------|
| **activity-channel** | Org broadcast format/channel; nonsecurity. |
| **auto-skill** | Skill drafting; the independent backstop is that skill ACTIVATION requires human approval (a draft cannot self-activate), not the doc's self-described no-auto-activate norm. Worst case = a suboptimal DRAFT, still human-gated. |
| **autoresearch** | Experiment cycles; nonsecurity. |
| **event-logging** | Dashboard visibility; nonsecurity. |
| **human-tasks** | [HUMAN] task/blocker process; stale -> DELAYED surfacing of a security escalation (availability/process, monotonic-safe), NOT an unsafe action. |
| **knowledge-base** | KB query/ingest usage; the ingest-time injection-scan is framework code in `src/bus/knowledge-base.ts` (independent of this doc, so a stale KB doc does not disable it). |
| **memory** | Memory-continuity protocol; secret-handling belongs to env-management/guardrails. |
| **system-diagnostics** | Fleet health checks; nonsecurity. |
| **tasks** | Task lifecycle / dashboard; nonsecurity. |
| **tool-registration** | TOOLS.md doc-keeping ONLY (not the MCP launcher/exec registration), so no exec surface. |

**Tally: 6 FAIL-CLOSED-HIGH + 10 FAIL-CLOSED-MED + 10 FAIL-OPEN-LOW = 26 skills**, + 1 role-split note below. (Post-touch-2: agent-management MED->HIGH, comms LOW->MED.)

### Special: RTK-USAGE-NOTE.md (agent-role-dependent) and its model resolution

| Item | Classification |
|------|----------------|
| **RTK-USAGE-NOTE.md** | **FAIL-CLOSED-HIGH for security-agent** (stale -> trust rtk-filtered output for absence/security verification = a false-clean verdict, its core-job hazard); **FAIL-OPEN-LOW for general agents** (a token-savings convenience note). |

**Model resolution (the-sop-keeper, fold owner - non-blocking):** because the classification sets URGENCY ONLY and detection + sync are class-independent (both run unconditionally on content, per the safety invariant), the per-agent role-split needs NO detection/sync override to stay safe. It is accommodated purely as a **per-(agent, file) triage-urgency attribute**: an RTK-USAGE-NOTE.md flag is triaged HIGH for security-agent and LOW for a general agent, but is DETECTED and (if provably `clean-stale`) SYNCED identically regardless. So the auto-sync model keeps ONE class-per-file for its safety logic and allows urgency to be keyed per (agent, file) for triage ordering only; RTK-USAGE-NOTE.md is the sole current instance. (Confirm-back to security-agent + noted for dev's detector urgency-ordering enumeration.)

## Flag sink and cadence (a flag needs a named consumer)

The three flag dispositions (`diverged -> preserve + flag`, `undecidable-no-base -> flag or owner-seed`, `live-only -> never-delete + flag-syncback`) each need a NAMED SURFACE and a stated read cadence, or a flag with no consumer decays into preserve-and-silence (the silent-queue class - the thing sits flagged forever and nobody acts).

- **Sink:** each flag emits (1) a line in the `check-skill-drift` report (the machine-readable surface) AND (2) a per-divergence owner task routed to the agent that owns the live copy (diverged) or to the-orchestrator for placement (live-only bespoke, per the auto-skill sync-back SOP).
- **Cadence:** the drift report is read at a stated interval (the detector's own run cadence, surfaced in the owning agent's heartbeat / the fleet briefing), so a standing flag is seen and dispositioned, not accumulated. A flag that is not on a surface someone reads on a schedule is not a flag.

## The 3-way compare and its base-persistence dependency

Distinguishing `clean-stale` (safe to auto-sync) from `diverged` (must flag) requires three inputs, not two:

1. **source-current** - the current source content-hash.
2. **live** - the live per-agent dist copy's content-hash.
3. **base = source-content-hash-at-last-sync** - persisted per (agent + skill-file). **This is the base-persistence dependency owned by dev.**

With only source-current and live, an old-but-clean copy and a locally-edited copy look identical (both differ from source). The base makes the test decidable by POINTER EQUALITY, not ancestry (flat dist copies have no per-file DAG, so there is no lineage to walk): `live == base` -> clean-stale (advance); `live` not in `{base, source}` -> diverged (flag); no base -> undecidable (seed or flag). The mechanism never computes "is-ancestor" - it only compares hash pointers.

**Compare primitive: RAW-byte sha256 - one SINGLE shared primitive, NEVER a version-string field.** The detector hash AND the base-writer MUST compute the identical hash the identical way (a fingerprint must be canonical across every verifier, or they disagree on a trailing newline / EOL and mis-classify - the fingerprint-canonical-across-verifiers rule). Canonical = raw-byte sha256 of the file, exactly what `src/bus/skill-drift.ts` computes today - no normalization, nothing to keep in sync. Normalization is adopted ONLY if concrete EOL/whitespace churn in the live copies needs absorbing, and then it is defined ONCE and called by both the detector and the base-writer. Never compare a declared `version:` field: it can match while the body has drifted (brain-mirror byte-parity rule), which would auto-sync or clear-flag a copy whose content actually diverged.

## Dependencies + review-vs-implement gating

- **Dev base-persistence (source-at-last-sync per live copy):** BLOCKING-FOR-IMPLEMENTATION, **NOT blocking-for-spec-review.** This spec can be circulated and its policy/matrix/safety model approved before dev commits the interface shape. Implementation of auto-sync cannot ship until base-persistence exists (without it, the 3-way compare degrades to a 2-way compare that cannot safely distinguish stale from diverged - so auto-sync must NOT run; detection-and-flag-only is the safe interim).
- **Security canonical fail-open / fail-closed classification:** INPUT, **SUPPLIED + FOLDED 2026-09-23** (see the classification section above). Sets the urgency of each skill's drift (which skills' staleness is fail-open low-urgency vs fail-closed security-relevant). Does not change the detection logic - only prioritization.
- **Detector host:** extends `cortextos bus check-skill-drift` (`src/bus/skill-drift.ts`), which today hardcodes a single `SKILL_SYNC_PAIRS` entry (meta-intake) and is a not-scanned-zero for every other canonical skill (gap-c in the FINDINGS). The fix DERIVES the canonical set from the source surfaces (templates skills + community skills) crossed with every live agent - replacing the hand-list so a newly-added skill is auto-in-scope - and adds a shrink-guard so the derived enumeration cannot silently contract (dev interface, committed).

## Acceptance gates (the fix must not itself fail-open)

Derived from the gap-c defect record (a scanner that never returned >0 for a class is suspect; never infer health from a 0 you have not proven the scanner can PRODUCE):

1. **Detector-scope - prove it DISCRIMINATES over the TRUE universe.** The enumeration is DERIVED from the source surfaces (templates skills + community skills) crossed with every live agent - never a hand-maintained list like today's `SKILL_SYNC_PAIRS` - so a newly-added skill is auto-in-scope, plus a SHRINK-GUARD that asserts the derived set cannot silently contract (a shrunk enumeration is the not-scanned-zero failure re-entering by the back door). Prove discrimination: plant a stale line in a live canonical copy AND keep a known-in-sync control; require flag-the-planted + pass-the-control (a broken detector returns nonzero trivially, so a bare fire is not proof). **Plant across >= 2 agents** - a detector that scans agent X but not agent Y passes a single-agent plant and still misses Y; prove the enumeration over the true universe, not one sampled agent.
2. **Reconcile - two adversarial plants, both sides.** (1) A stale-drifted canonical copy must be REACHED and synced. (2) An intentionally-diverged (locally-edited) canonical copy must be FLAGGED, never clobbered. The clobber-safety half is the one that fails silently, so it needs the adversarial plant specifically.

## Out of scope / next steps

- This spec is policy only. Dev's framework spec (`task_1789744919499_10102642` half) implements base-persistence, detector enumeration, and sync execution against this policy.
- Sync-back of live-only bespoke skills to source follows the existing auto-skill sync-back SOP (route generalizable to template source; surface bespoke to orch for placement) - this spec only flags them, it does not home them.
- Status of the three inputs: dev committed the base-persistence interface shape (2026-09-22); security SUPPLIED the fail-open classification table (2026-09-23, two-touch, folded above); the-sop-keeper folds the settled model into a durable playbook once the mechanism ships and is validated (settled-only documentation rule - the playbook lands after the mechanism, not before; tracked as goal-2 / task_1790175800149).
