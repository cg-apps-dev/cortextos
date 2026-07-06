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
