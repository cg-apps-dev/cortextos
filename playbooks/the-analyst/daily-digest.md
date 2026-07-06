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
2. **Pull the throughput lead**: read the latest `workspace/throughput-series.jsonl` row (produced by [throughput-snapshot.md](throughput-snapshot.md) at 5:30am). LEAD with production-complete week-to-date vs the 100/week target + QC queue depth (the bottleneck) + which lane is the choke. If no scripted snapshot ran yet, say "pending true T0" - never improvise the number.
3. **Then fleet health** (read-all-heartbeats), overnight errors/anomalies, tasks completed/blocked, and any [HUMAN] asks.
4. **Flag GAP days** (missed snapshots) explicitly.
5. **Mondays**: also produce the full weekly throughput snapshot naming the binding bottleneck.

## Style rules

Tight, skimmable, casual/technical, number-first. Times in PT. No em dashes.
