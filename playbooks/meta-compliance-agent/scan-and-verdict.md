---
type: playbook
agent: meta-compliance-agent
process: scan-and-verdict
status: active
date: 2026-07-07
tags: [playbook, compliance, meta, scan, verdict]
---

# Scan and Verdict

How a Meta-bound asset is scanned and stamped with a compliance verdict. Dispatched (not polled) - the orchestrator or meta-ads hands a row range or ID set. Derived from IDENTITY.md, the onboarding compliance primer, and the verdict-scoping doc.

## The governing standard

**100% certainty.** A PASS is returned only when the asset is certain to be clean. Real doubt = UNCLEAR or FAIL, never a hopeful PASS. "Probably fine" is not a PASS.

## The two layers (both must pass)

- **Deterministic layer**: a literal word/pattern scan against the banned-terms list. A hard-banned term = automatic FAIL.
- **Semantic/visual layer**: judgment reading for what a word-scan can't catch - a health implication with no banned word, a before/after arc, a personal-attribute framing, a cannabis-coding visual gestalt. **A clean grep is NOT compliance** - both layers must pass.

## The three surfaces (each scanned independently)

A col-B verdict is a claim about the COPY surface only. The on-creative baked text (OCR/vision) and the spoken VO (whisper transcript) are separate surfaces with their own scans. A launch-clear requires a verdict on every surface the ad ships. **For video, the AUDIO is the source of truth** - a "re-recorded/superseded" label is a claim, not proof; the new VO must be re-transcribed and re-scanned.

## The sequence

1. **Intake to the tracker sheet** (each creative lands as a row: copy in the copy columns, asset linked - done by meta-ads).
2. **Scan two layers x the relevant surfaces**: deterministic grep against copy AND on-image/on-screen text (OCR + vision), plus the semantic/visual read; whisper the VO for video.
3. **Stamp the verdict in col B** (this agent is the SOLE writer of the "Meta Compliance Agent" column, worst-of across surfaces): `PASS` / `FAIL: <M-code> (<offending text>) -> <fix>` (pipe-separated for multiple) / `HOLD: <M-code> (<condition>) -> <fix>`. Empty = not yet scanned.
4. **Route**: only PASS rows are cleared; FAIL/HOLD/UNCLEAR/empty are all blocked from drafts. FAIL/UNCLEAR route back for a re-edit or an owner decision.

## Verdict meanings

- **PASS**: clears both layers on all surfaces. Cleared toward launch.
- **FAIL**: a hard-banned term or rule violation - must be re-edited at the source (a copy tweak often isn't enough; if the problem is on-screen packaging or a script premise, the creative itself changes).
- **UNCLEAR**: genuinely ambiguous or an Adam decision - held for a human ruling, never auto-passed.

## col-B verdict freshness (rebuilt / re-superseded cards)

Authoritative text from meta-compliance-agent (col-B rule owner), delivered verbatim 2026-07-09 - do not paraphrase when carrying this rule into other docs; link here instead.

col-B creative verdicts are stale-able in BOTH directions on rebuilt/re-superseded cards: a stale-PASS hides a live violation; a stale-FAIL wrongly blocks a clean rebuild (live-proven IMG_376: a 2026-06-26 ClickUp rebuild removed the on-creative flower/72h violations, but col-B still carried the old FAIL and wrongly gated 2 launchable variants).

RE-SCAN-ON-TOUCH IS MANDATORY. On any op that reads, copies, launch-gates, or supersedes a col-B verdict, re-verdict against the CURRENT sheet asset file-id(s); never trust the existing cell.

FRESHNESS CHECK (operational, file-id anchored): an existing verdict is trustworthy ONLY if it was computed against the CURRENT asset file-id. A rebuilt/re-superseded card carries a NEW file-id, so any verdict predating the rebuild is stale BY DEFINITION regardless of PASS or FAIL. If the current asset file-id differs from the verdicts basis, the cell is stale, re-scan before acting.

RE-VERDICT COVERAGE: native-vision + OCR + grep_verdict on the CURRENT asset; and for any VIDEO/VO asset the AUDIO is compliance truth, so whisper the CURRENT audio, never trust de-coded captions or a prior verdict (a re-supersede can change the VO while captions look unchanged).

NO bulk col-B operation may trust an existing verdict without this freshness check.

The col-B date label (e.g. "creative v2 2026-06-09 PT") is a SCANNER-VERSION string, NOT the scan date, never read it as recency/freshness.

## Comms

One digest per scan run, never per-finding spam; clean/idle scans stay silent; loop the orchestrator on rule changes and fleet-wide patterns; confirm + loop before acting on any real decision (rule change / gate override).
