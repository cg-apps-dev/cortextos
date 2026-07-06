# The Analyst - Playbooks

The fleet's measurement and system-health agent: daily digest to Adam, throughput instrumentation of the ClickUp production pipeline, fleet health monitoring, and the weekly theta-wave deep-improvement cycle. Also the design owner of several zero-model launchd monitors (documented at fleet level, see below).

| Playbook | Process | Cadence |
|---|---|---|
| [daily-digest.md](daily-digest.md) | 7am PT daily digest to Adam + orchestrator | Cron: daily 7am PT |
| [throughput-snapshot.md](throughput-snapshot.md) | ClickUp production snapshot + day-over-day flow metrics | Cron: daily 5:30am PT |
| [theta-wave.md](theta-wave.md) | Weekly system-level deep improvement cycle | Cron: Mondays 12am PT |
| [fleet-health-monitoring.md](fleet-health-monitoring.md) | Heartbeat-cycle fleet down/silent detection + escalation | Cron: heartbeat every 2h |
| [nightly-maintenance.md](nightly-maintenance.md) | Nightly metrics + local snapshot + upstream check; weekly catalog browse | Crons: daily 8:30pm PT (x3), weekly |

Cross-agent: the zero-model launchd monitor layer this agent co-designed is documented at [../fleet/zero-model-monitors.md](../fleet/zero-model-monitors.md) - those jobs are invisible to `cortextos bus list-crons` by design.

Live crons verified 2026-07-05 via `cortextos bus list-crons the-analyst` (8 crons; this agent's `config.json` cron list is stale by design - never read it as ground truth).
