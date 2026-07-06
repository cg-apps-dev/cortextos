---
type: playbook
agent: the-analyst
process: nightly-maintenance
status: active
date: 2026-07-05
tags: [playbook, analyst, maintenance, metrics, git]
---

# Nightly Maintenance Window (+ weekly catalog browse)

Three co-scheduled mechanical crons fire nightly at 8:30pm PT, plus one weekly discovery cron. Grouped in one playbook because each is a one-command process with the same purpose class (routine upkeep); if any grows real procedure, it graduates to its own file.

## Nightly, 8:30pm PT

1. **nightly-metrics**: run `cortextos bus collect-metrics`, review `analytics/reports/latest.json`, report anomalies to the orchestrator.
2. **auto-commit**: daily LOCAL snapshot of the agent's own state to an ISOLATED branch - never touches main; staged diff reviewed for PII before committing (skill: `local-version-control`).
3. **check-upstream**: run the upstream check per the `upstream-sync` skill. **Never auto-merge.** (Standing measurement rule: incoming-change estimates use merge-base diffs, not two-dot - two-dot overstates on divergence.)

## Weekly

4. **catalog-browse** (every 7 days): browse the community skills catalog per the `catalog-browse` skill and recommend useful new skills for the fleet.

## Notes

All four executable specs are the agent's local `.claude/skills/` files (untracked). The auto-commit isolated-branch discipline is what keeps agent-state snapshots from ever polluting the repo's main history.
