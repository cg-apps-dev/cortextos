---
type: index
agent: security-agent
status: active
date: 2026-07-07
---

# Security Agent - Playbooks

Defensive security and data-safety specialist for the fleet. Runs model-driven safety-net sweeps and threat-intel research, and is the design owner of several zero-model launchd scanners.

| Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|
| [daily-security-sweep.md](daily-security-sweep.md) | Model-driven safety-net sweep: fleet secret/injection scan review + escalation | Cron: weekly Mon 5am (safety net over the launchd scanners) | Autonomous (self-alerts + escalates) |
| [threat-intel.md](threat-intel.md) | Bi-weekly threat-intel research that must yield a concrete detection-rule change or be discarded | Cron: every 2 weeks | Autonomous |

Cross-agent: the zero-model launchd scanners this agent owns (fleet-scan, daily-backup) run outside the model and are documented in [../fleet/zero-model-monitors.md](../fleet/zero-model-monitors.md) - invisible to `cortextos bus list-crons` by design.

Live crons verified 2026-07-07 via `cortextos bus list-crons security-agent`.
