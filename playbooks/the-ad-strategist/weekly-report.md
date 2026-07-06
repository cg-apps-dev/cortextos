---
type: playbook
agent: the-ad-strategist
process: weekly-report
status: active
date: 2026-07-05
tags: [playbook, ad-strategist, weekly-report, ncac, cbo]
---

# Weekly What-Is-Working Report

Fires Sunday ~7am PT (cron `weekly-report`), runnable on demand. Tells the team exactly what to do more of, what to hold, and what stops getting made (rejected angles) - driving 80% iterate-winners + 20% new tests. This playbook consolidates a process that previously lived across four artifacts; the executable spec remains `.claude/skills/weekly-report/SKILL.md` in the agent's directory, with the build log in `workspace/weekly-report-pipeline-NOTES.md` and the ranking engine at `workspace/ncac_tier_engine.py` (all local to the agent, untracked - flagged, no tracked copies exist).

## The metric model (locked with Adam + the-analyst, 2026-06-06; CBO update 2026-06-22)

- **PRIMARY: nCAC** (spend / new-customer orders). Adam thinks in CAC; band $220-240.
- **SECONDARY: new-customer ROAS** - the customer-VALUE check nCAC ignores.
- **CROSS-CHECK: FB-platform-reported ROAS** - a confidence flag, never a standalone metric. Agreement = trust the ad as a direct acquirer; TW much higher than FB = assist-inflated.
- **Breakeven derives from the REAL weighted new-customer AOV**, never the naive 1.0 (the naive number makes a healthy week look soft).
- **Significance gate**: spend >= $150 AND orders >= 3. A high ROAS on $40 spend is not a winner. Fewer than 3 new-customer orders = LOW-confidence label; a depressed-volume week gets a banner (patterns directional, not conclusive).

## The sequence

1. **Pre-flight data access.** Triple Whale (moby MCP, shopId `trycleangreen.myshopify.com` - the authoritative ID; a 403 means wrong shopId, not a dead key), Airtable warehouse, direct Axon API, AdManage (rejections). Any source down = noted in the report, never fabricated around.
2. **Pull the acquiring field on TWO 2-week windows** (current + prior; a single week hides acquirers that only clear across two). Rank by nCAC, not spend - by-spend hides cheap low-spend acquirers. Normalize raw ad names to concept names before feeding the engine.
3. **Tier with the CBO iterate-ranker** (`ncac_tier_engine.py`). Account context = CBO prospecting: the algorithm starves losers itself, so there are NO CUTS - this is a pure iterate-selection ranker, and nCAC is a ranking input, never a cut line. Tiers: **ITERATE** (3+ new customers current window AND acquired in the prior window = sustained), **MONITOR** (strong but new - hold one window before iterating), **INSUFFICIENT-N**. Rank volume-primary with nCAC visible co-equal; flag the cheapest acquirers as TOP-EFFICIENT so they don't get buried under expensive volume leaders.
4. **Extract patterns, not just top ads** - ITERATE-winners-only grouping across avatar x format x hook x writer x designer x angle. Two standing disciplines:
   - **Selection bias**: we mostly run X, so X recurs among winners - that alone is not signal. FB-cross-confirmation + magnitude beat recurrence count at low n; concentration is a RISK to flag with a counterfactual test, not a "winning pattern."
   - **Iterate the best HOOK, not the pattern mean**: pattern-level nCAC blends hooks, so a bad hook drags a good pattern's average - "iterate pattern X" always means its best-performing execution.
5. **Rejections analysis**: what got rejected and why; recurring rejection patterns feed meta-compliance so the team stops producing rejectable creative.
6. **Package for the-team-lead**: the structured task list - ITERATE winners with why (volume-ranked, nCAC visible, expensive ones caveated), per-person-assignable iteration briefs, MONITOR holds, the 20% new-bet counterfactuals, and rejected angles. NO stop/cut list ever (spend-side decisions route to the media buyer/Adam via the orchestrator, not the creative team). **Pin scope in the header** (accounts, exact window dates, floor, ranking rule, product scope) so week-over-week stays comparable.
7. **Close the loop**: task completed, report written + KB-ingested, nCAC snapshot banked, Adam briefed on Telegram with anything needing his decision.

## Hand-offs

- **the-team-lead** receives the structured task list and does all who/assignment.
- **meta-compliance-agent** receives the rejection-pattern brief.
- **Adam** gets the Telegram brief; product scope (e.g. flower-only) is his call and is pinned in the header when set.
