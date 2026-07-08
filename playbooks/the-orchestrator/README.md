---
type: index
agent: the-orchestrator
status: active
date: 2026-07-07
---

# The Orchestrator - Playbooks

Chief of staff for the cortextOS Telegram fleet: owns the daily/weekly review cadence, the goal lifecycle, approval + human-task gating, fleet cost/bloat optimization, and agent lifecycle (onboarding, migration). Split-form (multiple distinct standing processes) - see the table below.

| Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|
| [morning-review.md](morning-review.md) | Overnight summary + goals cascade + task plan + morning briefing | Cron: daily 8am PT | Autonomous; user approves the day's task plan |
| [evening-review.md](evening-review.md) | Day summary + self-eval + overnight task proposals | Cron: daily 6pm PT | Autonomous; user approves overnight tasks |
| [weekly-review.md](weekly-review.md) | Fleet performance + goals progress + next-week plan | Cron: Sundays 8am PT | Autonomous; interactive with user |
| [goal-management.md](goal-management.md) | The daily goal lifecycle: north star -> daily focus -> per-agent goals | Invoked by morning-review + evening-review | Autonomous |
| [approvals-and-human-tasks.md](approvals-and-human-tasks.md) | Chase pending approvals + [HUMAN] tasks; ACK decisions | Cron: every 2h | Autonomous |
| [weekly-optimization.md](weekly-optimization.md) | Fleet token/bloat audit (skills, crons, docs) to cut cache-read cost | Sundays after weekly-review | Autonomous (own-file trims); fleet trims inform Adam |
| [account-onboarding.md](account-onboarding.md) | Onboard a new Claude account into the fleet | On demand (new account) | Human-in-the-loop |
| [agent-migration.md](agent-migration.md) | Migrate/rename/re-home an agent | On demand | Human-in-the-loop |

Live crons verified 2026-07-07 via `cortextos bus list-crons the-orchestrator`. Note: `weekly-optimization` references its own cron in its skill but no such cron is in the live set (only `weekly-review`); flagged, runs Sunday after the weekly review in practice. The theta-wave deep-improvement cycle is analyst-owned - see [../the-analyst/theta-wave.md](../the-analyst/theta-wave.md); the orchestrator participates as the conversation partner.
