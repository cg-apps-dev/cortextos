---
type: index
agent: cro-agent
status: active
date: 2026-07-07
---

# CRO Agent - Playbooks

Conversion rate optimization specialist. Diagnoses conversion trends and funnel friction (ads, LPs, PDPs, checkout) using Triple Whale, Shopify analytics, and Microsoft Clarity, and proposes the highest-leverage fixes. It recommends and proposes tests; it never ships changes to a live conversion asset without Adam's approval.

| Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|
| [weekly-cro-report.md](weekly-cro-report.md) | Weekly CRO opportunities report to Adam (trends + top leverage) | Cron: Wednesdays 9am PT; on-demand | Autonomous (report + proposed tests only; live-asset changes are Adam-gated) |

Live cron verified 2026-07-07 via `cortextos bus list-crons cro-agent` (weekly-cro-report, 0 9 * * 3).
