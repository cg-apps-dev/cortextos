---
type: playbook
agent: the-analyst
process: throughput-snapshot
status: active
date: 2026-07-05
tags: [playbook, analyst, throughput, clickup, metrics]
---

# Throughput Snapshot + Flow Metrics

Makes the ad-production pipeline's binding bottleneck (QC) visible as numbers. Daily 5:30am PT cron; the 7am [daily digest](daily-digest.md) reads its output. Executable spec: the agent's `.claude/skills/throughput-snapshot/SKILL.md` (local); scripted capture: the agent's `scripts/throughput-capture.sh` (local, untracked - flagged).

## Design: snapshot + diff

ClickUp's historical status-timestamp feature wasn't available at design time, so the method is: capture a **durable dated snapshot** of every card's status across all 5 Ads System lists daily, then **diff consecutive snapshots** - day-over-day transitions ARE the flow metrics. Snapshots (`workspace/snapshots/<date>.json`) are the source of truth and never deleted; the flow series appends to `workspace/throughput-series.jsonl`.

## The sequence

1. **Scripted capture** (paginate all 5 ClickUp lists via REST, outside model context; sources the org secrets, never echoes the token). Retries with backoff on API 502s; if any list fails all retries the snapshot is marked incomplete.
2. **Map statuses to macro-stages** by keyword (brief, qc-brief-gate, production, qc-output-gate, rework, ship_ready, killed, flagged_ops) - keyword matching survives board renames; unmapped statuses are counted as data-quality noise, not guessed.
3. **Diff vs the most recent prior COMPLETE snapshot**: production-complete (cards newly entering ship_ready), QC pass rate (forward vs rework exits), rework events, QC queue depth (point-in-time stock).
4. **GAP handling**: a missed day or an incomplete snapshot marks the interval a GAP - transitions span the gap and are flagged, never dumped onto one day.
5. **Append the flow row** and log anomalies.

## Standing measurement disciplines (each learned from a real incident)

- **Gross vs net on the QC queue**: the queue is a stock fed by intake and drained by clearance. Always report gross-cleared + intake + net change together - a flat/rising queue with high gross-cleared means QC is working under heavy intake, not failing. Never let Adam read "queue up = QC broken."
- **Structural-break detection**: a bulk status migration or board cleanup mimics real flow. Large single-stage shifts or mass-appearing statuses mark the row STRUCTURAL_BREAK, reset the clean-flow baseline, and are never reported as organic work.
- **Dwell has survivorship bias**: time-in-current-status measures only cards still stuck - say "cards currently stuck in QC have sat N days," never "every ad waits N days." And a bulk migration resets every dwell clock (near-uniform dwell across stages = invalid, re-accruing).
- **Kill-rate by gate, never blended**: a kill at brief-QC is cheap and healthy; a kill at asset-QC means paid production died. Report the split.
- **flagged_ops is operational, not QC**: the Agent Flagged status marks handoff defects (wrong/empty Drive folders, missing assets) - its own bucket, excluded from QC depth, tracked as a handoff-completeness metric tied to named owner fixes.
- **Per-person attribution is only as good as the assignee field** - stage-level metrics are reliable; per-person claims are labeled provisional until assignment hygiene holds.

## Per-gate WIP flow (qc-flow-diff, standing step since 2026-07-08)

The capture script also writes a per-card **card_list map** (forward-only; live in production snapshots since 2026-07-09), and `scripts/qc-flow-diff.py` (local, untracked - flagged) reads two consecutive snapshots to isolate a single gate (default `static_image_ads`) and output measured gross inflow / clearance / net change with a precision label. Folding this diff into the daily snapshot processing is a standing step, so per-gate flow accrues automatically. When either snapshot predates the card_list map, the script falls back to fleet-wide numbers and says so - it never silently reports wrong-scope.

## The join key worth knowing

AdManage ad names encode the ClickUp brief ID (`...ID=<taskid>...`), joining ad performance to brief to owner - the seed of the "winning ads feed next week's briefs" loop, and the same key the-ad-strategist's [weekly report](../the-ad-strategist/weekly-report.md) relies on.
