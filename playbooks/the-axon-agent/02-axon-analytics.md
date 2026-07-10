---
type: playbook
agent: the-axon-agent
process: axon-analytics
pipeline_stage: 2 (measure)
status: active
date: 2026-07-10
tags: [playbook, axon, applovin, analytics, performance]
---

# 02 - Axon Analytics (phase 1: creative_set-grain performance feed)

The Axon-internal per-creative performance read. This agent owns Axon ops + Axon-internal analytics; the-ad-strategist keeps cross-platform strategy and CONSUMES this feed. Phase 1 is LIVE (since 2026-07-07); phase 2 (the prize) is staged behind an acceptance gate, deliberately not built yet.

Derived from the executing spec: `skills/axon-analytics/axon_perf_feed.py` in the agent's local (untracked) skills dir.

## Phase 1 - LIVE: creative_set-grain spend + engagement

- **Source (fixed 2026-07-09 - the load-bearing line)**: `GET https://r.applovin.com/report` with `report_type=advertiser`, columns `creative_set,cost,impressions,clicks`, `AXON_REPORTING_KEY` (org secrets). **WARNING - the prior source was wrong at the money level**: `assetAnalyticsReport` sums cost per ASSET and double-counts each creative_set ~1.96x; never sum its cost rows for a creative_set total. Reconciliation proof for the fix: `/report` 30d spend $78,066 ties to Triple Whale's account-level ~$77,960/30d (99.9%); the old asset-sum implied ~$152k/30d - impossible.
- **Shape**: creative_set rows (~89-104 in a 30d window at go-live of the fixed feed) with cost, impressions, clicks, CTR (engagement columns added 2026-07-09 for the strategist's re-rank).
- **On demand, not cron**: run when the strategist's weekly report or an Adam question needs a per-creative Axon read. The creative_set name joins back to the Axon Ads Upload Sheet rows ([01-axon-intake.md](01-axon-intake.md) writes them).
- **What phase 1 ships vs withholds**: the live feed ships spend + engagement ONLY. Per-creative REVENUE is now sourceable (`total_rev_7d/14d/30d` on `/report`, found 2026-07-08) but is deliberately STAGED in `axon_perf_feed_v2.py` pending Adam - not in the live feed. New-customer attribution needs the event/store keys (phase 2). Never present a phase-1 read as a value/CAC statement.

## Phase 2 - staged, NOT built: per-creative new-customer attribution

Per-creative `new_customer_orders` + revenue via `AXON_EVENT_KEY` + `AXON_STORE_ID` attribution. **Acceptance gate (hard):** the per-creative NC sum must reconcile to Triple Whale's account-level Axon NC before ANY per-creative NC number ships - concrete 30d target from the strategist's TW pull: 254 NC / $38,202 NC-revenue. Until that reconciliation passes, phase-2 numbers do not leave the agent.

## Hand-offs

- the-ad-strategist consumes the feed for the weekly report's Axon view.
- Adam gets Axon performance answers grounded in phase-1 fields only (revenue staged, not shipped), until phase 2 clears its gate.
