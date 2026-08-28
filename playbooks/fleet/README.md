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
| [switch-agent-account.md](switch-agent-account.md) | Move an agent's Claude runtime to another account (bearer/setup-token): vault-sourced token, flip both halves, stop-wait-start, four-point verify, functional sweep. Live-proven 5/5 (2026-07-09); one-command tool in build | On account rebalance (orchestrator-coordinated, one agent at a time) | Human-gated (Adam mints to the vault; orchestrator executes) |
| [daemon-bounce.md](daemon-bounce.md) | Bounce the cortextos-daemon from OUTSIDE its process tree (never a hosted agent): hosted-agent stages+verifies+requests, external actor runs the guard-protected `daemon-bounce.sh`. Guard refuses on partial + inside-tree. Origin: the 2026-07-15 ~2h self-teardown outage | On deploy/bounce (orchestrator-coordinated; external execution) | Human/PM2/launchd (never a daemon-hosted agent) |
| [fleet-sop-change.md](fleet-sop-change.md) | Change a process/template/infra piece EVERY agent runs without a race window or self-certified fleet edit: interim-protect-same-hour -> adversarial two-touch -> helper-first sequencing (taught-but-absent is the only dangerous direction) -> canonicalize+owner-execute+independent-verify -> rebase+re-QA-the-landing-tip+guarded-ff+seal -> classify-before-clobber + scope-split mechanical-from-footgun. Reference arc: 2026-08-28 date-basis switch | Per fleet-wide SOP/infra change | Reviewed-branch (author builds; orchestrator gates + merges; owner/security verify the fan-out) |

## Standing rules

Cross-agent hard rules (not processes with a cadence) live in [standing-rules.md](standing-rules.md): the canonical home for fleet standing rules. Currently: playbook-maintenance-is-part-of-DoD. More land there as ratified.
