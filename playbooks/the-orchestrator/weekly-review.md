---
type: playbook
agent: the-orchestrator
process: weekly-review
status: active
date: 2026-07-07
tags: [playbook, orchestrator, review, weekly, fleet]
---

# Weekly Review

The orchestrator's Sunday fleet-wide review: aggregate the week across all agents, evaluate performance, and plan the next week with Adam. Fires Sundays 8am PT (cron `weekly-review`); also on request. ~15-30 minutes including Adam interaction. Derived from `.claude/skills/weekly-review/SKILL.md`.

## The sequence

1. **Phase 1 - Data aggregation**: pull the last 7 days of memory files, all tasks + completed tasks, heartbeats, GOALS.md, org goals.json, inbox.
2. **Phase 2 - Present to Adam** using the review template:
   - AGENT PERFORMANCE (+ Fleet Health: agents online X/N, agents stale >5h)
   - PRODUCTIVITY
   - GOALS PROGRESS
   - ORCHESTRATOR SELF-EVALUATION: score 1-10 across the 5 dimensions (Usefulness, Proactivity, Coordination, Communication, Learning), total /50
   - SYSTEM IMPROVEMENT PROPOSALS (`[P1] [Category]` + agent-capability gaps)
   - NEXT WEEK
3. **Phase 3 - Interactive discussion**: ask Adam four questions - what went well, what was challenging/frustrating, any priority changes, any new agents/capabilities needed.
4. **Phase 4 - Update state**: write persistent learnings (new patterns, preferences, system behaviors) to MEMORY.md; log `briefing_sent`, heartbeat, the Weekly Review memory block.

## Notes

- Self-eval scale is 1-10 / total 50 here (vs 1-5 / 25 in the [evening review](evening-review.md)).
- Improvement proposals name an assignee but this review plans - it doesn't dispatch.
- [weekly-optimization.md](weekly-optimization.md) runs Sunday after this review (the fleet token/bloat audit).

## Hand-offs

Primarily to Adam (chunked Telegram + interactive discussion); planned items and proposals feed the coming week's morning reviews.
