# FINDINGS: me-com Fable overage runaway - unguarded bulk job (2026-08-21)

**Author:** the-analyst · **Incident window:** ~11:00-14:08Z · **Detection→stop:** ~9 min · **Status:** RESOLVED (culprit stopped, guarded on restart)

## One-line
A meta-ads bulk "Vision backfill" job spawned 3 parallel background agents that fast-looped on near-max-context **Fable** turns, burning me-com `extra_usage_credits` from a days-static 1359 to 23760 (~22.4k credits) in ~3h, accelerating to ~40k/h - while the me-com weekly Fable cap was already exhausted so **every** turn billed as overage.

## Timeline (extra_usage_credits, me-com-max)
- 1359 - **flat for DAYS** (Adam-personal baseline, fleet under the weekly cap → zero overage)
- 11:30 → 4947 · 12:30 → 6703 · 13:30 → 12540 · 14:01 → 21554 · 14:08 → 23760 (accelerating, intervals shrinking)
- Onset coincided with 7d% crossing ~91→94 (weekly Fable cap ~exhausted) + the 11:05Z fleet session-refresh respawn as the initial push.
- **Stop:** 3 background agents killed 14:05:34; `cortextos stop meta-ads-agent` (orch) 14:08Z. Slope broke immediately (cross-boundary confirmed flat).

## Root cause
Not a defect loop - an **unguarded bulk job**. meta-ads ran 3 background agents (vision backfill, row ranges 1937-2054), each re-reading a ~800k-token context every ~12s (121.7M input tok / 151 turns / 30 min). No cheap-model guard, no throttle, no cap-aware scheduling, running on Fable during a cap-exhausted window. A scheduling/guard gap, reproducible by any agent that spawns a bulk background fleet.

## Two methodological lessons (the transferable part)

### 1. A batch-held counter reads FLAT between updates - never call a trend from within one hold
`extra_usage_credits` updates in ~4-6 min chunks. Two reads 6 min apart both showed 6703, and I concluded "respawn burst decayed." **Wrong** - the next update jumped to 12540. The flat was a hold artifact, not a plateau.
- **Rule:** confirm a trend (or a flatten) across an **update boundary**, not within one hold. I later used exactly this to *confirm* the post-stop flatten (watched the counter cross 23273→23760→flat), which is the correct application.
- Generalizes the "manufacture the guaranteed counter-branch beat, then read the silence" discipline: a flat reading is only signal once an update was guaranteed to have landed.

### 2. When the cost DB is stale, the LIVE per-agent burn instrument is the session transcript
`dashboard/cost_entries` lagged ~15h (newest row 08-20T22:46Z) - useless for a live hunt. Real-time per-agent token burn lives in each agent's session transcript:
`~/.cortextos/<instance>/state/<agent>/claude-home/projects/*/*.jsonl` - sum `usage.{input,cache_read,cache_creation,output}_tokens` over entries with `timestamp > CUT`, per agent, most-recently-modified transcript.
- This produced the culprit in <5 min with an **evidence shape** (121.7M tok / 151 turns / ~806k-per-turn = 2× #2, ~8× #3), not just an ID - which is what a reversible stop should be authorized on.
- It also cleanly **ruled agents OUT** by number (orch 14.8M / 39 turns = ~8× below, normal shape).

## Prevention (proposed → coordinate with orch as a fleet standing-rule)
**Bulk-job hygiene** - any job that spawns background agents or iterates over a large work-list MUST:
1. **Model-guard** - run on the cheapest model that fits; never Fable/Opus for bulk mechanical passes.
2. **Throttle** - bounded concurrency + inter-item pacing; never N parallel max-context agents.
3. **Cap-aware scheduling** - do not launch when the account's weekly cap is near/at exhaustion; prefer off-peak.
4. **No-resume-without-go** - a killed bulk job does not auto-resume on `--continue`; it restarts fresh only with the guards in place (why meta-ads got a `.force-fresh` hard restart, not `--continue`).

## Structural note (so this incident is not misread as chronic)
Pre-incident overage was **~0 for days** (1359 flat, fleet under the weekly cap). The fleet does approach the cap late-week under legit load (7d ~90% by Friday), so a *small, bounded* late-week structural overage is real once the cap exhausts - but it is an order of magnitude below this runaway and it stops at the Sunday reset. The ~22k was a one-off, not a chronic 25-30pp/day engine. (An earlier chronic-rate estimate was contaminated by this then-unfound runaway and was corrected inline.)

## Comms
Single-voice held: everything routed through the-orchestrator; Adam received ONE consolidated message (found + stopped 14:08Z + ~22.4k-credit fleet cost, dominated-by-runaway framing + one $-calibration question). No second channel.
