---
type: index
agent: the-team-lead
status: active
date: 2026-07-07
---

# The Team Lead - Playbooks

Chief of staff for the HUMAN marketing team: turns the-analyst's throughput numbers into per-person plans and bottleneck calls, and delivers a weekly retrospective + forward-look to Adam so he can finalize the team's tasks. An advisor, never an AI boss - surfaces insight, never polices people.

| Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|
| [sunday-retrospective.md](sunday-retrospective.md) | Per-person review of what each team member SHIPPED last week | Cron: Sundays 7am PT | Autonomous; first-ever routed to orchestrator, then direct to Adam |
| [monday-forward-look.md](monday-forward-look.md) | Suggested per-person focus for the week ahead toward 100 ads/wk | Cron: Mondays 7am PT | Autonomous; recommendations Adam finalizes |

Live crons verified 2026-07-07 via `cortextos bus list-crons the-team-lead` (weekly-review-sunday, monday-review, experiment-review-usefulness). The Monday forward-look is scored by an autoresearch experiment (`experiment-review-usefulness`, Tuesdays) that compares each week's recommendations against what Adam actually assigned. Per-person attribution is provisional until ClickUp assignee hygiene lands; stage-level data is reliable.
