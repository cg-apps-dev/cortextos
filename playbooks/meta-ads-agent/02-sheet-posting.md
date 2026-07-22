---
type: playbook
agent: meta-ads-agent
process: sheet-posting
pipeline_stage: 1 (intake - sheet side)
status: active
date: 2026-07-05
tags: [playbook, meta-ads, google-sheets, intake]
---

# 02 - Posting to the Upload Sheet

How rows physically land on the upload sheet. The MAIN sheet is "Meta Ads Upload" (`1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME`, renamed from "META - Ad Upload Sheet" 2026-07-21; four product tabs) - but as of 2026-07-21 it is not the only target: actor-specific cards route to their own standalone sheet instead (`IMAGES` + `VIDEOS` tabs only, no product suffix), resolved upstream in [01's actor-sheet routing](01-clickup-intake.md#hard-rules) hard rule 8. These write conventions apply to whichever spreadsheet the row lands on. The intake runner is the SOLE writer on any of these sheets; every write follows these conventions. Split from ClickUp intake per Adam (2026-07-05) so the sheet-write rules are independently editable.

Derived from: [brain: agents/meta-ads-agent/skills/clickup-intake/SKILL.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/skills/clickup-intake/SKILL.md) STEPs 4-6b + the intake engine (deterministic, dry-run-first, atomic writes). FLAG: the engine (engine.py) is local-only in the agent's untracked directory - no tracked copy exists to link; reference is by name.

## Hard rules

1. **Read the live header row immediately before writing, every time** (Adam hard rule). Map every value by header NAME, never a remembered or hardcoded letter - the four tabs do not share columns and the layout drifts. Missing/renamed header = halt that tab, write nothing, report.
2. **Write only intake-owned columns.** Never the copywriter's cells (avatar/funnel/copy), never `Ad Name` (a formula - one sanctioned exception below), never read-only/status/cache columns.
3. **Dedup on Drive FILE IDs** (content-level, not card-level). Re-runs never double-add. A card already partially present triggers the re-intake guard: fresh file IDs are never appended silently - explicit operator confirmation required for a real revision intake.
4. **Per-file sharing only** (Adam hard rule). Every asset file whose link lands on the sheet is individually link-shared (anyone-with-link, Viewer, not discoverable, Shared-Drive flag on). Never a folder or parent.
5. **Anti-clobber appends.** New rows land at write-time-verified empty rows, keyed live.

## The write conventions

1. **Fill the next empty formula row - never plain-append.** The `Ad Name` cell is a pre-dragged formula that computes from the input cells; appending below the formula block creates a row whose name never computes. If a tab has NO pre-dragged block (verify with a formula-render read, don't assume), replicate the canonical Ad Name formula from a filled row on that same tab into each new row - the one sanctioned Ad Name write. A blank Ad Name breaks the launch-tracker join ([06](06-launch-tracking.md)).
2. **ClickUp Card ID column = the full clickable card URL** (the Ad Name formula strips it to the bare ID; the custom Card-ID field is unreliable and never used).
3. **Asset links are direct file links** resolved per size from the card's Drive folder: images 1x1 + 9x16 per variant; videos 4x5 + 9x16 per finished video.
4. **Column-A preview on EVERY row** (Adam: "there should always be a preview of the ad"): `=IMAGE` of the 1x1 for images, of the 9x16 poster thumbnail for videos. Requires the per-file share first or the cell renders blank. Video thumbnails generate asynchronously after sharing - a blank video preview for a few minutes is lag, not an error, but it DOES block completion (render gate). DONE-WHEN: `intake_completeness_check.py` exits 0 (machine-checks col-A on every image AND video row - enforcement added after the 2026-07-08 miss; the prose rule alone did not hold on the manual path).
5. **`Added to Sheet` timestamp** (UTC ISO), set-once on every fresh row, never overwritten.
6. **Dropdown-validated columns** (Customer Avatar and any ONE_OF_LIST column): read the live validation rule for that tab and write an exact list member - never a bare name from memory, never copied from a neighbor row (neighbors can be uniformly wrong). Read back and assert every written value is a list member.
7. **Actor vision enrichment** (after rows land): classify the on-screen actor per ad from the actual creative (YOUNGER / OLDER / NO-ACTOR + gender; borderline = low-confidence flag for human confirm) and write the Actor Age Bracket + Gender columns. Feeds ad-set batching ([05](05-adset-batch.md)); NO-ACTOR rows are age-agnostic wildcards.

## Verification (feeds the completion gate in [01](01-clickup-intake.md))

- Read back every written row: fields present, Ad Name computed non-empty, asset links resolve, files shared.
- `=IMAGE` cells verify via formula-render read (the formatted read returns blank - a false negative); the rendered thumbnail verifies via the file's thumbnailLink metadata.
- Only an all-checks-pass write reports `all_ok` + `rendered` upward.

## Rate + tooling notes

- Respect Sheets quotas: batched full-range reads per tab, never per-row loops (429s under load).
- Row heights for preview rows (250px for 1x1, 350px for 9x16) are not writable via the current tooling - set via the sheet-bound Apps Script or manually.
