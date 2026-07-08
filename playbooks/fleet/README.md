---
type: index
agent: fleet
status: active
date: 2026-07-05
---

# Fleet - Playbooks

Cross-agent processes owned by no single agent. Each playbook names design/execution owners per component inside.

| Playbook | Process | Cadence | Autonomy |
|---|---|---|---|
| [zero-model-monitors.md](zero-model-monitors.md) | The launchd monitor layer: 9 self-alerting scripts (usage, dependencies, security scans, backups, cost snapshots) that run with zero model invocation - invisible to `cortextos bus list-crons` by design | Per job: 5 min to daily (table inside) | Autonomous, quiet-on-success |
| [rtk-engagement-sweep.md](rtk-engagement-sweep.md) | Verify an agent's RTK hook re-bound after a deploy / `--continue` bounce: the manual probe method (4 rules) + canonical proof via `history.db`. Daemon auto-heal owned by claude-dev/codex-dev | After each bounce / on demand | Manual sweep (daemon half is autonomous) |
