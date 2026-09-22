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
- **Canonical fail-open / fail-closed classification (input):** security-agent.
- **Umbrella structural task:** security-agent, `task_1789744919499_10102642` (referenced, not owned here).

## Problem

A canonical skill doc exists as multiple synced copies across distinct surfaces, and the live copy an agent actually reads is a per-agent DIST copy that is copied at spawn and never re-synced. So every future doc fix to a canonical skill repeats a full manual copy-hunt fleet-wide. Full context + incident of record: [FINDINGS-multi-copy-consumer-trap-2026-09-18.md](FINDINGS-multi-copy-consumer-trap-2026-09-18.md).

The three surfaces:

- `templates/agent/.claude/skills/**` - **spawn source** a new agent inherits at `add-agent` (tracked).
- `community/skills/**` - **catalog** copy for new-ORG installs (tracked).
- `orgs/<org>/agents/<agent>/.claude/skills/**` - **live per-agent DIST** copies the running agent reads at runtime (gitignored / untracked).

The gap: live dist copies are frozen-at-spawn. The `agent-auth` incident needed a 6-copy fix (2 tracked + 4 live dist across the-production-house, vitalis, the-sop-keeper, the-axon-agent). This is a propagation-architecture gap, not a one-off.

## Proposal: the propagation matrix

For each canonical skill, compare each live per-agent dist copy against the current source. Four cases, each with a fixed disposition:

| Case | Condition | Disposition |
|------|-----------|-------------|
| **source-only** | Skill in source, no live copy for this agent (or a newly-added skill) | **DEPLOY** - copy source to live. |
| **clean older-source-version** | Live copy == an OLDER source version (ff-equivalent: live is an ancestor of source, no local edits) - genuinely stale | **AUTO-SYNC** - source-wins fast-forward. |
| **diverged** | Live copy independently edited - NOT an ancestor of source | **PRESERVE + FLAG** - never clobber; surface for human/owner reconcile. |
| **live-only** | Skill exists live but not in source | **NEVER-DELETE + FLAG for sync-back** - may be a bespoke skill that needs homing to source (see auto-skill sync-back SOP). |

## Safety design: detection is unconditional; classification only sets urgency

The load-bearing rule, and the one a reviewer must hold:

- **Divergence DETECTION runs UNCONDITIONALLY** and is what gates the destructive op (the auto-sync fast-forward / any clobber). Auto-sync source-wins fires ONLY in the "clean older-source-version" case (ff-equivalent = provably stale, safe to fast-forward). ANY independent divergence -> FLAG, never clobber - the same ff-only-vs-diverged discipline used for branches.
- **The fail-open / fail-closed CLASSIFICATION sets URGENCY / priority ONLY.** It never grants permission to skip the detection check. A branch being "rare" or "near-empty" today is a distribution, not an invariant - a guard justified by a rare distribution fails silently the first time the population shifts. The "diverged -> preserve + flag" branch stays ACTIVE and its detection runs unconditionally even if intentional per-agent skill divergence is believed rare, because dev confirmed it does exist. (Rationale banked: gate a destructive op on an unconditional correctness check, never on a statistical assumption about how often the unsafe case occurs.)

## The 3-way compare and its base-persistence dependency

Distinguishing "clean older-source-version" (safe to auto-sync) from "independently diverged" (must flag) requires three inputs, not two:

1. **source-current** - the current source version.
2. **live** - the live per-agent dist copy.
3. **source-at-last-sync (the BASE)** - the source version this live copy was last synced from.

With only source-current and live, an old-but-clean copy and a locally-edited copy can look identical (both "differ from source"). The BASE is what makes the ancestry test decidable: live == base -> clean, fast-forward; live != base AND live != source -> diverged, flag. **Persisting source-at-last-sync per live copy is the base-persistence dependency owned by dev.**

## Dependencies + review-vs-implement gating

- **Dev base-persistence (source-at-last-sync per live copy):** BLOCKING-FOR-IMPLEMENTATION, **NOT blocking-for-spec-review.** This spec can be circulated and its policy/matrix/safety model approved before dev commits the interface shape. Implementation of auto-sync cannot ship until base-persistence exists (without it, the 3-way compare degrades to a 2-way compare that cannot safely distinguish stale from diverged - so auto-sync must NOT run; detection-and-flag-only is the safe interim).
- **Security canonical fail-open / fail-closed classification:** INPUT. Sets the urgency of each skill's drift (which skills' staleness is fail-open low-urgency vs fail-closed security-relevant). Does not change the detection logic - only prioritization.
- **Detector host:** extends `cortextos bus check-skill-drift` (`src/bus/skill-drift.ts`), which today hardcodes a single `SKILL_SYNC_PAIRS` entry (meta-intake) and is a not-scanned-zero for every other canonical skill (gap-c in the FINDINGS).

## Acceptance gates (the fix must not itself fail-open)

Derived from the gap-c defect record (a scanner that never returned >0 for a class is suspect; never infer health from a 0 you have not proven the scanner can PRODUCE):

1. **Detector-scope - prove it DISCRIMINATES over the TRUE universe.** Extend enumeration to the canonical-skill set fleet-wide. Plant a stale line in a live canonical copy AND keep a known-in-sync control; require flag-the-planted + pass-the-control (a broken detector returns nonzero trivially, so a bare fire is not proof). **Plant across >= 2 agents** - a detector that scans agent X but not agent Y passes a single-agent plant and still misses Y; prove the enumeration over the true universe, not one sampled agent.
2. **Reconcile - two adversarial plants, both sides.** (1) A stale-drifted canonical copy must be REACHED and synced. (2) An intentionally-diverged (locally-edited) canonical copy must be FLAGGED, never clobbered. The clobber-safety half is the one that fails silently, so it needs the adversarial plant specifically.

## Out of scope / next steps

- This spec is policy only. Dev's framework spec (`task_1789744919499_10102642` half) implements base-persistence, detector enumeration, and sync execution against this policy.
- Sync-back of live-only bespoke skills to source follows the existing auto-skill sync-back SOP (route generalizable to template source; surface bespoke to orch for placement) - this spec only flags them, it does not home them.
- On approval: dev commits the base-persistence interface shape; security supplies the fail-open classification table; the-sop-keeper folds the settled model into a durable playbook once the mechanism ships and is validated (settled-only documentation rule - the playbook lands after the mechanism, not before).
