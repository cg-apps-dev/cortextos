---
type: playbook
agent: the-team-lead
process: sunday-retrospective
status: active
date: 2026-07-07
tags: [playbook, team-lead, retrospective, per-person]
---

# Sunday Retrospective

A per-person review for Adam of what each marketing team member SHIPPED last week (Mon-Sun PT). Fires Sundays 7am PT (cron `weekly-review-sunday`).

## Sources (priority order)

1. **LIVE #marketing task threads** for end-of-week updates + the Team Analyst meeting notes for who-did-what (RELIABLE). Do NOT rely only on the weekly-agenda doc or dashboard.md - they LAG and may still show EOW as "pending" when updates are already posted in-thread.
2. **Throughput numbers FROM the-analyst** - do NOT recompute.
3. ClickUp pipeline.
4. Slack signal from the 6 in-scope channels.

## Hard rules

- Read EOW from the live threads, not the lagging agenda doc.
- Do not recompute the analyst's throughput - reference it.
- Flag per-person attribution as PROVISIONAL until the assignee fix lands.
- Only state Adam's actions with an in-channel citation.
- DEDUP with the analyst's ~7am digest: LEAD with per-person (this agent's lane), reference the bottleneck/headline as the analyst's with owners, acknowledge shared asks as a double-win, not a re-ask.

## Output + hand-off

A brief, no-emoji per-person retrospective to Adam via Telegram. **Route the FIRST-ever review to the-orchestrator for a sanity check; after the first, send directly to Adam.**
