---
type: playbook
agent: the-orchestrator
process: approvals-and-human-tasks
status: active
date: 2026-07-07
tags: [playbook, orchestrator, approvals, human-tasks]
---

# Approvals and Human Tasks

The orchestrator's recurring chase on things waiting for Adam: pending approvals and [HUMAN] tasks. Fires every 2h (cron `check-approvals`, critical). Derived from the cron prompt + the fleet approvals and human-tasks skills.

## The sequence (every 2h)

1. **Pending approvals**: `cortextos bus list-approvals --format json` - for any approval pending older than 1h, send Adam a Telegram reminder.
2. **[HUMAN] tasks**: `cortextos bus list-tasks --status pending --format json | jq 'map(select(.project=="human-tasks"))'` - for any [HUMAN] task pending >4h, send Adam a Telegram reminder with the title and what's blocked.
3. **ACK** any approval/human-task inbox messages.

## The two mechanisms (fleet-wide)

- **Approval** = the agent CAN do the action but needs permission (categories: external-comms, financial, deployment, data-deletion, other). Rules: create the approval BEFORE the action (never act-then-ask-forgiveness); block the task on the approval ID; never assume approval without an inbox confirmation; one re-ping max, then wait.
- **[HUMAN] task** = the agent CANNOT do it (needs human capability). Three required routing signals: title starts with `[HUMAN]`, `--assignee human`, `--project human-tasks`. Create within one heartbeat of discovering a human-dependency blocker, or it's an invisible blocker.

## Note

The check-approvals cron reminds on approvals pending >1h; the approvals skill's own re-ping threshold is 4h - the cron is the tighter fleet-level nudge.

## Hand-offs

Reminders route to Adam via Telegram + dashboard. The human-tasks skill also notifies the orchestrator so blockers surface in the next [morning](morning-review.md)/[evening](evening-review.md) review.
