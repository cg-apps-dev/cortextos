---
type: skill
agent: meta-ads-agent
skill: analysis
status: active
date: 2026-06-02
tags: [meta-ads, google-sheets, analysis, upkeep, pipeline-stage-5]
---

# Stage 5 — Analysis & Upkeep

You keep the META Ad Upload Sheet honest and answer "which ads are live in which accounts, and what is stuck?" Read-only against the sheet (and AdManage for cross-check) — you produce a report, you do not launch or overwrite creative/copy.

## CONFIGURATION
```
SPREADSHEET_ID = 1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME
```
Tabs + columns: [`../../meta-ad-copy-agent/references/column-maps.md`](../../meta-ad-copy-agent/references/column-maps.md). Account → tracking-column map: [`../../ad-launch-tracker-agent/SKILL.md`](../../ad-launch-tracker-agent/SKILL.md).

## WHAT TO REPORT

### 1. Coverage — which ads in which accounts
Across the 4 tabs, read the account tracking columns (the launch-date columns Stage 4 stamps). Summarize per account: how many ads launched, most recent launch date. This is the "which ads went to which ad accounts" view Adam wants.

### 2. Stuck rows (the pipeline-health flags)
Flag each row sitting between stages:
- **No asset** — row exists but the primary creative cell is empty (intake incomplete or a bad Drive link).
- **No copy** — asset present but the copy block is empty (Stage 2 hasn't run / failed).
- **Copy-ready, not drafted** — fully ready but no draft staged (Stage 3 hasn't run).
- **Drafted, not launched** — a draft exists in AdManage (`list_drafts`) but no launch date stamped → likely waiting on the operator's publish.
- **Launched, not stamped** — AdManage shows a successful launch (`list_activity_log`) but the sheet account column is empty → Stage 4 needs a re-run (or an ad-name match failed).

### 3. Data hygiene
Flag rows with a wrong-tab product (avatar/product contradicts the tab), a duplicate Ad Name on a tab, or an Ad Name that won't match AdManage (so Stage 4 can't stamp it).

## OUTPUT
```
## Meta Ads Pipeline — Upkeep Report ({date})
Coverage by account:
| Account | Ads launched | Latest launch |
Stuck rows:
| Tab | Ad Name | State | Suggested action |
Hygiene flags:
| Tab | Ad Name | Issue |
```
Send the report to the operator (and/or the orchestrator). Where a fix is mechanical and in-scope for another stage (e.g. "Stage 4 re-run will stamp these 3"), say so — but do not perform launches or overwrite copy here.

## RULES
- **Read-only on creative/copy.** This stage diagnoses; it does not launch or rewrite.
- **Cross-check, don't assume.** "Launched" comes from AdManage's activity log, not from a sheet cell alone.
- Use the light reads (`clickup_filter_tasks`, batched Sheets gets) — heavy reads 502 under load.

## TOOLS REQUIRED
- **Composio Google Sheets MCP:** read tabs.
- **AdManage MCP:** `list_drafts`, `list_activity_log` (cross-check drafted/launched state).
