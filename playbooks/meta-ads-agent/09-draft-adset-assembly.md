---
type: playbook
agent: meta-ads-agent
executing_owner: meta-ads-agent
process: draft-adset-assembly
pipeline_stage: 3A-prep (curated candidate groupings, human-posted)
status: active
date: 2026-07-20
tags: [playbook, meta-ads, draft-ad-sets, curation, dropdowns, chips, template-clone]
---

# 09 - Draft Ad Set Assembly (Adam-template, repeatable)

Assembles curated groups of existing ads from the source tabs (VIDEOS/IMAGES Flower) into the **Draft Ad Sets** tabs of the Meta Ads Upload sheet, one block per target ad account, so Adam can review, pick LP/Ad Type via dropdown chips, and post each block as a new ad set in AdManage. Built 2026-07-19/20 with Adam; the live "Draft Ad Sets - IMAGES (Flower)" tab holds his hand-finished template cells - **the live tab IS the template. Every future build clones from it; nothing is ever rebuilt from scratch.**

Constants: spreadsheet `1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME` ("Meta Ads Upload", renamed from "META - Ad Upload Sheet" 2026-07-21). Sheet I/O via `gog` (`-a adam@cleangreen.com`); this agent is bearer (no Composio).

**MAIN-sheet only (2026-07-21).** Since the 2026-07-21 actor-sheet rollout ([01's routing rule](01-clickup-intake.md#hard-rules), hard rule 8), the actor-specific spreadsheets are cloned with `IMAGES` + `VIDEOS` tabs only - no `Draft Ad Sets` tabs exist there. This playbook applies to the MAIN sheet's own Flower groupings only, until/unless Adam asks for the same template built on an actor sheet.

## Inputs (per run)

1. Target accounts - one grouping/block per account (e.g. E-0681, E-0842, E-0828).
2. Customer avatar per grouping (groupings may share an avatar but must not share ads).
3. Date window on `Added to Sheet` (default: last 3 weeks).
4. Grouping size ~24 ads: ~10 video + 12-14 image.

## Hard rules

1. **FRESH-ONLY PER TARGET ACCOUNT** (Adam, standing): an ad already uploaded to account X (its per-account stamp column is non-empty, e.g. "Active - date" / "CAMPAIGN_PAUSED - date") is NEVER grouped for account X. Other accounts stay eligible. Stamp columns on both source tabs: E-0681=F, E-0842=N, E-0828=P (header-resolve for others).
2. **VISUAL QA, never name-based**: every candidate's preview is eyeballed (vision subagents) before selection sticks. Names lie (a "generic-named" creative was July-themed). Any content filter (seasonal, offer, actor) runs on pixels, not text.
3. **Demographic coherence**: each grouping skews YOUNGER or OLDER (intake vision cols; NO-ACTOR rows are wildcards) - never mixed. Segment-specific beats everyone-at-once for Meta purchase-sequencing.
4. **Funnel spread** ~7 TOF / 4 MOF / 3 BOF per 14-image block; diversity across hooks, angles, actors, design families.
5. **Zero overlap** between groupings that share an avatar.
6. **IGNORE COMPLIANCE WHEN SELECTING - HARD RULE (Adam verbatim, 2026-07-27):** "ignore compliance when selecting ads for ad groups. I will make the final compliance call before uploading. I do not want you to choose only ads that are marked as pass. You can also choose ads that are marked as unclear and failed when you are creating ad set group drafts." So: PASS, UNCLEAR, FAIL and HOLD rows are ALL eligible for draft groups; never narrow a pool to PASS-only (a 2026-07-27 build did exactly that and Adam corrected it). The col-B verdict (stamped by [08-compliance-scan](08-compliance-scan.md)) is copied VERBATIM onto every draft row so Adam sees each status when deciding. **Draft-row stamps are SNAPSHOTS at copy time** - if mc re-verdicts a source row after a block is built, the draft copy silently diverges; so before handing a block to Adam (and on any block he revisits later), RE-SYNC each draft row's col-B from its source row (the selection map records draft-row -> source-row). With no compliance filter upstream, the stamp is the entire interface Adam adjudicates from (mc, 2026-07-27) - a stale stamp is now a wrong answer delivered to the principal, not a cosmetic lag. Two couplings (mc, 2026-07-27): (1) mc BATCH re-verdicts move live stamps - mc warns before running a batch so the re-sync lands at a block boundary, not mid-decision; (2) a block Adam never revisits is never re-synced - acceptable for minor wording changes, but a MATERIAL verdict flip (PASS->FAIL or new hard-ban match) on an already-adjudicated block gets an explicit PING to Adam naming the rows, never a silent re-sync and never silence. Scope note: this governs draft-group SELECTION only - meta-compliance's launch-side holds (e.g. unadjudicated-UNCLEAR does not LAUNCH) still govern launch, which remains Adam's call.
7. **Header-resolve every column by name, every run.** Letters below are dated snapshots.
8. **GROUP HEADER ROW IS MANDATORY - HARD RULE (Adam 2026-07-27):** every grouping gets a header row DIRECTLY ABOVE its first data row, with the text in **column B** (not A - col A holds the date banners), format-cloned from an existing header row, 42px: `<ACCOUNT>   |   FCA = <AVATAR UPPERCASE>   |   <SKEW>   |   <N> IMAGES|VIDEOS` (e.g. `AliCG2   |   FCA = DAILY UNWIND   |   OLDER + NO-ACTOR SKEW   |   14 IMAGES`). A block without this header is INCOMPLETE (origin: the 2026-07-27 AliCG2 build shipped without it and Adam caught it). Also write the per-row group label into the `Draft Ad Set Group` column (last col: BE images / BI videos): `<ACCOUNT> | FCA=<Avatar> | <SKEW>-skew`.
9. **This playbook never launches anything.** Output = curated blocks on the draft tabs; Adam fills chips and posts. Same draft-only, human-gated boundary as [04-launch-draft](04-launch-draft.md) and [05-adset-batch](05-adset-batch.md) - this playbook only prepares the grouping, it never creates the AdManage draft itself.

## Adam's locked template decisions (2026-07-20)

| Column (images draft) | State agents must produce |
|---|---|
| Y Customer Avatar, Z FUNNEL STAGE | Verbatim from source row (values present) |
| AA Ad Type | Chip dropdown (Iteration / Imitation / Promotion / Ideation / Retention), **value left EMPTY - Adam picks** |
| AB LP | Chip dropdown (account+URL list), **value left EMPTY - Adam picks** |
| AC Homepage | Chip dropdown, **value filled `hp=home`** (standing default) |
| AD Landing Page URL | **NO dropdown.** Live formula `=IFERROR(REGEXEXTRACT(AB<row>,"https?://.+"),"")` every data row |
| Videos draft tab | Left as-is (old style) per Adam - do not "fix" it unasked |

## The chip lesson (why cloning, not building)

Google Sheets dropdowns have a display style - CHIP (visible grey pill even when empty) vs legacy ARROW (renders NOTHING on an empty cell). The style is UI-only: **invisible to and unsettable by the Sheets API, xlsx export, and Apps Script** (`showCustomUi=true` covers both). Validation built via API = arrow style = "the dropdowns are missing" on every empty cell, no machine check can catch it. Chip style DOES ride along with a NORMAL copy-paste from a chip cell. Therefore: **dropdown columns are only ever produced by NORMAL-cloning Adam's template cells** on the live images draft tab.

## The sequence

1. **Curate.** One bulk read per source tab (`gog sheets get` A1:BD2000, slice locally - per-row reads flake). Filter by window + avatar + fresh-only; apply coherence/spread/diversity/zero-overlap; run the visual QA pass on every candidate preview. Record the selection map (draft row -> source row). DONE-WHEN: every selected row passes fresh-only re-check and visual QA, counts match the input spec.
2. **Write rows.** Values verbatim via `batch-update --input=RAW` (RAW copies values only - formulas are deliberately NOT copied here; layers 3c/3d rebuild them). Block layout per tab: banner row above each block (light purple `#b4a7d6` full-width, unmerged, dark bold 13pt, 42px, account + grouping label), 2 spacer rows between blocks, header row frozen. Images-draft geometry precedent: blocks 3-16 / 20-33 / 37-50, banners 2/19/36, spacers 17-18/34-35.
3. **Rebuild each row in 4 layers, in this order:**
   a. Values (step 2).
   b. Formats: `copy-paste --type FORMAT` from each source row -> dest row. ~1 in 74 ops fails transiently - run 3 passes to full coverage. **PASTE_FORMAT WIPES data validation** - dropdowns must come AFTER this layer, always.
   c. Self-contained formulas: col-A Preview `=IMAGE("https://drive.google.com/thumbnail?id=<1x1-file-id>&sz=w1000")`, written USER_ENTERED.
   d. Row-relative formulas transplanted with row-number rewrite (regex the A1 refs source-row -> dest-row): Ad Name, and AD Landing Page URL (`=IFERROR(REGEXEXTRACT(AB<row>,"https?://.+"),"")`).
4. **Dims:** images rows 350px / header 80px / col A 220px; videos 340 / 72 / 176. (To re-derive from a source tab: scratch-copy the spreadsheet, delete all other tabs, clear values, export xlsx, parse row/col dims from the XML, then DELETE the scratch - the live sheet is too big for raw API dim reads.)
5. **Dropdowns + fills** (the template clone):
   - Source: the LIVE `Draft Ad Sets - IMAGES (Flower)` template cells (Adam-finished; currently row 3 of each dropdown column).
   - `gog sheets copy-paste` (default `--type NORMAL`) from the template cells onto each new block's column range. **EXACT-SIZE ranges only - tiling is broken** (a 10-row source on a 14-row dest leaves the bottom 4 bare). A 14-row block = two pieces (10+4).
   - NORMAL paste carries values too: capture dest values first, restore after via `batch-update --input=RAW` (values-writes do not damage validation). Empty template values landing on rows that should stay empty is fine - restore writes `""`.
   - Fill AC Homepage `hp=home` on every data row. Leave AA and AB values empty. Never touch AD with validation or values (formula lane).
6. **Verify (all gates must pass):**
   a. Value read-back: copied data byte-identical to the selection; collateral scan = 0 cells changed outside the write lanes.
   b. Rule check: scratch-copy -> prune to the draft tabs -> `gog sheets raw --include-grid-data` -> every data cell in every dropdown column has `dataValidation` present AND `showCustomUi: true`; delete the scratch. (Necessary but NOT sufficient - see c.)
   c. **Chip render check = Adam's eyes.** Machine checks cannot see chip-vs-arrow. Send Adam exact spot-check cells, chosen from the highest-risk zones (block-bottom rows, i.e. the +4 pieces). Not DONE until Adam confirms.
   d. Previews render: col A starts `=IMAGE` under FORMULA render (FORMATTED_VALUE reads "" - false negative) and the thumbnail URL curls 200.
7. **STAGED-GATE EMIT (gate-control build 2, MANDATORY, both-arms - added 2026-08-21).** Before handing off, run the staged-check against the SOURCE rows just staged (LIVE col-B on the source sheet - never the draft-tab snapshot, per col-B freshness):
   `python3 skills/meta-intake/staged_gate_check.py --sheet <source_ss> --tab "<source tab>" --rows <src_r1,src_r2,...> --batch-id "<draft-block label>"`
   It emits `action/staged_non_launch_ready` UNCONDITIONALLY (payload: count, row_ids, batch_id, sheet, tab; predicate = live launch-ready-predicate.json, fail-CLOSED to an error-emit). Candidate = staged row NOT launch-ready (canonical normalize: `^PASS\b` minus `DO NOT LAUNCH`) without an `[Adam accepted-risk]` marker. Expected 0; any nonzero = tell Adam which rows in the hand-off (his call to pull/keep - compliance stays his decision), and the-analyst alarms independently. One emit per block build; a run failure still emits (severity=error). Self-test after any edit: `--self-test`. mmb's launch-tracker owns the post-publish audit half (`creative_gate_enforcement_check`).
8. **Hand off + STOP.** Report blocks to Adam (accounts, counts, funnel/age mix, spot-check cells). Adam fills LP + Ad Type chips and posts each block as an ad set. Any subsequent "it looks wrong" report: get a screenshot or exact cell FIRST, fix precisely that - never re-run broad fixes on a vague report.

## Failure modes this playbook exists to prevent

| Failure | Guard |
|---|---|
| Dropdowns "missing" on empty cells despite passing API checks | Chip lesson: clone from template, verify via Adam's eyes (6c) |
| Bottom rows of blocks silently bare | Exact-size pastes only, spot-checks target block bottoms |
| Dropdowns wiped invisibly mid-build | Validation always AFTER format paste (3b -> 5) |
| Stale/wrong ads in a grouping | Fresh-only stamp check + visual QA (hard rules 1-2) |
| Formula columns clobbered with values | AD + Ad Name are formula lanes; layer 3d rewrites, layer 5 never touches them |
| Wrong-tab/wrong-sheet fixes | One spreadsheet (constant above); confirm tab NAME with Adam before any repair pass |
