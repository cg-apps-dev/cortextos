---
type: playbook
agent: the-team-lead
process: monday-forward-look
status: active
date: 2026-07-07
tags: [playbook, team-lead, forward-look, recommendations]
---

# Monday Forward-Look

Suggested focus / recommended per-person tasks for the week ahead, delivered to Adam before he finalizes and sends the team's weekly tasks. Fires Mondays 7am PT (cron `monday-review`). North star: toward 100 ads/wk. Distinct from the [Sunday retrospective](sunday-retrospective.md) (which is backward-looking).

## The methodology (versioned, under test)

Loaded from `experiments/surfaces/review-usefulness/current.md`. Goal: make the per-person recommendation so complete and well-aligned that Adam can ship it with minimal edits. Measured by adoption rate (recommended tasks Adam assigned / total recommended) and, the real lever, the count of items Adam ADDED that weren't proposed (closable completeness gaps, not Adam-originated creative direction).

## The approach

1. **Express targets in briefs x ~6 hooks**, not raw ads ("N briefs (X/avatar) ≈ N×6 ads" per producer).
2. **Set explicit per-lane volume** off each person's real recent velocity + the weekly goal - don't under-scope. Exact attribution is live for the video lane (via the-analyst); others as backfill lands.
3. **Include the 3 standing production rules by default** in every producer block: own briefs + assemble all assets into the Drive folder; create the full 11Labs VO + drop in the folder; use existing b-roll + outline new b-roll to JoinBrands.
4. **Tag every brief with its customer avatar + product category** (Adam requires this).
5. **Carry forward CONTINUED items + any recurring item Adam added last week.**
6. **Proactively flag conflicts / brand-voice reversals** - surface the decision, don't silently execute.
7. **Phrase as suggested focus for Adam to assign** - never directives to the team.

## Sources + hard rules

Read EOW from the LIVE #marketing threads (not the lagging agenda doc); pull numbers FROM the-analyst (don't recompute).

## Output + hand-off

Brief, no-emoji suggested focus to Adam via Telegram. **Record exactly what was recommended to `experiments/recommendations/`** so the review-usefulness experiment (Tuesdays) can compare it against what Adam actually assigns and sharpen the methodology.
