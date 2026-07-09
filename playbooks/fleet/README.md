---
type: index
agent: fleet
status: active
date: 2026-07-05
---

# Fleet - Playbooks

Cross-agent processes owned by no single agent. Each playbook names design/execution owners per component inside.

## Processes

| Playbook | Process | Cadence | Autonomy |
|---|---|---|---|
| [zero-model-monitors.md](zero-model-monitors.md) | The launchd monitor layer: 9 self-alerting scripts (usage, dependencies, security scans, backups, cost snapshots) that run with zero model invocation - invisible to `cortextos bus list-crons` by design | Per job: 5 min to daily (table inside) | Autonomous, quiet-on-success |
| [rtk-engagement-sweep.md](rtk-engagement-sweep.md) | Verify an agent's RTK hook re-bound after a deploy / `--continue` bounce: the manual probe method (4 rules) + canonical proof via `history.db`. Daemon auto-heal owned by claude-dev/codex-dev | After each bounce / on demand | Manual sweep (daemon half is autonomous) |
| [switch-agent-account.md](switch-agent-account.md) | Move an agent's Claude runtime to another account (bearer/setup-token): flip both halves, stop-wait-start, four-point verify, functional sweep. DRAFT skeleton - completes with the orchestrator's next live migration | On account rebalance (orchestrator-coordinated, one agent at a time) | Human-gated (Adam mints the token; orchestrator executes) |

## Standing rules

Cross-agent hard rules (not processes with a cadence) live in [standing-rules.md](standing-rules.md): the canonical home for fleet standing rules. Currently: playbook-maintenance-is-part-of-DoD. More land there as ratified.
