# FINDINGS - agent-management SKILL.md variant landscape (characterize-then-decide) (2026-11-02)

**Task:** task_1793601256578_16609324 (2nd occurrence of the copies-diverged-from-canonical class; 1st = cron-management wave 3). Characterize-then-decide only. **Ruling: (a) LEAVE AS-IS** (orch-accepted), plus a mechanical propagation warning at the canonical chokepoint (this land).

## Characterization (post dead-path fix, main 81239694)

The served per-agent `agent-management/SKILL.md` (13 served + 2 community refs) collapse to ~7 distinct blobs, 419-449 lines vs canonical 436:

| Cluster | blob | lines | members |
|---|---|---|---|
| A | 0497b5d8 | 428 | the-axon-agent, the-production-house, the-sop-keeper, vitalis, atwood-dev-agent |
| B | a0999efc | 419 | codex-dev-agent, atwood-codex-agent (plugin layout) |
| C | f11ef775 | 420 | claude-dev-agent, meta-compliance-agent |
| - | 15ef0b91 | 431 | atwood-orchestrator |
| - | 74d09d19 | 420 | atwood-analyst |
| - | f62043704 | 438 | the-orchestrator |
| - | f2e2b175 | 449 | the-tax-planning-agent |
| ref | (2) | 419/420 | community/agents/{security,research-agent} |

(Blobs as of post-fix; re-enumerate at any future wave start.)

## Nature = MIX (not uniform drift, not uniform intentional)

- **Mostly DRIFT:** every copy carries cron subsections (`### Listing Crons`, `### Updating a Cron`, an add-cron Example) that the canonical has since SHED - stale-duplicate of the dedicated `cron-management` skill. Older template vintage.
- **BUT genuine ROLE-CONTENT the canonical lacks:** the-orchestrator has `### Migration Check (REQUIRED ...)` = the bot-token/chat-ID agent-creation flow; the-tax-planning-agent has `## 11. Switching an Agent's Account (incl. cross-org)`. Role/org-specific, deliberate.

A blanket unify-to-canonical would CLOBBER the role-content = the wave-3 trap, **2nd confirmed occurrence**.

## Decision: (a) LEAVE AS-IS, low priority

Rationale: the CORRECTNESS defect (dead crons.json path) is already fixed fleet-wide (tasks 1793600316582 + 1793600762428). The residual divergence is content-CURRENCY + genuine role-content, with NO driver (no pending canonical agent-management change that must reach all agents). A blanket replace is clobber-risky; the clean alternative is a large wave not justified without a driver. Silent-not-wrong beats padded-and-stale.

## Mechanical trigger (this land): canonical propagation warning

To make the trap trigger MECHANICAL rather than remembered, a 2-3 line PROPAGATION WARNING is added at the top of the canonical `community/skills/agent-management/SKILL.md` (the chokepoint every future editor passes): it points the next fleet-wide propagator here and says build the redundancy table + migrate the role-sections FIRST. The next canonical edit is the moment the trap fires; the warning sits exactly there.

## If a driver appears later (the unify wave)
Full wave-3 pattern: per-copy redundancy table -> migrate the role-sections (orch migration-check, tax-planning account-switching) to canonical or keep as per-agent addenda -> then unify the drift copies to canonical. FOLD the copies' pre-existing em-dashes (orch 12, sop-keeper 9, others) into that wave - not worth a standalone pass.
