---
type: playbook
agent: cro-agent
process: weekly-cro-report
status: active
date: 2026-07-07
tags: [playbook, cro, conversion, reporting]
---

# Weekly CRO Report

Produces a weekly conversion-rate-optimization report for Adam: where conversion is trending, where it's leaking, and the highest-leverage moves to fix it, big levers first. Fires Wednesdays 9am PT (cron `weekly-cro-report`); also runnable on demand. Derived from the agent's `.claude/skills/weekly-cro-report/SKILL.md`.

## Hard rules

1. **Diagnose and propose, never ship.** Any change to a live conversion asset requires Adam's explicit approval; the report recommends and proposes tests, it does not deploy them. Implementation of approved changes is coordinated via the-orchestrator.
2. **Evidence, never guesswork.** Every number traces to a source tool; if a source is unavailable, the report notes the gap rather than estimating around it.
3. **Big levers first.** Offer optimization and major funnel/asset changes rank ahead of small tweaks.

## The sequence

1. **Check for same-day prep.** If a `reports/weekly-cro-prep-<date>.md` exists, a prior session already pulled the baseline and drafted opportunities - start from it and refresh rather than redoing.
2. **Create a task** for the report and mark it in progress.
3. **Pull the data**, comparing this week vs prior week(s)/baseline:
   - Triple Whale (moby MCP): site + store conversion rate, sessions, CVR by channel, AOV, revenue, funnel/checkout metrics, WoW trends.
   - Shopify analytics: store CVR, add-to-cart -> checkout -> purchase drop-off, top products, PDP/collection/checkout performance.
   - Microsoft Clarity: heatmaps + session recordings to locate friction, rage clicks, dead clicks, drop-off points.
   - The KB for prior CRO findings. Channel reads normalized via `reports/utm-source-normalization.md` (canonical source map); report channel composition freely, quote per-channel CVR under one attribution model only, always flag the unattributed/blank-source bucket.
4. **Diagnose and prioritize** every conversion asset by leverage (impact x reach x effort); lead with the big levers.
5. **Write the report**: trends vs last week (with direction + magnitude); what's working / what's leaking with evidence; ranked opportunities (lever, evidence, recommendation, expected impact, proposed test); and the single highest-leverage next test.
6. **Send to Adam** via Telegram (no emoji, skimmable, summary-first if long) and CC the-orchestrator the same content.
7. **Log and persist**: complete the task, log the event, write a daily-memory entry, and ingest the report into the KB so future reports can show longer trends.

## Hand-offs

- Adam gets the report and owns all live-asset go/no-go.
- the-orchestrator coordinates implementation of anything Adam approves.
