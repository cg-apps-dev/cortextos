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
   - **Triage, do not just remind**: each cycle, convert 1-2 CARRIED items with a cheap owner-routed premise-check instead of re-copying them. This cron is the primary executor of the fleet method - see [owner-premise-check-triage.md](../fleet/owner-premise-check-triage.md).
3. **ACK** any approval/human-task inbox messages.

## The two mechanisms (fleet-wide)

- **Approval** = the agent CAN do the action but needs permission (categories: external-comms, financial, deployment, data-deletion, other). Rules: create the approval BEFORE the action (never act-then-ask-forgiveness); block the task on the approval ID; never assume approval without an inbox confirmation; one re-ping max, then wait.
- **[HUMAN] task** = the agent CANNOT do it (needs human capability). Three required routing signals: title starts with `[HUMAN]`, `--assignee human`, `--project human-tasks`. Create within one heartbeat of discovering a human-dependency blocker, or it's an invisible blocker.

## New-approval notification cadence (default + consolidation-day exception)

**Default (unchanged):** a new approval notifies Adam immediately via Telegram + creates a dashboard item.

**Consolidation-day exception (added 2026-10-04, ratified with security-agent):** route a new approval through dashboard-item + the next scheduled Adam brief INSTEAD of a direct Telegram ping ONLY when all three hold: (a) not time-critical inside ~24h, (b) a scheduled Adam-facing brief lands before the decision window matters, (c) not a confirmed security finding or active incident. Any doubt -> immediate ping.

This trims avoidable drip on days Adam already has consolidated messages WITHOUT hiding the approval - it still lands as a dashboard item and surfaces in the brief, so the decision window is never missed and nothing is suppressed. The exception never applies to a confirmed security finding or an active incident (those always ping immediately).

Live specimen (the case that produced this rule): a wake-gate deploy approval protecting the next day's 02:35 PT window (decision window ~2am) was pinged directly on a day Adam had already received 3 consolidated messages. All three conditions held - not time-critical inside ~24h, a scheduled Adam-facing brief landed before the ~2am window mattered, and it was a deploy rather than a security finding or active incident - so the direct ping was avoidable drip the dashboard item + brief would have carried without loss.

## Note

The check-approvals cron reminds on approvals pending >1h; the approvals skill's own re-ping threshold is 4h - the cron is the tighter fleet-level nudge.

## Hand-offs

Reminders route to Adam via Telegram + dashboard. The human-tasks skill also notifies the orchestrator so blockers surface in the next [morning](morning-review.md)/[evening](evening-review.md) review.
