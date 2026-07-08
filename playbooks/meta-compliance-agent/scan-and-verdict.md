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

## Comms

One digest per scan run, never per-finding spam; clean/idle scans stay silent; loop the orchestrator on rule changes and fleet-wide patterns; confirm + loop before acting on any real decision (rule change / gate override).
