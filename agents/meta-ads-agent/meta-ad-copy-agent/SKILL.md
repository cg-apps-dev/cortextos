> **▶ PRIMARY ENTRY (2026-06-20 consolidation): read [`playbook.md`](playbook.md) top-to-bottom every run.**
> It is the single read-every-run doc - the ordered procedure + every apply-every-run rule (incl. the second-person rule, §5.5 formatting, the clarity gate, de-code, avatar list) + the ONE deterministic gate (`references/copy-gate.py`). This SKILL + the `references/` files are the deep read-on-demand layer. Where a reference EXAMPLE conflicts with a playbook rule, the PLAYBOOK wins (the references are being refreshed separately). Completeness proof: [`CONSOLIDATION-COMPLETENESS.md`](CONSOLIDATION-COMPLETENESS.md).

---

---
name: generate-ad-copy
description: >
  Automated Meta ad copy generation for Clean Green's Google Sheets pipeline.
  Use when the user asks to "generate ad copy", "fill empty rows", "write ad
  copy", "run the ad copy pipeline", "fill the sheet", or any request to
  produce headlines and body variations for the four product-specific tabs:
  IMAGES (Flower), VIDEOS (Flower), IMAGES (Sleep Gummies), VIDEOS
  (Sleep Gummies). Processes all four tabs in a single run.
---

# Generate Ad Copy - Automated Pipeline

Single-command pipeline that detects empty copy rows across the four
product-specific tabs, analyzes each row's creative asset, generates 5
headlines + 5 body variations, enforces compliance, and writes only the
10 approved copy cells to the sheet - plus the Customer Avatar
dropdown and the Funnel Stage dropdown.

**The four tabs and their product mapping:**

| Tab name | `product_category` | Asset type | Brief source |
|----------|--------------------|------------|--------------|
| `IMAGES (Flower)` | `flower` | Static image (Drive) | The image itself |
| `VIDEOS (Flower)` | `flower` | 9x16 video | ClickUp brief (column M) |
| `IMAGES (Sleep Gummies)` | `gummies:deep-sleep` | Static image (Drive) | The image itself |
| `VIDEOS (Sleep Gummies)` | `gummies:deep-sleep` | 9x16 video | ClickUp brief (column K) |

**`product_category` is declared by the tab, not derived from the
asset.**

**Before writing any copy, load these reference files:**
- `references/brand-voice.md` - tone, rhythm, signature patterns, DO/DON'T pairs
- `references/compliance.md` - how compliance is enforced (it defines **no** rules of its own; rules are read from the meta-compliance-agent and enforced via its scan as a hard pre-write gate)
- `references/copy-framework.md` - 5 headline hooks, 5 body angles, §5.5 visual formatting contract, per-product proof banks
- `references/column-maps.md` - exact column layouts for all four tabs (**v0.7.6 - per-tab letters**: copy block is `V:AE` on `IMAGES (Flower)`, `T:AC` on `IMAGES (Sleep Gummies)`, `Z:AI` on `VIDEOS (Flower)`, `X:AG` on `VIDEOS (Sleep Gummies)`)
- `references/manual-copy-gen.md` - 3-style framework
- `references/avatars.md` - per-product dropdown values for Customer Avatar (column L on `IMAGES (Flower)`, J on `IMAGES (Sleep Gummies)`, P on `VIDEOS (Flower)`, N on `VIDEOS (Sleep Gummies)`), brief-extraction rules, and ambiguity defaults
- `references/funnel-stage.md` - per-tab dropdown values for Funnel Stage (column M on `IMAGES (Flower)`, K on `IMAGES (Sleep Gummies)`, Q on `VIDEOS (Flower)`, O on `VIDEOS (Sleep Gummies)` - TOF / MOF / BOF), brief-extraction rules and per-tab defaults

**Visual formatting is not optional.** See `copy-framework.md` §5.5 and §8 for the format contract.

**Compliance is single-sourced from the meta-compliance-agent - see `references/compliance.md`.** Generate copy applying the agent's canonical rules ([`meta-compliance-agent/references/rules.md`](../../meta-compliance-agent/references/rules.md), M-1…M-24), then run the **meta-compliance-agent scan** (asset-type `ad-copy`) on every generated line as a **hard pre-write gate**: FAIL → apply its suggested substitutions → regenerate → re-scan; only write on PASS. This pipeline keeps **no** banned-term list or substitution map of its own.

**Hard write boundary:** This plugin may write only the 10 copy columns for each tab, plus the Customer Avatar dropdown and the Funnel Stage dropdown. It must never write Ad Description, Display Link, Status, cache, hash, timestamp, Promo Code, UTM, CTA, Row Type, blocker JSON, or any helper/diagnostic cell. Blocked rows are reported in chat/run output only.

**As of v0.7.6 the image and video write maps are no longer shared across products.** Adam inserted sister-winner reference columns at C–F (flower tabs, +4 columns) and C–D (gummies tabs, +2 columns), so each of the four tabs now has its own letter map. The shape (avatar dropdown + funnel-stage dropdown + 10 contiguous copy columns) is unchanged.

| Tab | Allowed write range(s) | Fields |
|-----|------------------------|--------|
| `IMAGES (Flower)` | `L` + `M` + `V:AE` (three non-contiguous ranges, 12 cells) | Customer Avatar (L, chip dropdown) + Funnel Stage (M, classic dropdown) + Headline, Headline Var. 1-4, Primary, Primary Var. 1-4 (V:AE) |
| `IMAGES (Sleep Gummies)` | `J` + `K` + `T:AC` (three non-contiguous ranges, 12 cells) | Customer Avatar (J, chip dropdown) + Funnel Stage (K, classic dropdown) + Headline, Headline Var. 1-4, Primary, Primary Var. 1-4 (T:AC) |
| `VIDEOS (Flower)` | `P` + `Q` + `Z:AI` (three non-contiguous ranges, 12 cells) | Customer Avatar (P, classic data-validation dropdown) + Funnel Stage (Q, classic dropdown) + Headline, Headline Var. 1-4, Primary, Primary Var. 1-4 (Z:AI) |
| `VIDEOS (Sleep Gummies)` | `N` + `O` + `X:AG` (three non-contiguous ranges, 12 cells) | Customer Avatar (N, chip dropdown) + Funnel Stage (O, classic dropdown) + Headline, Headline Var. 1-4, Primary, Primary Var. 1-4 (X:AG) |

The Customer Avatar columns are **dropdowns** - image tabs and `VIDEOS (Sleep Gummies)` use chip-style; `VIDEOS (Flower)` uses classic data validation. Write only the exact prefixed strings from `references/avatars.md` §1 for the matching tab: 6 `FCA=` values on both flower tabs (identical lists as of v0.8.0), 4 `DSCA=` values on both gummies tabs (identical lists). The v0.7.3 image-flower `Flower 04-07` offer/promo tag system was retired in v0.8.0 - `Subscribe and Save` returns as a regular avatar (`FCA=Subscribe and Save`) on both flower tabs.

The Funnel Stage columns are all **classic dropdowns** (`ONE_OF_LIST`, strict) with values `TOF`, `MOF`, `BOF`. Write only one of those three uppercase strings - no prefix, no suffix, no paraphrase. See `references/funnel-stage.md` §1 for framing and §2 for inference rules.

If any target header has moved to a different column, or any expected header is missing/renamed, halt that tab before generating copy and report the exact mismatch.

---

## Execution order

1. Read `IMAGES (Flower)` - find empty rows, process each as flower
2. Read `VIDEOS (Flower)` - find empty rows, process each as flower
3. Read `IMAGES (Sleep Gummies)` - find empty rows, process each as gummies:deep-sleep
4. Read `VIDEOS (Sleep Gummies)` - find empty rows, process each as gummies:deep-sleep
5. Report: rows processed per tab, rows skipped, rows blocked, avatar fill stats, funnel-stage fill stats

---

## Step 0: First-run schema audit (hard write gate)

> **⚠ 2026-06-23 STALENESS NOTE - letters below are ADVISORY, name-resolution is the AUTHORITY.**
> A live audit on 2026-06-23 found ALL FOUR copy tabs had shifted from the letters documented here (structural inserts since this doc was written). The pipeline was unaffected ONLY because the playbook §G rule is "header-map by NAME live every run" - do that, never trust a fixed letter. **The Step-0 audit MUST resolve each target column by its HEADER NAME and verify the name is present (anywhere), NOT assert a fixed letter position** - a fixed-letter audit false-halts every tab after an insert. Current live letters (2026-06-23, copy columns only):
>
> | Tab | Avatar | Funnel | Headline…Var.4 | Primary…Var.4 | Ad Description |
> |-----|--------|--------|----------------|---------------|----------------|
> | `VIDEOS (Flower)` | W | X | AG–AK | AL–AP | AR |
> | `IMAGES (Flower)` | S | T | AC–AG | AH–AL | AN |
> | `VIDEOS (Sleep Gummies)` | Q | R | AA–AE | AF–AJ | AL |
> | `IMAGES (Sleep Gummies)` | M | N | W–AA | AB–AF | AH |


**Before processing any rows, read row 1 of each tab and verify every allowed write column still contains the exact expected header in the exact expected position.** Each of the four tabs has its own letter map as of v0.7.6 - verify each tab independently.

Audit procedure:

1. Read row 1 of all four tabs in a single `GOOGLESHEETS_BATCH_GET` call (e.g. `'IMAGES (Flower)'!A1:AT1`, `'IMAGES (Sleep Gummies)'!A1:AR1`, `'VIDEOS (Flower)'!A1:AW1`, `'VIDEOS (Sleep Gummies)'!A1:AP1`).
2. For `IMAGES (Flower)`, confirm:
   - L = `Customer Avatar`
   - M = `FUNNEL STAGE`
   - V = `Headline`
   - W = `Headline Var. 1`
   - X = `Headline Var. 2`
   - Y = `Headline Var. 3`
   - Z = `Headline Var. 4`
   - AA = `Primary`
   - AB = `Primary Var. 1`
   - AC = `Primary Var. 2`
   - AD = `Primary Var. 3`
   - AE = `Primary Var. 4`
3. For `IMAGES (Sleep Gummies)`, confirm:
   - J = `Customer Avatar`
   - K = `FUNNEL STAGE`
   - T = `Headline`
   - U = `Headline Var. 1`
   - V = `Headline Var. 2`
   - W = `Headline Var. 3`
   - X = `Headline Var. 4`
   - Y = `Primary`
   - Z = `Primary Var. 1`
   - AA = `Primary Var. 2`
   - AB = `Primary Var. 3`
   - AC = `Primary Var. 4`
4. For `VIDEOS (Flower)`, confirm:
   - P = `Customer Avatar`
   - Q = `FUNNEL STAGE`
   - Z = `Headline`
   - AA = `Headline Var. 1`
   - AB = `Headline Var. 2`
   - AC = `Headline Var. 3`
   - AD = `Headline Var. 4`
   - AE = `Primary`
   - AF = `Primary Var. 1`
   - AG = `Primary Var. 2`
   - AH = `Primary Var. 3`
   - AI = `Primary Var. 4`
5. For `VIDEOS (Sleep Gummies)`, confirm:
   - N = `Customer Avatar`
   - O = `FUNNEL STAGE`
   - X = `Headline`
   - Y = `Headline Var. 1`
   - Z = `Headline Var. 2`
   - AA = `Headline Var. 3`
   - AB = `Headline Var. 4`
   - AC = `Primary`
   - AD = `Primary Var. 1`
   - AE = `Primary Var. 2`
   - AF = `Primary Var. 3`
   - AG = `Primary Var. 4`
6. Verify helper columns (per tab):
   - `IMAGES (Flower)`: G = `Code`, K = `ClickUp Card ID`, S = `1x1`
   - `IMAGES (Sleep Gummies)`: E = `Code`, I = `ClickUp Card ID`, Q = `1x1`
   - `VIDEOS (Flower)`: G = `Variant #`, M = `ClickUp Card ID`, Y = `9x16` (note: 1x1 header in column W is literally `"1x1 "` with a trailing space - preserved from the source sheet, do not "fix" it)
   - `VIDEOS (Sleep Gummies)`: E = `Variant #`, K = `ClickUp Card ID`, W = `9x16`

If any tab's headers don't match: skip that tab entirely for this run, do NOT write to it, and surface a blocker in the Step 4 report.

v0.7.6 is the third intentional schema migration on these tabs (sister-winner reference columns inserted between B and the old Code/Variant # column - see CHANGELOG entry 2026-05-15). v0.7.4 was the second (FUNNEL STAGE column added). The agent must never silently follow a shifted header without explicit human approval.

---

## Step 1: Detect empty rows

**Spreadsheet ID:** `1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME`

A row qualifies for processing if **any** of (a) the Customer Avatar column is empty, (b) the FUNNEL STAGE column is empty, or (c) the 10 copy cells are ALL empty. Avatar fill, funnel-stage fill, and copy fill are **three independent loops** as of v0.7.4. Use the per-tab letters:

| Tab | Avatar (a) | Funnel Stage (b) | Copy block (c) |
|---|---|---|---|
| `IMAGES (Flower)` | L | M | V:AE |
| `IMAGES (Sleep Gummies)` | J | K | T:AC |
| `VIDEOS (Flower)` | P | Q | Z:AI |
| `VIDEOS (Sleep Gummies)` | N | O | X:AG |

**Skip / retry rules:**
- If a row has no asset link (image primary 1x1 cell empty - column S on `IMAGES (Flower)` / column Q on `IMAGES (Sleep Gummies)`; video primary 9x16 cell empty - column Y on `VIDEOS (Flower)` / column W on `VIDEOS (Sleep Gummies)`) → skip.
- If any of the 10 copy cells already contains copy, skip that row for copy generation. Avatar fill and funnel-stage fill have their own per-cell skip rules.

---

## Tab-mismatch check

`product_category` is declared by the tab. On every image row the image is read once and compared against the tab's declared product. If the image clearly shows the wrong product, block the row - leave 10 copy cells empty, leave the Customer Avatar cell empty, leave the FUNNEL STAGE cell empty, do not write Status/cache, add to the blocked list. For video tabs, the equivalent check is brief-side. Avatar fill (Step 3.5) and funnel-stage fill (Step 3.6) both skip tab-mismatched groups.

---

## Step 2: Process the image tabs

For each qualifying image row:

### 2a. Image read + tab-mismatch sanity check

1. Locate the image on the local mount via the Step 2b glob.
2. View the file with the Read tool (native vision).
3. Extract offer, price, proof signals, CTA, product name, on-image text.
4. Compare the visibly-shown product against the tab's declared product.
5. If the image clearly shows the wrong product → block.
6. If the image cannot be opened → halt per 2b-HALT.

### 2b. Analyze the image asset

**Primary path - local Shared-drive mount:**

```
/Users/rodrigogomez/Library/CloudStorage/GoogleDrive-rodrigo@leadifier.io/Shared drives/00 - Clean Green Ads System/01 - Ads System/*ClickUp Master Folder/Static Image Ads
```

Each ad lives in a subfolder named `{WRITER}_CG_IMG_{NUM} - IMG{ID}`. The 1×1 file inside is named `1x1 - {WRITER}_CG_IMG_{NUM}_V{X}.jpg`.

1. Parse the ad code from the `Code` column (column G on `IMAGES (Flower)`, column E on `IMAGES (Sleep Gummies)`), writer prefix from the `Writer` column (column I on `IMAGES (Flower)`, column G on `IMAGES (Sleep Gummies)`).
2. Glob: `find "{BASE}" -maxdepth 2 -ipath "*CG_IMG_{NUM}*/1x1*_V{X}*.jpg"`
3. View natively. Extract all visible text verbatim.
4. Hold in memory for this run. Do not write to the sheet.

**Fallback path - Composio Drive API (only if mount unavailable):**

1. Extract the Google Drive file ID from the `1x1` column (column S on `IMAGES (Flower)`, column Q on `IMAGES (Sleep Gummies)`).
2. `GOOGLEDRIVE_DOWNLOAD_FILE` → signed R2 URL → curl → Read.

**NEVER use ClickUp briefs for image ads.** The image itself is the brief.

### 2b-HALT. Hard halt on OCR failure

If ANY step 2b.1-4 fails, DO NOT generate copy for that row. Do not fall back to `Description`, `Code`, ClickUp briefs, or context from other rows. Block the row:

- Leave the 10 copy columns empty, plus the Customer Avatar cell and the FUNNEL STAGE cell.
- Do not write Status, cache, blocker JSON, hash, timestamp.
- Add to the blocked list with tab name, row number, and short reason.

### 2c. Generate copy (only if OCR succeeded and tab matches)

1. **Set `product_category` from the tab name.**
2. Identify the customer avatar from the Customer Avatar column for the tab (L on `IMAGES (Flower)`, J on `IMAGES (Sleep Gummies)`).
3. Generate 5 headlines: Balanced, Curiosity, Proof, Pain, Transformation. **Skip M-12 diagnostic-question hooks.** Write to the first 5 cells of the copy block (`V:Z` on `IMAGES (Flower)`, `T:X` on `IMAGES (Sleep Gummies)`).

   **HEADLINE CLARITY MANDATE (v0.8.x) - applies to image AND video headline generation, both products.** Of the 5 headlines, AT LEAST 2 must be crystal-clear: the reader should instantly know what it is and that there is a draw. These 2 are **PATTERN-BASED, generated fresh per ad** - never paste a fixed string across creatives (identical headlines across many ads cause ad fatigue + Meta duplicate-creative risk).
   - **(a) ONE PRODUCT-CLEAR headline** - instantly clear it is the premium/real product, built ONLY from the meta-compliance-agent's **M-3 approved substitutes** (NEVER `flower`/`bud`/`Real Bud`). Generate a fresh variant per ad from these templates (vary them, do not paste verbatim): FLOWER - `Get The Real Thing Delivered Fast` / `Real Quality, Delivered` / `The Real Thing, Shipped To Your Door` / `Real Quality Ships To Your Door` / `Premium Quality Delivered Right To Your Door` / `Real Quality. Real Results. Real Fast.` / `Family-Grown. Real Quality, Delivered Fast.` / `Skip The Shop. Get It Delivered.` / `Real Quality Or Your Money Back` / (product+offer combo) `Order The Real Thing Online, 20% Off Today`; GUMMIES - `Get Your Wind-Down Gummies Delivered` (use `gummies` / `wind-down gummies`, **NEVER `Sleep Gummies`** - "Sleep" reads as an implied M-13 outcome claim).
   - **(b) ONE PROMO-CLEAR headline** - rotate between the approved promo forms (do not stamp one line): `Get 20% Off Your First Order` / `20% Off Today, Code TRY20` / `Limited Time, 20% Off`. Universal, both products.

   The remaining 3 headlines stay angle/avatar-driven (from Balanced / Curiosity / Proof / Pain / Transformation, minus any used). ALL the agent's compliance still applies (no em-dash; the M-codes; **no banned emojis - 🌿 / 🍃 are banned per M-19e, only review ⭐ allowed**; non-numeric / state-safe shipping claims only). Every line passes the meta-compliance-agent scan before writing, exactly like every other line. _(The expanded FLOWER (a)-templates above are analytics-grounded: translated from the current top-CTR / top-spend live Meta winners into compliant form - e.g. the most-reused top winner (which uses the now-banned `Flower` + 🌿) maps to the canonical compliant `Get The Real Thing Delivered Fast`. NOTE: most live top creatives still use banned terms and the 🌿 emoji - never copy a live headline verbatim; translate the pattern into the agent's approved substitutes. A numeric social-proof template (e.g. `25,000+ Reviews`) is intentionally NOT listed - only ship a review count that is current + verified.)_
4. Generate 5 body variations: Skeptic-to-believer, Proof-led, Pain-led, Social proof, Offer/urgency. Write to the last 5 cells of the copy block (`AA:AE` on `IMAGES (Flower)`, `Y:AC` on `IMAGES (Sleep Gummies)`).
5. **Do not generate or write Ad Description.** Only outputs are the 10 copy cells in the per-tab copy block (`V:AE` on `IMAGES (Flower)`, `T:AC` on `IMAGES (Sleep Gummies)`).
6. **Run every generated line through the meta-compliance-agent scan** (asset-type `ad-copy`) BEFORE writing - FAIL means apply its suggested substitutions, regenerate, and re-scan; only write on PASS. Review-Style carve-out for `"..."` + `⭐️⭐️⭐️⭐️⭐️` blocks (quoted reviews aren't reworded but still must pass the agent's scan).
7. Verify no two variations share the same first 5 words.

### 2d. Write to sheet (copy)

Batch-write the per-tab copy block (`V:AE` on `IMAGES (Flower)`, `T:AC` on `IMAGES (Sleep Gummies)`) for all SUCCESSFULLY processed image rows in a single `GOOGLESHEETS_UPDATE_VALUES_BATCH` call. The Customer Avatar column is handled by Step 2.5; the FUNNEL STAGE column by Step 2.6.

For BLOCKED rows, write nothing. Report in Step 4.

---

## Step 2.5: Customer Avatar fill on image tabs (introduced v0.7.3)

After copy generation, run an avatar-fill loop on `IMAGES (Flower)` and `IMAGES (Sleep Gummies)`. Independent of copy fill: processes every row whose Customer Avatar cell is empty (column L on `IMAGES (Flower)`, column J on `IMAGES (Sleep Gummies)`).

The image asset is the brief - reuse the Step 2a/2b native-vision read. **Do not re-open or re-read the image just for avatar selection.** For avatar-only rows (copy already written), perform the Step 2a image read per 2a/2b/2b-HALT - image is the brief, same hard halts apply.

### 2.5a. Build the batch

1. Collect every row where the Customer Avatar cell is empty (column L on `IMAGES (Flower)`, column J on `IMAGES (Sleep Gummies)`).
2. Ensure the image is in memory (reuse from Step 2a or read once).
3. If the image cannot be read → block per 2b-HALT, reason `image-unreadable`.

### 2.5b. Resolve the avatar per row

1. Apply `avatars.md` §3.1 (flower) or §3.2 (gummies) inference cues. Flower picks one of 6 `FCA=` values; gummies picks one of 4 `DSCA=` values.
2. If ambiguous, apply §4 tie-breakers (commercial-mechanism dominance → benefit framing → hook archetype → customer-stage signal → generic benefit → per-tab default).
3. The chosen value must be a verbatim string from `avatars.md` §1 for the tab.

Note: the v0.7.3 §3.5 offer/promo trigger table (image-flower-only `Flower 04-07` tags) was retired in v0.8.0. `Subscribe and Save` is now an avatar in its own right (`FCA=Subscribe and Save`) and fires on flower tabs via the §4.1 commercial-mechanism rule, not a separate tag table.

### 2.5c. Per-row overwrite guard

Rows whose Customer Avatar cell is already non-empty are skipped - never overwrite.

### 2.5d. Write the Customer Avatar column

Batch-write the Customer Avatar column for every successfully-resolved row whose cell was empty at 2.5a time. Per-tab letter: column L on `IMAGES (Flower)`, column J on `IMAGES (Sleep Gummies)`. Write only the exact dropdown string - no prefix added, no suffix, no parentheses.

### 2.5e. Tab-mismatch interaction

A row already blocked at the Step 2a tab-mismatch check is **not** retried here.

---

## Step 2.6: Funnel Stage fill on image tabs (introduced v0.7.4, ClickUp-driven in v0.7.5)

After avatar fill, run a funnel-stage fill loop on `IMAGES (Flower)` and `IMAGES (Sleep Gummies)`. Independent of copy fill and avatar fill: processes every row whose FUNNEL STAGE cell is empty (column M on `IMAGES (Flower)`, column K on `IMAGES (Sleep Gummies)`). Load `references/funnel-stage.md` before running.

v0.7.5 reads the **linked ClickUp card** (column K on `IMAGES (Flower)`, column I on `IMAGES (Sleep Gummies)` - same inference pattern as Step 3.6 on video tabs). The image itself is NOT consulted for funnel stage - that's a creative/visual signal, not an audience signal. Visual-cue inference is reserved for a future version per `funnel-stage.md` §5.

### 2.6a. Build the batch

1. Collect every row where the FUNNEL STAGE cell is empty (column M on `IMAGES (Flower)`, column K on `IMAGES (Sleep Gummies)`).
2. Group those rows by ClickUp Card ID (column K on `IMAGES (Flower)`, column I on `IMAGES (Sleep Gummies)`). Image variants V1 / V2 / V3 of the same ad share one card, so the fetch is per-group not per-row.
3. Rows already blocked at Step 2a tab-mismatch are **not** retried here.
4. Rows with an empty / missing Card ID go into a `no_card` bucket - they are **not** blocked (unlike video Step 3c-HALT, image rows are still writable without a card because the image is the brief for copy). They default to `TOF` in §2.6b.

### 2.6b. Resolve the funnel stage per Card ID group

For each Card ID group with an empty FUNNEL STAGE cell on at least one row:

1. If the brief is already cached from any earlier step (unlikely on image tabs - Step 2 uses the image, not the card), reuse it. Otherwise call `CLICKUP_GET_TASK` with the Card ID from the per-tab Card ID column and cache.
2. If the ClickUp fetch fails (401 / 404 / invalid ID / non-ClickUp string): **do not block the row.** Write `TOF` and increment `defaulted-to-TOF-from-fetch-failure` for the Step 4 report. The image rows can still ship copy and avatar; only stage inference degrades.
3. Apply `funnel-stage.md` §2.1 - scan the task description, custom fields, and any linked parent task for an **explicit funnel-stage declaration** (`TARGET AUDIENCE: TOF`, `STAGE: MOF`, `Funnel Stage: BOF`, or a Funnel Stage / Audience Stage custom field).
4. If the declaration is present and normalizes to `TOF` / `MOF` / `BOF`, use it. Normalize per `funnel-stage.md` §2.1.4 (`Top of Funnel` → `TOF`, `Cold` → `TOF`, `Warm` → `MOF`, `Hot` → `BOF`) and increment `normalized-from-brief`.
5. If no declaration → write `TOF` (per-tab default, `funnel-stage.md` §3) and increment `defaulted-to-TOF`.
6. The chosen value must be exactly one of `TOF`, `MOF`, `BOF`.

For rows in the `no_card` bucket from §2.6a.4: write `TOF` and increment `defaulted-to-TOF-no-card`.

### 2.6c. Per-row overwrite guard

Rows whose FUNNEL STAGE cell is already non-empty are skipped - never overwrite, even when the group-resolved value differs. Operator intent wins. Divergences within a Card ID group are flagged in Step 4.

### 2.6d. Write the FUNNEL STAGE column

Batch-write the FUNNEL STAGE column for every qualifying image row in a single `GOOGLESHEETS_UPDATE_VALUES_BATCH` call per tab (column M on `IMAGES (Flower)`, column K on `IMAGES (Sleep Gummies)`). Write only `TOF`, `MOF`, or `BOF` - uppercase, no whitespace, no prefix, no suffix.

For blocked rows (tab-mismatch group blocked in Step 2a), write nothing.

---

## Step 3: Process the video tabs

**Videos are grouped by ClickUp Card ID.** Rows that share a Card ID share the same copy.

### 3a. Group qualifying rows by Card ID

1. Read the Card ID from the per-tab Card ID column: column M on `VIDEOS (Flower)`, column K on `VIDEOS (Sleep Gummies)`.
2. Build `{card_id: [row_numbers...]}`.
3. Rows with no Card ID go into `no_card` bucket → blocked at 3c-HALT.

### 3b. Fetch the ClickUp brief (once per Card ID)

1. `CLICKUP_GET_TASK` with the ID. Account alias: "clean-green".
2. Extract hook/body/CTA. For UGC tasks, follow linked parent tasks if logistics-only.

Cache the brief in memory keyed by Card ID - shared by Step 3.5 and Step 3.6.

### 3b-HALT. Hard halt on missing brief

If `CLICKUP_GET_TASK` fails, Card ID is invalid, or brief contains no usable script → DO NOT generate copy. Block the whole group:

- Leave the per-tab copy block empty for every row (`Z:AI` on `VIDEOS (Flower)`, `X:AG` on `VIDEOS (Sleep Gummies)`).
- Leave the Customer Avatar cell and the FUNNEL STAGE cell empty for every row (avatar P / funnel Q on `VIDEOS (Flower)`; avatar N / funnel O on `VIDEOS (Sleep Gummies)`).
- Do not write Status/cache.
- Add every row to the blocked list with Card ID and reason.

### 3c. Generate copy once per Card ID group

1. **Set `product_category` from the tab name.** Brief-side tab-mismatch → block the whole group.
2. Identify the customer avatar for the group (read the non-empty Customer Avatar cell if present - column P on `VIDEOS (Flower)`, column N on `VIDEOS (Sleep Gummies)`; else derive via Step 3.5).
3. Identify hook type from the `Hook Type` column (column O on `VIDEOS (Flower)`, column M on `VIDEOS (Sleep Gummies)`).
4. Generate 5 headlines (first 5 cells of the copy block: `Z:AD` on `VIDEOS (Flower)`, `X:AB` on `VIDEOS (Sleep Gummies)`). **Skip M-12 diagnostic-question hooks.** **Apply the HEADLINE CLARITY MANDATE (v0.8.x) from Step 2c §3** - ≥2 of the 5 are pattern-based offer/product-explicit (one PRODUCT-CLEAR + one PROMO-CLEAR, generated fresh per ad from the approved templates, never a fixed string), both products with the gummies ruling (`wind-down gummies` / `gummies`, NEVER `Sleep Gummies`); the remaining 3 stay angle/avatar-driven; all the agent's bans + the 🌿 emoji ban (M-19e) + state-safe shipping intact, and every line passes the meta-compliance-agent scan before writing.
5. Generate 5 body variations (last 5 cells of the copy block: `AE:AI` on `VIDEOS (Flower)`, `AC:AG` on `VIDEOS (Sleep Gummies)`).
6. Run the meta-compliance-agent scan (asset-type `ad-copy`) BEFORE writing - FAIL → fix per its substitutions → re-scan → only write on PASS. Review-Style carve-out applies.
7. Verify variation uniqueness.

### 3c-HALT. Rows with no Card ID

Leave the per-tab copy block empty, Customer Avatar cell empty, FUNNEL STAGE cell empty. Add to blocked list with reason `no clickup card id` (Card ID column is M on `VIDEOS (Flower)`, K on `VIDEOS (Sleep Gummies)`).

### 3d. Write to sheet - one copy set, N rows

For each successful group, write identical copy-block values to every row in the group. Per-tab copy block: `Z:AI` on `VIDEOS (Flower)`, `X:AG` on `VIDEOS (Sleep Gummies)`. Single `GOOGLESHEETS_UPDATE_VALUES_BATCH` call.

**Example.** Rows 526-528 share Card ID `abc123`, rows 529-530 share `def456`. Two `CLICKUP_GET_TASK` calls. Copy set A → 526, 527, 528. Copy set B → 529, 530.

---

## Step 3.5: Customer Avatar fill on video tabs (introduced v0.7.2, dropdown strings corrected v0.7.3)

After copy generation, run an avatar-fill loop on `VIDEOS (Flower)` and `VIDEOS (Sleep Gummies)`. Independent of copy fill: processes every row whose Customer Avatar cell is empty (column P on `VIDEOS (Flower)`, column N on `VIDEOS (Sleep Gummies)`).

As of v0.8.0 the video flower dropdown carries the same **6 `FCA=` values** as `IMAGES (Flower)!L` - the v0.7.3 image-vs-video flower split (3 archetypes vs 7 archetypes-plus-offer-tags) was retired. `FCA=Subscribe and Save` can now be written to a video flower row when the brief is a subscription pitch.

Brief fetches are **shared** with Step 3 and Step 3.6 - reuse cached briefs; do not re-fetch.

### 3.5a. Build the batch

1. Collect every row where the Customer Avatar cell is empty (column P on `VIDEOS (Flower)`, column N on `VIDEOS (Sleep Gummies)`).
2. Group by Card ID (same logic as Step 3a - column M on `VIDEOS (Flower)`, column K on `VIDEOS (Sleep Gummies)`). All rows in a group receive the same avatar.
3. Rows with no Card ID → blocked per 3c-HALT.

### 3.5b. Resolve the avatar per Card ID group

1. Reuse cached brief if available; else `CLICKUP_GET_TASK` once and cache.
2. If brief unfetchable → block per 3b-HALT.
3. Apply `avatars.md` §2.1 - scan for an explicit declaration matching §1.2 (flower) or §1.4 (gummies). If found, use verbatim.
4. If declaration differs in spelling/casing → normalize, increment `normalized` count.
5. If no declaration → apply §3 inference cues. Video flower picks one of the 6 `FCA=` values; video gummies picks one of the 4 `DSCA=` values. §4 tie-breakers for ambiguity.
6. The chosen value must be verbatim from `avatars.md` §1.2 / §1.4.

### 3.5c. Per-row overwrite guard

Rows whose Customer Avatar cell is already non-empty are skipped. Divergences within a group are flagged in Step 4, not fixed.

### 3.5d. Write the Customer Avatar column

Single `GOOGLESHEETS_UPDATE_VALUES_BATCH` call. Per-tab letter: column P on `VIDEOS (Flower)`, column N on `VIDEOS (Sleep Gummies)`. Write only the verbatim dropdown string.

### 3.5e. Brief-side tab-mismatch interaction

Tab-mismatched groups are **not** retried here.

---

## Step 3.6: Funnel Stage fill on video tabs (introduced v0.7.4)

After avatar fill, run a funnel-stage fill loop on `VIDEOS (Flower)` and `VIDEOS (Sleep Gummies)`. Independent of copy fill and avatar fill: processes every row whose FUNNEL STAGE cell is empty (column Q on `VIDEOS (Flower)`, column O on `VIDEOS (Sleep Gummies)`). Load `references/funnel-stage.md` before running.

Brief fetches are **shared** with Step 3 and Step 3.5. Reuse cached briefs.

### 3.6a. Build the batch

1. Collect every row where the FUNNEL STAGE cell is empty (column Q on `VIDEOS (Flower)`, column O on `VIDEOS (Sleep Gummies)`).
2. Group by Card ID (column M on `VIDEOS (Flower)`, column K on `VIDEOS (Sleep Gummies)`). All rows in a group receive the same funnel stage.
3. Rows with no Card ID → blocked per 3c-HALT.

### 3.6b. Resolve the funnel stage per Card ID group

1. Reuse cached brief if available; else `CLICKUP_GET_TASK` once and cache.
2. If brief unfetchable → block per 3b-HALT.
3. Apply `funnel-stage.md` §2.1 - scan for an explicit declaration. Common patterns: `TARGET AUDIENCE: TOF`, `STAGE: MOF`, `Funnel Stage: BOF`, or a "Funnel Stage" / "Audience Stage" custom field.
4. If declaration is present and normalizes to `TOF` / `MOF` / `BOF`, use it. Normalize per `funnel-stage.md` §2.1.4 (`Top of Funnel` → `TOF`, `Cold` → `TOF`, `Warm` → `MOF`, `Hot` → `BOF`, etc.) and increment `normalized-from-brief`.
5. If no declaration → apply the per-tab default: **`TOF`** (`funnel-stage.md` §3). Increment `defaulted-to-TOF`.
6. The chosen value must be exactly `TOF`, `MOF`, or `BOF`.

### 3.6c. Per-row overwrite guard

Rows whose FUNNEL STAGE cell is already non-empty are skipped. Divergences within a group are flagged in Step 4, not fixed.

### 3.6d. Write the FUNNEL STAGE column

Single `GOOGLESHEETS_UPDATE_VALUES_BATCH` call. Per-tab letter: column Q on `VIDEOS (Flower)`, column O on `VIDEOS (Sleep Gummies)`. Write only `TOF`, `MOF`, or `BOF`.

### 3.6e. Brief-side tab-mismatch interaction

Tab-mismatched groups are **not** retried here.

---

## Step 4: Report

After all four tabs are processed, report:

- Total rows processed (copy written) - per tab
- For video tabs: unique Card ID groups and row-count per group
- Rows skipped (copy already present), per tab
- Rows skipped (no asset link), per tab
- Rows blocked (OCR-unreadable) - list row number, reason, tab
- Rows blocked (brief missing) - list grouped by Card ID
- **Rows blocked (tab-mismatch)** - list row number, tab, visible product
- Compliance: meta-compliance-agent scan results - lines that PASSED first time, lines that needed a fix + re-scan (count + the M-code that flagged), and any line that could not be made to PASS (blocked). M-12 rotator-saturation note if any rotator option used 3+ times.

**Customer Avatar fill (per tab):**

- Avatars written, by source: `explicit-from-brief` (videos), `normalized-from-brief` (videos - including old-taxonomy `Flower 0X` / `DeepSleep 0X` strings normalized to the v0.8.0 FCA= / DSCA= values per `avatars.md` §2.1.4), `inferred` (§3 cues), `inferred-ambiguous` (§4 fallback). The `offer-tag-trigger` source was retired in v0.8.0 alongside the §3.5 tag table.
- Rows / groups skipped (cell already had value)
- Rows / groups blocked - list with reason
- **Avatar disagreements (video tabs only)** - rows where existing L differs from group-resolved value
- Per-tab avatar distribution (catch a classifier collapsing into one bucket)

**Funnel Stage fill (per tab) - new in v0.7.4, expanded in v0.7.5:**

- Stages written, by source:
  - `explicit-from-brief` (videos AND images - explicit `TOF` / `MOF` / `BOF` named in the linked ClickUp card)
  - `normalized-from-brief` (videos AND images - `Top of Funnel` / `Cold` / etc. normalized)
  - `defaulted-to-TOF` (per-tab default, all tabs - card fetched, no declaration found)
  - `defaulted-to-TOF-from-fetch-failure` (image tabs only - the Card ID column couldn't be fetched: column K on `IMAGES (Flower)`, column I on `IMAGES (Sleep Gummies)`; row got `TOF` and ships, but flagged for the operator to fix the Card ID)
  - `defaulted-to-TOF-no-card` (image tabs only - Card ID column was empty: column K on `IMAGES (Flower)`, column I on `IMAGES (Sleep Gummies)`; row got `TOF` and ships)
- Rows / groups skipped (cell already had value)
- Rows / groups blocked - list with reason
- **Funnel-stage disagreements** - rows where the existing FUNNEL STAGE cell differs from the group-resolved value (per-tab letters: M on `IMAGES (Flower)`, K on `IMAGES (Sleep Gummies)`, Q on `VIDEOS (Flower)`, O on `VIDEOS (Sleep Gummies)`; image-tab disagreements possible since v0.7.5 because image rows are grouped by Card ID)
- Per-tab funnel-stage distribution. A run that writes 100% TOF on a tab with known MOF/BOF campaigns is a classifier signal worth surfacing.

If any rows are blocked, include a one-paragraph upstream-cause explanation. Never present blocked rows as "done."

Report schema-audit failures before row-level results. The schema section names the tab, expected column, expected header, actual header, and states no writes were made for that tab.

---

## Copy generation rules (apply to all four tabs)

**Headlines (5 per row):**
- 6-10 words each
- 5 distinct hook types: Balanced, Curiosity, Proof, Pain, Transformation
- No two headlines share the same first 5 words
- Title Case or sentence case (match the asset)
- **No diagnostic-question hooks** - M-12 banned

**Body copy (5 per row):**
- 5 distinct angles: Skeptic-to-believer, Proof-led, Pain-led, Social proof, Offer/urgency
- Var 1-3 = long (8-14 lines), Var 4 = medium (5-8), Var 5 = short (3-5)
- Each variation closes with EITHER skeptic challenge OR offer code, never both
- Every variation references specific content from the asset/brief

**Asset-to-copy alignment (#1 rule):**
- Copy must reference the specific offer, product, proof, or claim shown in the asset
- Generic brand copy applied to an asset is a failure
- If you cannot see the asset, you cannot write the copy. Halt per 2b-HALT.

**Compliance - single-sourced from the meta-compliance-agent (hard pre-write gate):**
- Generate per the agent's canonical M-codes ([`rules.md`](../../meta-compliance-agent/references/rules.md), M-1…M-24): no `bud` / `flower` / `Real Bud` / `Clean Green`; no banned emojis (🌿 / 🍃 / 💨); no medical / side-effect / diagnostic-question / before-after / sensational / outcome-guarantee framing; no `legal` / `scam` / `DEA`; no em dashes; non-numeric / state-safe shipping only.
- **Before writing, run the meta-compliance-agent scan** (asset-type `ad-copy`) on every line. FAIL → apply its suggested substitutions → regenerate → re-scan. Only write on PASS; if a line can't pass, block the row.
- Do **not** keep a banned-term list here - it drifts. The agent's [`rules.md`](../../meta-compliance-agent/references/rules.md) is the single source of truth.

---

## Tool dependencies

| Tool | Used for |
|------|----------|
| `GOOGLESHEETS_BATCH_GET` | Read rows, detect empty copy |
| `GOOGLESHEETS_UPDATE_VALUES_BATCH` | Write the per-tab 10-cell copy block plus the Customer Avatar and FUNNEL STAGE columns (per-tab letters in column-maps.md) |
| `Read` (native vision) | View image files from local mount |
| `Bash` (find/ls) | Locate image files |
| `CLICKUP_GET_TASK` | Fetch video briefs by Card ID (shared between Step 3, 3.5, 3.6 - cache in memory) |
| `GOOGLEDRIVE_DOWNLOAD_FILE` | Fallback image download |

All Google Sheets and Drive tools use Composio. ClickUp account alias: "clean-green".

**Required mount:** `00 - Clean Green Ads System` must be mounted for image OCR without fallback.

---

## Changelog maintenance

This plugin includes a `CHANGELOG.md` at the root. Append a new entry whenever any file is modified during a session.

**Entry format:** `## YYYY-MM-DD - One-line summary`

Place new entries at the top of the log.
