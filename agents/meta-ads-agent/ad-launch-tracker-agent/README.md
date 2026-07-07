---
type: agent
status: active
date: 2026-05-15
tags: [agent, ad-tracking, meta, admanage, google-sheets]
---

# Ad Launch Tracker Agent

Syncs ad launch timestamps from AdManage.ai activity logs to the META Ad Upload Sheet. For each ad published through AdManage, stamps the launch date in the correct ad-account tracking column so the team can see at a glance which ads have been published to which accounts.

## What It Does

1. Pulls recent successful Meta ad launches from AdManage's activity log
2. Resolves each launch to individual ad names via batch status
3. Matches ad names to rows in the Google Sheet
4. Writes the launch date into the correct account column (only if empty - never overwrites)

## Schedule

Triggered manually by the operator. No autonomous schedule.

## Output

- Timestamps written directly to the Google Sheet tracking columns
- Summary report pasted to chat: how many launches processed, how many rows updated, any unmatched ads

## Dependencies

- AdManage.ai MCP (activity log, batch status)
- Composio Google Sheets MCP (read/write cells)

## Skill

- [SKILL.md](SKILL.md) - Full skill definition and instructions
