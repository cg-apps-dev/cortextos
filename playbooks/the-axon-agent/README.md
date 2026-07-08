---
type: index
agent: the-axon-agent
status: active
date: 2026-07-08
---

# The Axon Agent - Playbooks

Plain-English SOPs for the Axon / AppLovin side of Clean Green's ad system. The Axon agent owns two halves:

1. **Ops / pipeline** - ingest ClickUp Pod-3-Axon cards into the Axon Ads Upload Sheet (mirrors the Meta Ad Upload sheet, Axon-specific columns, one row per finished 9x16 creative). This is live and documented below.
2. **Analytics** - the per-creative Axon performance read (ROAS / new-customer via the AppLovin reporting API, the read Triple Whale is blind to) that feeds the-ad-strategist for cross-platform synthesis. This half is still being stood up (bottlenecked on AppLovin key provisioning); its playbook lands once the pipeline is live.

Each playbook distills the matching `skills/<name>/SKILL.md` in the agent's local skills dir - the skill stays the technical spec the agent executes; the playbook is the readable how-and-why.

| # | Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|---|
| 01 | [01-axon-intake.md](01-axon-intake.md) | Pull done Pod-3-Axon cards, parse 9x16 creatives, write rows to the Axon Ads Upload Sheet (header-resolved, render-gated, draft-safe) | Daily all-boards sweep 06:30 UTC + on demand | Autonomous (sheet only; never launches) |

## In development (playbook pending)

- **Axon analytics / per-creative perf feed** (goal 3) - per-creative Axon ROAS/NC via the AppLovin reporting API + Triple Whale moby + Airtable, handed to the-ad-strategist weekly. The `axon-analytics` skill is mid-build (research + a draft perf-feed script; no settled SKILL.md yet) and the AppLovin keys (`AXON_REPORTING_KEY` / `AXON_EVENT_KEY` / `AXON_STORE_ID`) are not yet provisioned. A playbook will be added here once the process is live and settled - documenting it now would pin a moving target.

## Cross-platform join key

The `Concept #` (UGC#NN) and `Axon Creative Code` columns on the Axon sheet are the stable join key that lets Axon and Meta creative rollups line up. [the-ad-strategist](../the-ad-strategist/README.md) consumes this for the cross-platform layer.

## Relationship to Meta

The Axon intake engine is a fork-and-invert of the Meta intake engine, so the discipline mirrors [meta-ads-agent](../meta-ads-agent/README.md): header-resolve live, render-gate on the 9x16 thumbnail, file-ID dedup, deterministic card resolver, draft-safe. The inversion is the platform filter (Axon-only where Meta excludes Axon) and the 9x16-only ratio gate.
