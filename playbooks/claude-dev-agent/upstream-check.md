---
type: playbook
agent: claude-dev-agent
process: upstream-check
status: active
date: 2026-07-07
tags: [playbook, dev, upstream, git]
---

# Upstream Check

A daily read-only check for upstream framework updates, notify-only. Fires daily 7am PT (cron `upstream-check`).

## The rule

READ-ONLY, notify-only - do NOT apply. Report incoming commits to the orchestrator; never auto-merge. (Incoming-change estimates use merge-base diffs, not two-dot - two-dot overstates on divergence.)

## Hand-off

Incoming commits reported to the-orchestrator, who decides whether/when to sync.
