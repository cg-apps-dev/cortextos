---
type: skill
agent: meta-ads-agent
skill: clickup-intake
status: active
date: 2026-06-02
tags: [meta-ads, clickup, google-sheets, intake, pipeline-stage-1]
---

# Stage 1 - ClickUp Intake

You are the intake stage of the Meta Ads Agent. Your job: take every ClickUp card that is **`📤 ready to post`** (Meta platform) and write it as a new row on the correct tab of the META Ad Upload Sheet, with the ad name, the creative asset link(s), and the supporting metadata in the right columns - so Stage 2 (the copywriter) and Stage 3 (launch) have a complete row to work from.

You **only** write the intake-owned input/metadata columns. You never write the copywriter's columns (Customer Avatar, Funnel Stage, the copy block) and never touch read-only / status / cache columns.

---

## CONFIGURATION

### Google Sheet
```
SPREADSHEET_ID = 1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME
SHEET_NAME     = META - Ad Upload Sheet
```
Four product tabs: `IMAGES (Flower)`, `VIDEOS (Flower)`, `IMAGES (Sleep Gummies)`, `VIDEOS (Sleep Gummies)`.

### Column map - SINGLE SOURCE OF TRUTH
The exact per-tab column letters live in [`../../meta-ad-copy-agent/references/column-maps.md`](../../meta-ad-copy-agent/references/column-maps.md). **Read it every run; never hardcode a second copy here** - the four tabs do not share letters (v0.7.6 shifted flower +4, gummies +2) and the layout changes over time. The "Per-tab key column quick-reference" table in that file is the lookup you use.

### ClickUp (from column-maps.md → ClickUp integration)
```
Team ID  = 9017980898
Space ID = 90174501393
Lists: Video Ads 901711553702 · Static Image Ads 901711558014 · Pod 1 UGC 901711560388 · Pod 2 UGC 901712123770 · Pod 3 Axon 901712093295
```
Relevant ClickUp custom fields: `🪪 Card ID`, `📁 Drive Folder URL`, `Ad Platform` (Meta/Axon), `✍️ Brief Writer`, `🎨 Designer/Editor`, `Customer Avatar`.

---

## STEP 1 - Pull Ready-to-Post Meta cards
Use ClickUp `clickup_filter_tasks` (light payload - reliable under load; the raw list endpoint 502s) with:
- `list_ids`: the Video Ads + Static Image Ads lists (+ UGC pods if those feed Meta).
- `statuses`: `["📤 ready to post"]`
- `subtasks`: true

Filter OUT Axon cards - this is the **Meta** upload sheet; Axon launches are a separate flow. **The `Ad Platform` field is frequently blank in practice (verified on live cards 2026-06-02), so do not rely on it alone.** Exclude a card as Axon if ANY of: `Ad Platform = Axon`, the card name starts with `AXON`, or it lives in the `Pod 3 Axon` list. (Axon cards also tend to carry Axon/disclaimer-specific copy.) When all three signals are absent, treat as Meta.

## STEP 2 - Classify each card to a tab
- **Image vs Video:** from the source list. `Static Image Ads` → an `IMAGES (...)` tab. `Video Ads` / UGC pods → a `VIDEOS (...)` tab.
- **Flower vs Sleep Gummies:** from the card's `Customer Avatar` field - `Flower: *` → Flower tab; `Gummies > Deep Sleep: *` → Sleep Gummies tab. If the avatar is empty, infer from the product named in the card/title; if still ambiguous, **skip and log** (do not guess the product - wrong-tab rows are a hard error downstream).

## STEP 3 - Extract the row fields
From each card, collect:
- **Ad Name** = the card title (the launch tracker matches on this; keep it verbatim).
- **ClickUp Card ID column** = write the **full clickable ClickUp URL** `https://app.clickup.com/t/<taskid>` (verified on the live sheet 2026-06-02 - the sheet's `Ad Name` formula consumes this column, stripping the URL prefix to the bare ID, and it makes the cell a one-click link to the brief). **Do NOT use the `🪪 Card ID` custom field - it is unreliable (two different cards both showed `72073`).** Use the task ID for dedupe.
- **Creative assets** = resolve the per-size **file** links from the `📁 Drive Folder URL`. List the folder (Drive `search_files` with `parentId = '<folderId>'`) and match files by name prefix + variant: `1x1 - <CardName>_V<n>.jpg` → the **1x1** column, `9x16 - <CardName>_V<n>_vertical.jpg` → the **9x16** column (verified 2026-06-02). Write the **direct file link** `https://drive.google.com/file/d/<fileId>/view?usp=drive_link` (NOT the folder URL) into the matching asset column; `4x5` is usually left blank. This matches the existing-row convention (e.g. `IMG_414`).
- **Image variants → one row each.** An image card with V1/V2/V3 becomes **one sheet row per variant** (`Code` = `IMG_<n>_V1`, `_V2`, `_V3`), each row carrying its own 1x1 + 9x16 file links. Derive `<n>` from the card name (`MB_CG_IMG_413` → `IMG_413`).
- **Video cards → one row per FINISHED video** (Adam, 2026-06-02). Video folders nest finals in per-**actor** subfolders (e.g. `.../Finished/Helen/`, `.../Raymond/`), files named `<Card> - V## - <Actor> - Hook # - 9x16.mp4` (+ a matching `- 4x5.mp4`). Walk the actor subfolders and create **one row per finished video**: set `Variant #`, `Actor`, `Hook #` from the filename, and write **BOTH** the matching `4x5` AND `9x16` file links into that row (both required). One card can yield ~10 rows (actors × hooks); the team prunes unwanted ones. The VIDEOS tabs have extra input columns (`Variant #`, `Video Script`, `Actor`, `Hook #`, `Hook Type`) - read live headers and map by name. **Video rows DO get a column-A `=IMAGE` preview - using the 9x16 thumbnail** (Adam's always-a-preview rule; the mp4 itself doesn't render via `=IMAGE`, but Drive's auto-generated poster-frame thumbnail does): `=IMAGE("https://drive.google.com/thumbnail?id=<9x16 FILE ID>&sz=w1000")` - see STEP 6b.
- **Writer** = `✍️ Brief Writer`; **Designer** = `🎨 Designer/Editor`. **Both may be empty (verified 2026-06-02) - write blank and continue; never fail a card because a role field is unset.**
- **Customer Avatar** - note the field ID differs by list (Static uses field `a37ac6a9...`; Video uses `540604f2...`), each with its own option set. Resolve the avatar label against the correct field's options for that card's list.
- **Code / Variant #**, **Description / Video Script** where present on the card.

> **BUILD-TIME CONFIRM (asset mapping):** the sheet has separate `1x1` / `4x5` / `9x16` asset columns, but ClickUp gives one `📁 Drive Folder URL`. Confirm against a live example whether intake writes the folder URL into the primary asset cell (image primary = `1x1`; video primary = `9x16`) or resolves per-size file links from the folder. Until confirmed, write the folder URL into the primary asset cell and log the others as empty. Flag to the operator.

## STEP 4 - Read LIVE headers and map by header NAME (the doc drifts)
**The live sheet layout drifts and `column-maps.md` is a stale reference, not the source of truth** (verified 2026-06-02: a 5th "sister-winner" reference column was added to the flower tabs, shifting every column +1 vs the doc - e.g. Code moved G→H, ClickUp Card ID K→L, Ad Name R→S, 1x1 S→T). So: read row 1 of each target tab LIVE and map every write target by its **header name** (`Code`, `Description`, `Writer`, `Designer`, `ClickUp Card ID`, `Customer Avatar`, `1x1`, `4x5`, `9x16`, `Landing Page URL`, ...), never by a hardcoded letter. If an expected header is missing or renamed, halt that tab, write nothing, report.

## STEP 5 - Dedupe (re-EDIT vs re-EXPORT; Card-ID presence is the anti-double-add authority)
Two Adam hard rules meet here and MUST be reconciled per creative, never applied naively:
- **re-EDIT** = the team changed a creative or added a new variant → genuinely new content → intake the new creative(s) (Adam, 2026-07-09).
- **re-EXPORT** = the SAME creatives re-rendered → ALL file-ids change but nothing is actually new → do NOT intake. A naive file-id-diff re-intakes everything = the **2026-07-07 20-duplicate-row incident** (Adam CARD-ID PRESENCE hard rule, see meta-intake SKILL + [[reconcile-missing-fileid-false-positive]]).

**Card-ID presence is AUTHORITATIVE for anti-double-add.** A card already on the sheet is NEVER re-intaked wholesale, and a file-id "MISSING" list on an already-present card is a re-export false-positive to IGNORE. NEVER re-intake all of a present card's creatives on zero file-id overlap.

Decide what is GENUINELY NEW by **variant-identity** (Code / Variant # / Actor / Hook), NOT by file-id alone:
1. Enumerate the card's finished deliverables (NEWEST finished/re-edit subfolder only; Adam 2026-06-22).
2. Card-ID NOT on the sheet at all → brand-new card → intake every variant normally.
3. Card-ID already on the sheet → intake ONLY variant-identities not yet present for this card (a genuinely new V#/actor/hook = a re-edit that ADDED a variant). For those, dedup the specific creative by file-id.
4. Same variant-set already present, but file-ids differ (all-new ids, no new variant names, no newer re-edit subfolder) → **re-EXPORT false-positive → do NOT intake**; reconcile status only. If the card is stuck in `📤 ready to post`, **flag for human** (Leeza/Adam) to disposition (stale status, pending upload, or a re-edit-supersede).
5. A same-variant creative from a genuinely NEWER finished/re-edit subfolder = a re-edit **supersede** (new version replaces old). **DECOUPLE two actions (mc freshness rule, 2026-07-09):**
   - (a) **ROW disposition** (replace old row / add / skip) = **HUMAN** → do NOT create a duplicate row and do NOT auto-replace; flag for human.
   - (b) **col-B verdict must NOT wait for the human.** On supersede-detect the existing col-B is STALE BY DEFINITION (it was computed against the OLD file-id), and a bulk-op / launch-gate could wrongly trust it in the gap. So IMMEDIATELY either (i) re-scan against the NEW file-id (native-vision + OCR + grep_verdict; VIDEO/VO → whisper the NEW audio, a supersede often changes the VO while visuals/captions look similar) and write the fresh col-B, or (ii) if you cannot re-scan in-lane, STAMP col-B `SUPERSEDED <date> - col-B STALE, pending re-scan, do not trust`. NEVER leave a silently-stale, valid-looking verdict.

**WHEN IN DOUBT → FLAG for human. Never auto-intake on zero file-id overlap of an already-present card.** Do not key dedupe on the `🪪 Card ID` custom field (not unique - see Step 3), nor on Ad Name.

> Note (bearer/no-engine path): the engine encodes this (Card-ID presence check + RE_INTAKE_GUARD + file-id dedup). On the manual gog path replicate it: Card-ID-present + unchanged-variant-set + zero file-id overlap = re-export, SKIP+flag; only a genuinely new variant-identity gets intaked. (2026-07-09: IMG_376 was Card-ID-present with its full variant-set already on the sheet → correct outcome was skip; the earlier "always file-id-diff and intake new ids" wording was unsafe - it recreated the 07-07 re-export duplicate class.)

## STEP 6 - FILL the next empty formula row (do NOT append at the bottom)
The sheet uses **pre-filled formula rows**: the `Ad Name` cell is a formula already dragged down many rows that auto-builds the name from the input cells (incl. the `ClickUp Card ID` URL) + `TODAY()`. A plain append at the table bottom lands *after* the formula block, creating a row whose `Ad Name` never computes - **wrong**. Instead: locate the **next empty input row** within the formula block (inputs blank, `Ad Name` formula present) and write that row's input cells, matched by header name - `Code`, `Description`, `Writer`, `Designer`, **`ClickUp Card ID` = the full ClickUp URL**, and the asset cell(s) (`1x1` primary, plus `4x5`/`9x16` if resolved). Prefer Composio `GOOGLESHEETS_UPSERT_ROWS` keyed on the `ClickUp Card ID` header (idempotent, auto-maps by header, no letter math) or `GOOGLESHEETS_VALUES_UPDATE` on the located row. **Never write** the `Customer Avatar`, `FUNNEL STAGE`, the copy block, `Ad Name` (it is a formula - leave it), or any read-only/status/cache column - those belong to Stage 2 or compute themselves. Respect rate limits (≤60 reads/min, ≤60 writes/min). Connection: Composio Google Sheets, account `adam@cleangreen.com`.

### STEP 6 - FALLBACK: tab has NO pre-dragged formula block (verify before you assume one)
The "pre-dragged `Ad Name` formula" above is **not universal across tabs** - verify, don't assume (real case 2026-06-04: on `VIDEOS (Sleep Gummies)` the `Ad Name` formula existed in **rows 2-6 only**; the 53 existing data rows 7-59 had been appended **without** it, so their `Ad Name` was blank - no launch-tracker join key - and rows 60+ were empty with no formula).
- **Detect:** read the `Ad Name` column with `value_render_option=FORMULA`. If the formula does NOT extend into the empty rows below the data, there is no empty formula row to fill and STEP 6's model does not apply to this tab.
- **Then REPLICATE, don't leave-blank:** append your new rows at the first truly-empty rows, AND write the `Ad Name` formula into each new row's `Ad Name` cell by **copying the canonical formula from an existing filled formula row on THAT SAME TAB** (e.g. row 2) and rebasing its row numbers to the new row. This is the one sanctioned case where intake writes the `Ad Name` cell - because the formula isn't pre-dragged, replicating the established pattern is the faithful adaptation, not a violation. The formula-less alternative (blank `Ad Name`) breaks the Stage-4 launch-tracker join - never do that.
- **Use that tab's OWN column refs** - never carry another tab's letters into the formula (the four tabs do not share columns). Read the canonical formula live (FORMULA render) and keep its exact refs.
- **VERIFY before marking done:** confirm each replicated formula computes a valid `Ad Name` (correct stripped `ID=`, `TODAY()`, and the inputs you wrote) - read it back with the normal value render.
- **Latent-data note:** if you find existing rows with blank `Ad Name` (formula never dragged), do NOT bulk-backfill them inline during intake - flag it as a separate data-quality task (and skip backfilling rows that are killed/queued-for-removal; backfill only surviving active rows, post-cleanup).

## STEP 6a - Share each asset file (per-file, as you add it)
For **every** creative file whose link you write to the sheet, set it to **anyone-with-link / Viewer** so `=IMAGE` previews render and AdManage can fetch the media. Use Drive `GOOGLEDRIVE_CREATE_PERMISSION` with `type: anyone`, `role: reader`, `allow_file_discovery: false` (link-only, NOT searchable), **`supports_all_drives: true`** (the ad files live in a Shared Drive - without this flag you get a 404 `File not found`; verified 2026-06-02).
> **PER-FILE ONLY (Adam, hard rule).** Share ONLY the exact file(s) whose link you are pasting into the sheet. **NEVER** share a folder, a parent folder, or set folder-wide access. One permission per asset file, nothing broader.

## STEP 6b - Column-A image preview (ALWAYS, every image row)
**Every image row gets a preview** (Adam, 2026-06-02 - "there should always be a preview of the ad"). Both image tabs now have a `Preview` header in column A (Flower and Sleep Gummies). Write an in-cell image of the 1x1 creative into column A on EVERY image row - no per-tab exception. (Video rows: col-A =IMAGE of the 9x16 thumbnail - ALWAYS, same standing rule as image rows; the column-A preview is written regardless of that column's header label.)
```
=IMAGE("https://drive.google.com/thumbnail?id=<1x1 FILE ID>&sz=w1000")
```
(verified working 2026-06-02). **Prerequisite:** the creative file/folder must be link-shared (`Anyone with the link → Viewer`) - Google's image proxy can't fetch domain-restricted files, and the cell renders blank. Sharing the *sheet* does NOT help; the *image files* need it. Share each image **per-file** via Drive `GOOGLEDRIVE_CREATE_PERMISSION` (STEP 6a) - **never a folder/parent** (Adam's per-file-only hard rule).
**Row height for preview rows:** 250px for rows whose preview is the **1x1**; 350px for rows whose preview is a **9x16** (taller aspect). ⚠️ **Formatting is not writable via the current Sheets tooling** - there is no Composio wrapper for row height, and the raw Sheets API `batchUpdate` (`updateDimensionProperties`) is blocked for this connection (403 `ExternalProxy_OrgNotAllowed`). Set heights via a sheet-bound **Apps Script** (auto-size each row when its preview lands: 250 if 1x1, 350 if 9x16-only) or manually, until proxy/formatting access is enabled. Tab sheetIds: IMAGES (Flower)=1711671268, VIDEOS (Flower)=1214685724, IMAGES (Sleep Gummies)=491729225, VIDEOS (Sleep Gummies)=1313921284.
> **Verifying an `=IMAGE` cell via the API:** read it back with `value_render_option: FORMULA` - returns the literal `=IMAGE(...)` text and confirms the formula landed. `FORMATTED_VALUE` returns **blank** for an `=IMAGE` cell (a false negative, not a missing write); some reads return `#REF!`. Confirm the *formula* via FORMULA render; confirm the *rendered thumbnail* visually or via `get_file_metadata` `thumbnailLink`.
> **⚠️ Video-thumbnail async lag:** Drive generates a video's poster-frame thumbnail **asynchronously** after the file is shared. A freshly-shared video renders a **blank** `=IMAGE` for minutes even when sharing (Step 6a) AND the formula are both correct - NOT an error; older files render immediately. Before marking a **video** card Complete (STEP 8), confirm its previews have actually populated (`get_file_metadata` `thumbnailLink` present / visual).

## STEP 7 - Mark + report
After appending, optionally tag the ClickUp card so it is not reprocessed (per Step 5 decision). Output a summary:
```
## Stage 1 Intake - Report
Ready-to-Post Meta cards found: {n}
Rows appended: {n}  (Images Flower {n} · Videos Flower {n} · Images Gummies {n} · Videos Gummies {n})
Skipped - already in sheet: {n}
Skipped - ambiguous product/tab (logged): {n}
Excluded - Axon platform: {n}
Header-mismatch halts: {tabs, if any}
```

---

## STEP 8 - Per-card completion gate (verify, THEN mark Complete)
After intaking a card, **double-check before changing its status**. Only when EVERY check passes do you set the ClickUp card `📤 ready to post` → `✅ Complete` (via `clickup_update_task`). The Drive folder's finished assets are the source of truth - never miss an ad.

1. **Completeness - no ad missed.** Enumerate the card's **finished** deliverables from its Drive folder (images: each variant's 1x1+9x16; videos: each finished video across the per-actor subfolders). Confirm **every** one has a corresponding row on the sheet. Counts must match.
2. **Row data correct.** Each row has: Code/Variant #, Designer (+ Writer if present), the **ClickUp brief URL** in the ClickUp Card ID column, and the correct asset link(s) - images: 1x1 + 9x16; videos: 4x5 + 9x16. The Ad Name formula computed (non-empty, ID present).
3. **Links valid + shared.** Each asset link resolves to a real file, and that file is per-file shared (anyone-with-link) per Step 6a.
4. **Column-A preview present on EVERY row (image AND video).** Every image row and every video row must carry the col-A `=IMAGE(...)` preview (STEP 6b, Adam hard rule). Verify the formula is present (read col A with `--render=FORMULA`; it must start with `=IMAGE(` - `FORMATTED_VALUE` is blank for `=IMAGE`, a false negative) AND that the thumbnail actually renders (fetch `https://drive.google.com/thumbnail?id=<fileid>&sz=w1000` → expect `200 image/*`). ⚠️ Video poster-frame thumbnails build **asynchronously** after sharing, so a freshly-shared video can render blank for minutes even when formula + sharing are correct - that is NOT done yet; re-check before completing.
5. **Machine-check the completeness gate (enforcement, not eyeballing).** Run `python3 skills/meta-intake/intake_completeness_check.py "<Tab>" <comma,sep,rows>` over the rows you just wrote. It header-resolves and asserts: col-A `=IMAGE` present + thumbnail renders 200, and Code / ClickUp Card ID / 1x1 / 9x16 / Actor Age Bracket / Gender non-blank. Exit 0 = all complete; exit 1 = do NOT complete (it prints the exact blank rows/cols). This is the backstop for the bearer/no-engine gog path where `engine.py`'s built-in col-A step is not in the loop. (Added 2026-07-09 after a manual-path intake reached the sheet with blank col-A previews - documented-rule + execution-miss = enforcement gap; the gate closes it.)
6. **Decision.** ALL checks pass (incl. the machine-check exit 0) → set the card's completion status (resolve it live from the card's list statuses, e.g. `✅ Posted To Sheet` - never hardcode). **Any** ad missing, any field/link wrong, any file unshared, blank col-A preview, or (video) any preview not yet rendered → **do NOT complete**: leave the card `📤 ready to post` and report exactly what is missing/incorrect. When in doubt, do not complete.

A partially-intaked card (e.g. only some variants/videos added) must stay `ready to post` - completing it would hide the un-added ads.

## RULES
- **ALWAYS read the live header row (row 1) of the target tab immediately before writing ANY data, EVERY time (Adam, hard rule).** Map every value you write to its column by **header NAME**, never by a remembered or hardcoded letter. If a new column was added or the layout shifted, your fresh header read picks it up automatically and you write to the correct cells. Never assume the columns are where they were last run - re-read and re-map on every single intake, so a sheet edit can never cause data to land in the wrong column. If an expected header is missing/renamed, halt that tab and report.
- **Read the column map every run** from `column-maps.md`; never hardcode letters here.
- **Verify headers before writing**; halt the tab on any mismatch.
- **Write only intake-owned columns.** Never write the copywriter's avatar/funnel/copy cells or any read-only column.
- **Idempotent; Card-ID presence is the anti-double-add authority (STEP 5).** Never re-intake a present card wholesale on zero file-id overlap (re-export false-positive = 07-07 20-dup incident). Intake ONLY genuinely-new variant-identities (new V#/actor/hook = a re-edit that ADDED a variant); same-variant-set with new file-ids = re-export → skip+flag; when in doubt, flag for human.
- **Meta only.** Exclude Axon-platform cards from this sheet.
- **Never guess the product.** Ambiguous flower-vs-gummies → skip and log.
- **Do not stop the whole run because one card failed.** Log it and continue.

## TOOLS REQUIRED
- **ClickUp MCP:** `clickup_filter_tasks`, `clickup_get_task` (field detail), `clickup_get_custom_fields`.
- **Composio Google Sheets MCP:** `GOOGLESHEETS_VALUES_GET` / `GOOGLESHEETS_BATCH_GET` (header verify + dedupe read), `GOOGLESHEETS_APPEND` / `GOOGLESHEETS_UPDATE_VALUES_BATCH` (append rows).

## HANDS OFF TO
Stage 2 - the copywriter ([`../../meta-ad-copy-agent/`](../../meta-ad-copy-agent/)) reads the new rows' assets and fills the copy + avatar + funnel cells.
