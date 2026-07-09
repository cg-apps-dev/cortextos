---
type: playbook
agent: the-analyst
process: daily-digest
status: active
date: 2026-07-05
tags: [playbook, analyst, digest, reporting]
---

# Daily Digest (7am PT)

One tight, skimmable, number-first morning brief to Adam (Telegram) with the same content bus-messaged to the orchestrator. Cron `daily-digest`, daily 7am PT.

## The sequence

1. **Check the day's queue file first**: if `workspace/digest-queue-<today>.md` exists, it lists exactly what to surface (lead items, flags, asks) - prior sessions stage items there instead of interrupting Adam ad hoc.
2. **Pull the lead metric (changed 2026-07-09, orch-approved)**: LEAD with **POSTED ads week-to-date (>=75 video) vs the 200/wk target** (Adam-restated 07-06). Posted = ads launched-live this week PT, sourced from the Meta AdsUpload sheet launch-date column, cross-checked vs Paid Ads Mgmt / AdManage where available - state the source used and any caveat, and say "posted-source-wiring-pending" while the source is not yet wired into the snapshot (wiring tracked by the agent as a task).
3. **Second line: the CREATE-vs-POST gap** (create/wk = sheet rows-added, ~1 card = 6 ads; vs post/wk) - the QC-bottleneck story in one number (pipeline creates ~200, posts ~30-50, the gap is the QC queue). Then QC queue depth + which lane chokes, from the latest `workspace/throughput-series.jsonl` row (produced by [throughput-snapshot.md](throughput-snapshot.md) at 5:30am). Production-complete/ship_ready flow is RETIRED as the lead (transit-stage proxy, under-reads ~1/wk) - optional pipeline-health context only, never the headline.
4. **Then fleet health** (read-all-heartbeats), overnight errors/anomalies, tasks completed/blocked, and any [HUMAN] asks.
5. **Flag GAP days** (missed snapshots) explicitly.
6. **Mondays**: also produce the full weekly throughput snapshot naming the binding bottleneck.

## Style rules

Tight, skimmable, casual/technical, number-first. Times in PT. No em dashes.
