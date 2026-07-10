---
type: playbook
agent: the-axon-agent
process: axon-analytics
pipeline_stage: 2 (measure)
status: active
date: 2026-07-10
tags: [playbook, axon, applovin, analytics, performance]
---

# 02 - Axon Analytics (phase 1: asset-level performance feed)

The Axon-internal per-creative performance read. This agent owns Axon ops + Axon-internal analytics; the-ad-strategist keeps cross-platform strategy and CONSUMES this feed. Phase 1 is LIVE (since 2026-07-07); phase 2 (the prize) is staged behind an acceptance gate, deliberately not built yet.

Derived from the executing spec: `skills/axon-analytics/axon_perf_feed.py` in the agent's local (untracked) skills dir.

## Phase 1 - LIVE: asset-level cost/impressions/clicks

- **Source**: AppLovin Asset Reporting API - `GET https://r.applovin.com/assetAnalyticsReport` with `AXON_REPORTING_KEY` (org secrets), columns `asset_name,creative_set,cost,impressions,clicks`, JSON.
- **Shape**: `{results:[...], count}` - asset-name rows grouped into creative sets (a 14-day pull at go-live: 961 asset rows, 67 creative sets).
- **On demand, not cron**: run when the strategist's weekly report or an Adam question needs a per-creative Axon read. The asset NAME is the join key back to the Axon Ads Upload Sheet rows ([01-axon-intake.md](01-axon-intake.md) writes them).
- **What phase 1 cannot say**: revenue and new-customer attribution. The Asset Reporting API carries no revenue; campaign-level revenue lives in the separate `/report` endpoint only. Never present a phase-1 read as a value/CAC statement.

## Phase 2 - staged, NOT built: per-creative new-customer attribution

Per-creative `new_customer_orders` + revenue via `AXON_EVENT_KEY` + `AXON_STORE_ID` attribution. **Acceptance gate (hard):** the per-creative NC sum must reconcile to Triple Whale's account-level Axon NC before ANY per-creative NC number ships. Until that reconciliation passes, phase-2 numbers do not leave the agent.

## Hand-offs

- the-ad-strategist consumes the feed for the weekly report's Axon view.
- Adam gets Axon performance answers grounded in phase-1 fields only, with the no-revenue caveat stated, until phase 2 clears its gate.
