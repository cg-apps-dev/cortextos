---
type: playbook
agent: meta-ads-agent
process: compliance-scan
pipeline_stage: cross-cutting (auto-runs after intake; also on-demand sweeps)
status: active
date: 2026-07-05
tags: [playbook, meta-ads, compliance, scan]
---

# 08 - Compliance Scan

Scans creatives and copy on the upload sheet against the Meta compliance ruleset and stamps the verdict (PASS / FAIL / UNCLEAR) into col B (`Meta Compliance Agent`). The stamp INFORMS Adam's post/no-post decision - it never blocks intake, never blocks copy, never holds a row off the sheet (Adam hard rules 2026-06-23 + 2026-06-30).

Derived from: the creative-compliance-scan skill - committed source in this repo at [community/skills/creative-compliance-scan/SKILL.md](../../community/skills/creative-compliance-scan/SKILL.md) (the agent's local copy executes; the community copy is the tracked source and the two must not drift). Runs automatically on every intake's new rows and on-demand for sweeps.

## Who owns what (the three-way split)

- **meta-compliance-agent defines the rules**: [brain: agents/meta-compliance-agent/references/rules.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-compliance-agent/references/rules.md) (M-1..M-25) is the single source of truth, read LIVE every run - never copied, restated, or cached (conventions.md Rule 9).
- **meta-ads-agent runs the scan** and stamps col B.
- **Adam gates posting** off the stamp.

## Hard rules

1. **The rules are not in this playbook and never will be.** Fresh brain clone + the mc-owned gate script every run; the term set is never re-derived locally.
2. **Copy source: the sheet cells, read live** - never a cached or reconstructed copy block.
3. **Deterministic-clean is not compliant.** The grep gate catches hard terms; the semantic layer (health claims, diagnostic questions, before/after, delivery-timing phrasings) catches what patterns structurally can't. A verdict needs both.
4. **For video, the AUDIO is the source of truth** - whisper the VO; de-coded captions can hide a spoken violation.
5. **Clobber-guard on col B** with evidence noted; verify writes by re-reading a per-row marker.
6. **Scan scope is per-run rows** (the rows just written), not whole-tab re-scans, unless a sweep is explicitly requested.
7. **col-B verdict freshness on rebuilt/re-superseded cards: re-scan-on-touch is mandatory.** Any op that reads, copies, launch-gates, or supersedes a col-B verdict re-verdicts against the CURRENT asset file-id - never trust the existing cell. The authoritative rule text (verbatim, mc-owned) lives in [meta-compliance-agent/scan-and-verdict.md](../meta-compliance-agent/scan-and-verdict.md), col-B verdict freshness section - do not restate it here.

## The sequence (deterministic pipeline)

1. **Task + announce + pull LIVE rules** (fresh clone of the brain).
2. **Resolve columns live by header** (halt on missing).
3. **Enumerate rows + creative file IDs** in scope, naming which spreadsheet they're on (2026-07-22): actor-specific cards live on their own standalone sheet, not always the main one ([01's actor-sheet routing](01-clickup-intake.md#hard-rules)) - the same row number can exist on more than one sheet, so "scope" means spreadsheet + row, never row alone.
4. **Extract text from three independent sources, unioned** per creative (never trust one extractor alone). DONE-WHEN: three extractor outputs exist per creative or the run halts loudly - a verdict is never computed from a partial union.
5. **Imagery flags** - the only vision-judgment step (packaging text, coded visuals).
6. **Deterministic grep -> preliminary verdict** per row - no guessing; then the semantic adjudication layer.
7. **Cross-check Meta's own verdict** where the ad already ran (free ground truth).
8. **Write col B** (clobber-guarded, evidence attached), verify by re-read, backfill misses. DONE-WHEN: every in-scope row's col B re-reads non-blank (PASS / FAIL / UNCLEAR with evidence) - rows-in-scope = rows stamped, zero empties left.
9. **Report** the verdict distribution; rejection-class findings follow the standing alert rule (any DISAPPROVED ad -> stamp + ping Adam immediately).

## Failure modes this design guards

- Stale rules (live-pull every run; the 2026-06 incidents where localized rule copies went stale are the origin of Rule 9).
- Extractor blind spots (three-source union; OCR failure = halt, never guess).
- Subagent row-index drift at scale (extractor / central-grep / writer split; per-row markers verified on the live sheet).
- Silent degradation (a malformed rules data file must fail loud, never fall back to a reduced last-known set).
