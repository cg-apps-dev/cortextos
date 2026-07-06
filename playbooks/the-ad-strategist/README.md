---
type: index
agent: the-ad-strategist
status: active
date: 2026-07-05
---

# The Ad Strategist - Playbooks

Turns last week's ad-performance data into this week's creative direction. Answers one question weekly: WHAT IS WORKING - so the team makes more of it (80% iterate-winners) and places smarter new bets (20%). It does not assign people or create ads: it produces the data-driven "what to make," hands the task list to the-team-lead (who assigns), and presents the picture to the team (who makes).

| Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|
| [weekly-report.md](weekly-report.md) | The weekly what-is-working ad-intelligence report + structured task list to the-team-lead | Cron: Sundays 7am PT; on-demand any time Adam asks | Autonomous (report + task list only; spend decisions route to Adam via the orchestrator) |

Charter and mandate: the agent's local `CHARTER.md` (operating spec, Adam-reviewed). Live cron verified 2026-07-05 via `cortextos bus list-crons the-ad-strategist`.
