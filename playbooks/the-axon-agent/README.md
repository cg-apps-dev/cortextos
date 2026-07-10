---
type: index
agent: the-axon-agent
status: active
date: 2026-07-08
---

# The Axon Agent - Playbooks

Plain-English SOPs for the Axon / AppLovin side of Clean Green's ad system. The Axon agent owns two halves:

1. **Ops / pipeline** - ingest ClickUp Pod-3-Axon cards into the Axon Ads Upload Sheet (mirrors the Meta Ad Upload sheet, Axon-specific columns, one row per finished 9x16 creative). This is live and documented below.
2. **Analytics** - the per-creative Axon performance read that feeds the-ad-strategist for cross-platform synthesis. Phase 1 (creative_set-grain spend + engagement via the AppLovin /report API; source fixed 2026-07-09 off the double-counting asset endpoint) is LIVE and documented below; phase 2 (per-creative new-customer attribution, the read Triple Whale is blind to) is staged behind a hard reconciliation gate and deliberately not built yet.

Each playbook distills the matching `skills/<name>/SKILL.md` in the agent's local skills dir - the skill stays the technical spec the agent executes; the playbook is the readable how-and-why.

| # | Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|---|
| 01 | [01-axon-intake.md](01-axon-intake.md) | All-boards Axon creative detection (file-signal + Flower gates), parse 9x16 creatives, write rows to the Axon Ads Upload Sheet (header-resolved, render-gated, draft-safe) | Daily all-boards sweep 6:30am PT (cron `axon-daily-sweep`) + on demand | Autonomous (sheet only; never launches) |
| 02 | [02-axon-analytics.md](02-axon-analytics.md) | Phase-1 creative_set-grain performance feed (AppLovin /report: spend, impressions, clicks, CTR per creative_set) consumed by the-ad-strategist | On demand (weekly-report pulls, Adam questions) | Autonomous read-only; phase-2 NC numbers gated until TW reconciliation passes |

## Staged, deliberately not built (phase 2)

- **Per-creative new-customer attribution** via `AXON_EVENT_KEY` + `AXON_STORE_ID` - the hard acceptance gate (per-creative NC sum must reconcile to Triple Whale's account-level Axon NC) is defined in [02-axon-analytics.md](02-axon-analytics.md); no per-creative NC number ships until it passes.

## Cross-platform join key

The `Concept #` (UGC#NN) and `Axon Creative Code` columns on the Axon sheet are the stable join key that lets Axon and Meta creative rollups line up. [the-ad-strategist](../the-ad-strategist/README.md) consumes this for the cross-platform layer.

## Relationship to Meta

The Axon intake engine is a fork-and-invert of the Meta intake engine, so the discipline mirrors [meta-ads-agent](../meta-ads-agent/README.md): header-resolve live, render-gate on the 9x16 thumbnail, file-ID dedup, deterministic card resolver, draft-safe. The inversion is the platform filter (Axon-only where Meta excludes Axon) and the 9x16-only ratio gate.
