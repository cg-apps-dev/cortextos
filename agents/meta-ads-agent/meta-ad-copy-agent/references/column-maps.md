---
type: reference
agent: meta-ad-copy-agent
status: active
date: 2026-05-25
tags: [meta-ad-copy, column-maps, reference]
---

# Column Maps - Four Product-Specific Tabs

> **⚠ STALENESS NOTE - letters below are ADVISORY, name-resolution is the AUTHORITY.**
> Live audits (2026-06-23, re-verified in full 2026-09-27) found the copy tabs shifted from the letters documented in the per-tab maps below (structural inserts since this doc was written). The pipeline was unaffected ONLY because the playbook §G rule is "header-map by NAME live every run" - do that, never trust a fixed letter. **The Step-0 audit MUST resolve each target column by its HEADER NAME and verify the name is present (anywhere), NOT assert a fixed letter position** - a fixed-letter audit false-halts every tab after an insert.
>
> **Per-tab key column quick-reference - current live letters (fresh header-resolve of all 4 tabs, 2026-09-27; delta first flagged by meta-media-buyer-agent same day, independently re-verified by meta-ads-agent before landing here).** Since the 2026-06-23 audit only the FLOWER tabs moved (+11 columns, per-account tracking-column growth F:X now 19 accounts incl JCG2/AliCG2); both gummies tabs are unchanged since 2026-06-23:
>
> | Tab | Code/Variant# | Writer | Designer | ClickUp Card ID | Avatar | Funnel | Ad Name | 1x1/4x5/9x16 | Headline…Var.4 | Primary…Var.4 | Promo Code | Ad Description |
> |-----|--------------|--------|----------|-----------------|--------|--------|---------|--------------|----------------|---------------|------------|----------------|
> | `IMAGES (Flower)` | Y | AA | AB | AC | AD | AE | AJ | AK/AL/AM | AN–AR | AS–AW | AX | AY |
> | `VIDEOS (Flower)` | Y | AC | AD | AE | AH | AI | AN | AO/AP/AQ | AR–AV | AW–BA | BB | BC |
> | `IMAGES (Sleep Gummies)` | H | J | K | L | M | N | S | T/U/V | W–AA | AB–AF | AG | AH |
> | `VIDEOS (Sleep Gummies)` | H | L | M | N | Q | R | W | X/Y/Z | AA–AE | AF–AJ | AK | AL |
>
> Flower-tab extras (both): `AF/AJ=Ad Type`, `AG/AK=LP`, `AH/AL=Homepage` (**note: AH on IMAGES (Flower) is now Homepage - older docs/rules citing AH as Ad Description are wrong**), `AI/AM=Landing Page URL`; videos also carry `Z=Video Script, AA=Actor, AB=Hook #, AG=Hook Type` (flower) / `I=Video Script, J=Actor, K=Hook #, P=Hook Type` (gummies). Actor Age Bracket + Gender are the last two columns on every tab (BD/BE, BH/BI, AM/AN, AQ/AR respectively).



Exact column layouts for the Clean Green ad copy Google Sheet.
Spreadsheet ID: `1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME`

> ## ⚠️ 2026-06-04 - ALL LETTERS BELOW ARE +2 STALE (PENDING REGEN)
> On 2026-06-04 two columns were **inserted on every tab**: **col B = `Added to Sheet`** (intake timestamp) and **col C = `Meta Review Status`** (ACTIVE/PENDING_REVIEW/DISAPPROVED, red/green/yellow). This shifted **every column right of A by +2** on all four tabs. Three columns were also **appended far-right**: `Actor Age Bracket`, `Gender`, `Ad ID`.
>
> **Every letter in the tables below predates this change - add +2 to each (B→D, C→E, … L→N, R→T, V→X, etc.).** This doc has NOT yet been regenerated to the new layout.
>
> **SAFETY:** the copywriter's Step-0 schema audit reads row 1 and HALTS on any header-position mismatch, so it will refuse to run (NOT corrupt) until this map is regenerated. **Resolve all write columns by HEADER NAME at runtime** (the durable fix) rather than trusting these letters. Do not run a copy pass against this doc until it is regenerated +2 / migrated to header-name lookup. New header positions verified in `orgs/clean-green-marketing/exports/sheet-structural-change-EXECUTE-SPEC-2026-06-04.md`.

> **`Ad Set Group` column (added by [skills/adset-batch](../../skills/adset-batch/SKILL.md)).** A structural column appended at the **END of each tab's used range** (first empty column right of the current last header), header `Ad Set Group`. It records which bundle/ad-set each row belongs to (agent proposes the bundle ID, operator confirms). **Always header-map it by NAME - never hardcode its letter** (it lands in a different column per tab and shifts if anyone widens a tab). Appending at end-of-range must not reindex existing columns or capture the `Ad Name` formula - verify on add.

The pipeline watches **four** product-specific tabs:

| Tab | Type | Product | Shift vs. v0.7.5 |
|-----|------|---------|------------------|
| `IMAGES (Flower)` | Images | `flower` | **+4 columns** |
| `IMAGES (Sleep Gummies)` | Images | `gummies:deep-sleep` | **+2 columns** |
| `VIDEOS (Flower)` | Videos | `flower` | **+4 columns** |
| `VIDEOS (Sleep Gummies)` | Videos | `gummies:deep-sleep` | **+2 columns** |

**v0.7.6 - per-tab column maps.** Adam inserted "sister-winner" reference
columns between `ADMANAGE` (B) and `Code` / `Variant #` on every tab. The
flower tabs got **four** new columns; the gummies tabs got **two**. As a
result, the image and video write maps are **no longer shared across
products** - each of the four tabs now has its own letter map. The
shape of the write contract is unchanged (Customer Avatar dropdown +
Funnel Stage dropdown + 10 contiguous copy columns), only the letters
shift per tab. The old `IMAGES (CG3)` / `VIDEOS (CG3)` flow is archival
and must not be used.

## Hard write boundary (per tab)

This plugin may write only the fields below. All other columns are
read-only from the plugin's perspective. **Every tab has its own
letters as of v0.7.6.**

### `IMAGES (Flower)` - write `L` + `M` + `V:AE` (12 cells)

| Column | Required header | Field |
|--------|-----------------|-------|
| L | Customer Avatar | Customer Avatar (chip dropdown - see `avatars.md` §1.1 for the 6 flower options, prefixed `FCA=`) |
| M | FUNNEL STAGE | Funnel Stage (classic `ONE_OF_LIST`, strict - `TOF` / `MOF` / `BOF`. See `funnel-stage.md`. Image tabs default to TOF when no declaration is found.) |
| V | Headline | Headline |
| W | Headline Var. 1 | Headline variation 1 |
| X | Headline Var. 2 | Headline variation 2 |
| Y | Headline Var. 3 | Headline variation 3 |
| Z | Headline Var. 4 | Headline variation 4 |
| AA | Primary | Primary |
| AB | Primary Var. 1 | Primary variation 1 |
| AC | Primary Var. 2 | Primary variation 2 |
| AD | Primary Var. 3 | Primary variation 3 |
| AE | Primary Var. 4 | Primary variation 4 |

### `IMAGES (Sleep Gummies)` - write `J` + `K` + `T:AC` (12 cells)

| Column | Required header | Field |
|--------|-----------------|-------|
| J | Customer Avatar | Customer Avatar (chip dropdown - see `avatars.md` §1.3 for the 4 gummies options, prefixed `DSCA=`) |
| K | FUNNEL STAGE | Funnel Stage (classic `ONE_OF_LIST`, strict - `TOF` / `MOF` / `BOF`. Image tabs default to TOF.) |
| T | Headline | Headline |
| U | Headline Var. 1 | Headline variation 1 |
| V | Headline Var. 2 | Headline variation 2 |
| W | Headline Var. 3 | Headline variation 3 |
| X | Headline Var. 4 | Headline variation 4 |
| Y | Primary | Primary |
| Z | Primary Var. 1 | Primary variation 1 |
| AA | Primary Var. 2 | Primary variation 2 |
| AB | Primary Var. 3 | Primary variation 3 |
| AC | Primary Var. 4 | Primary variation 4 |

### `VIDEOS (Flower)` - write `P` + `Q` + `Z:AI` (12 cells)

| Column | Required header | Field |
|--------|-----------------|-------|
| P | Customer Avatar | Customer Avatar (classic data-validation `ONE_OF_LIST`, strict - see `avatars.md` §1.2 for the 6 flower options, prefixed `FCA=`, identical list to `IMAGES (Flower)!L`) |
| Q | FUNNEL STAGE | Funnel Stage (classic `ONE_OF_LIST`, strict - `TOF` / `MOF` / `BOF`. Inferred from the ClickUp brief; default TOF.) |
| Z | Headline | Headline |
| AA | Headline Var. 1 | Headline variation 1 |
| AB | Headline Var. 2 | Headline variation 2 |
| AC | Headline Var. 3 | Headline variation 3 |
| AD | Headline Var. 4 | Headline variation 4 |
| AE | Primary | Primary |
| AF | Primary Var. 1 | Primary variation 1 |
| AG | Primary Var. 2 | Primary variation 2 |
| AH | Primary Var. 3 | Primary variation 3 |
| AI | Primary Var. 4 | Primary variation 4 |

### `VIDEOS (Sleep Gummies)` - write `N` + `O` + `X:AG` (12 cells)

| Column | Required header | Field |
|--------|-----------------|-------|
| N | Customer Avatar | Customer Avatar (chip dropdown - see `avatars.md` §1.4 for the 4 gummies options, prefixed `DSCA=`, identical list to `IMAGES (Sleep Gummies)!J`) |
| O | FUNNEL STAGE | Funnel Stage (classic `ONE_OF_LIST`, strict - `TOF` / `MOF` / `BOF`. Inferred from the ClickUp brief; default TOF.) |
| X | Headline | Headline |
| Y | Headline Var. 1 | Headline variation 1 |
| Z | Headline Var. 2 | Headline variation 2 |
| AA | Headline Var. 3 | Headline variation 3 |
| AB | Headline Var. 4 | Headline variation 4 |
| AC | Primary | Primary |
| AD | Primary Var. 1 | Primary variation 1 |
| AE | Primary Var. 2 | Primary variation 2 |
| AF | Primary Var. 3 | Primary variation 3 |
| AG | Primary Var. 4 | Primary variation 4 |

The Customer Avatar columns are Google Sheets **dropdowns**. Image
tabs and `VIDEOS (Sleep Gummies)` use Google's newer chip-style
dropdowns; `VIDEOS (Flower)` uses classic data validation. All four
Funnel Stage dropdowns use **classic data validation**
(`ONE_OF_LIST`, `strict: true`) with the three values `TOF` / `MOF` /
`BOF`. Writes must match exactly - for Customer Avatar use a verbatim
string from `avatars.md` §1 for the matching tab; for Funnel Stage use
one of `TOF`, `MOF`, `BOF` (uppercase, no prefix). Any other value
either fails the `ONE_OF_LIST` strict-validation rule (classic) or
stores as plain text that fails downstream chip lookups, and breaks
filters either way. Never write a paraphrase, free-form note, an
unprefixed avatar string (`The Skeptic` is wrong; `FCA=The Skeptic 1st
Time Online Buyer` is right), a lowercased funnel stage (`tof` is
wrong; `TOF` is right), an old-taxonomy v0.7.x string (`Flower 02 -
The Skeptic - First-Time Online Buyer` and `DeepSleep 01 - The Anxious
Sleeper` are both retired - see `avatars.md` §2.1.4 for the
normalization map), or an avatar from another tab's product list
(flower `FCA=` values in a gummies tab, or gummies `DSCA=` values in a
flower tab, are hard errors). As of v0.8.0 the image-flower and
video-flower dropdowns hold the **same 6 `FCA=` values** - the v0.7.3
`Flower 04-07` image-flower-only offer/promo tag system was retired;
`Subscribe and Save` returns as a regular avatar (`FCA=Subscribe and
Save`) that can fire on any flower tab. The two gummies tabs hold the
**same 4 `DSCA=` values**.

**Chip-dropdown caveat:** the Composio
`GOOGLESHEETS_GET_DATA_VALIDATION_RULES` tool returns `rules: []` for
chip-style dropdowns because those values are stored in a separate
data layer the classic-validation API doesn't surface. `avatars.md`
§1 is the canonical source of truth for avatar values - last verified
manually 2026-05-19 (full v0.8.0 taxonomy migration: 6 `FCA=` values
on both flower tabs, 4 `DSCA=` values on both gummies tabs). The
Funnel Stage dropdowns are classic data-validation (`ONE_OF_LIST`)
and so DO surface via the validation API; values are `TOF`, `MOF`,
`BOF` and were re-verified via the `audit-sheet-schema` skill on
2026-05-18. Schema audits at runtime confirm headers only - the
`audit-sheet-schema` skill is the path to revalidate dropdown values
without a copy run.

Before any write, the agent must read row 1 of **each tab
independently** and verify every required header above is still in
the exact expected column for **that tab**. The four tabs no longer
share the same letters as of v0.7.6 - confirming the image-flower
write columns does not validate the image-gummies write columns. If
a target header has shifted, is missing, or was renamed, the agent
must halt that tab, write nothing, and report the mismatch. Do not
infer a replacement column and do not follow a shifted header without
explicit human approval.

## Sheet audit findings (last verified 2026-05-19)

| Tab | Layout match | Write map | Notes |
|-----|--------------|-----------|-------|
| `IMAGES (Flower)` | ✅ matches v0.7.6 layout, v0.8.0 avatar values | `L` + `M` + `V:AE` | 4 sister-winner reference columns (`E-0650 \| Flower 2`, `E-0645 \| Flower 2`, `E-0494 \| Flower 1`, `E-0535 \| Flower 1`) inserted at C–F. Everything from old C onwards shifted +4. Avatar chip dropdown carries 6 `FCA=` values (v0.8.0 - was 7 archetypes + offer/promo tags pre-migration). |
| `IMAGES (Sleep Gummies)` | ✅ matches v0.7.6 layout, v0.8.0 avatar values | `J` + `K` + `T:AC` | 2 sister-winner reference columns (`E-0496 \| Gum 1`, `E-0593 \| Gum 1`) inserted at C–D. Everything from old C onwards shifted +2. Avatar chip dropdown carries 4 `DSCA=` values (v0.8.0 - was 2 pre-migration). |
| `VIDEOS (Flower)` | ✅ matches v0.7.6 layout, v0.8.0 avatar values | `P` + `Q` + `Z:AI` | Same 4 sister-winner reference columns as the image-flower tab inserted at C–F. Header `1x1 ` (with trailing space) preserved. Avatar classic dropdown carries the same 6 `FCA=` values as `IMAGES (Flower)!L` (v0.8.0 - was 3 archetypes pre-migration; image/video flower lists are now identical). |
| `VIDEOS (Sleep Gummies)` | ✅ matches v0.7.6 layout, v0.8.0 avatar values | `N` + `O` + `X:AG` | Same 2 sister-winner reference columns as image-gummies tab inserted at C–D. Avatar chip dropdown carries the same 4 `DSCA=` values as `IMAGES (Sleep Gummies)!J`. |

---

## `IMAGES (Flower)` layout

### Input columns (read)

| Column | Header | Purpose |
|--------|--------|---------|
| A | (empty) | Row marker |
| B | ADMANAGE | Ad management ID |
| C | E-0650 \| Flower 2 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| D | E-0645 \| Flower 2 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| E | E-0494 \| Flower 1 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| F | E-0535 \| Flower 1 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| G | Code | Ad code (e.g. IMG_154#V1). Was column C in v0.7.5. |
| H | Description | Product/campaign description. Was column D. |
| I | Writer | Assigned copywriter. Was column E. |
| J | Designer | Assigned designer. Was column F. |
| K | ClickUp Card ID | ClickUp task ID. **NOT used for image copy** - the image asset is the brief. **IS used for image funnel-stage inference** - see SKILL.md Step 2.6. Image rows naturally group by this Card ID (V1 / V2 / V3 of the same ad share one card). Was column G. |
| L | Customer Avatar | **Write target.** Chip dropdown filled by the avatar-fill loop. See `avatars.md` §1.1 (6 `FCA=` options as of v0.8.0; was 7 archetypes + offer/promo tags 04-07 in v0.7.x). Was column H. |
| M | FUNNEL STAGE | **Write target.** Classic dropdown filled by the funnel-stage-fill loop. Allowed values: `TOF`, `MOF`, `BOF`. Defaults to `TOF` when the linked ClickUp card has no explicit declaration. Was column I. |
| N | Ad Type | Ad type classification. Was column J. |
| O | LP | Landing page shortcode. Was column K. |
| P | Homepage | Homepage flag/value. Was column L. |
| Q | Landing Page URL | Full landing page URL. Was column M. |
| R | Ad Name | Full ad name with metadata. Was column N. |
| S | 1x1 | **Primary image asset** - Google Drive link (1080x1080). Was column O. |
| T | 4x5 | 4x5 variant - Google Drive link (often empty). Was column P. |
| U | 9x16 | 9x16 variant - Google Drive link (1080x1920). Was column Q. |

### Approved output columns (the only writable cells)

| Column | Header | Hook/Angle | Notes |
|--------|--------|------------|-------|
| V | Headline | Balanced (primary) | 6-10 words |
| W | Headline Var. 1 | Curiosity | Open a loop |
| X | Headline Var. 2 | Proof | Lead with credibility |
| Y | Headline Var. 3 | Pain | Name the problem |
| Z | Headline Var. 4 | Transformation | Before/after framing |
| AA | Primary | Skeptic-to-believer | Long form (8-14 lines) |
| AB | Primary Var. 1 | Proof-led | Long form |
| AC | Primary Var. 2 | Pain-led | Long form |
| AD | Primary Var. 3 | Social proof / customer voice | Medium (5-8 lines) |
| AE | Primary Var. 4 | Offer / urgency | Short (3-5 lines) |
| AF | Promo Code | - | **Write target (copy).** TRY20, written by the copy pipeline as part of the standard block. Read-only for the tracker/media-buyer side (confirmed with meta-media-buyer-agent, 2026-08-05) - only copy authors it. |
| AG | Ad Description | - | **Write target (copy).** Required on every ingested row per meta-intake SKILL.md; written by the copy pipeline. |
| AH | Display Link | - | Read-only. Do not write. |
| AI | UTM | - | Read-only. Do not write. |
| AJ | CTA | - | Read-only. Do not write. |

### Status & cache columns

| Column | Header | Purpose |
|--------|--------|---------|
| AK | Row Type | Row classification |
| AL | Status | Read-only. Do not write. |
| AM | Visual_Analysis_Cache | Read-only legacy cache. Do not write. |
| AN | Asset_URL_Hash | Read-only legacy hash. Do not write. |
| AO | Last_Analyzed_Date | Read-only legacy timestamp. Do not write. |

---

## `IMAGES (Sleep Gummies)` layout

### Input columns (read)

| Column | Header | Purpose |
|--------|--------|---------|
| A | (empty) | Row marker |
| B | ADMANAGE | Ad management ID |
| C | E-0496 \| Gum 1 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| D | E-0593 \| Gum 1 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| E | Code | Ad code (e.g. IMG_154#V1). Was column C in v0.7.5. |
| F | Description | Product/campaign description. Was column D. |
| G | Writer | Assigned copywriter. Was column E. |
| H | Designer | Assigned designer. Was column F. |
| I | ClickUp Card ID | ClickUp task ID. Used for funnel-stage inference. Image rows group by this Card ID. Was column G. |
| J | Customer Avatar | **Write target.** Chip dropdown filled by the avatar-fill loop. See `avatars.md` §1.3 (4 `DSCA=` options as of v0.8.0; was 2 in v0.7.x). Was column H. |
| K | FUNNEL STAGE | **Write target.** Classic dropdown - `TOF` / `MOF` / `BOF`. Defaults to `TOF`. Was column I. |
| L | Ad Type | Was column J. |
| M | LP | Was column K. |
| N | Homepage | Was column L. |
| O | Landing Page URL | Was column M. |
| P | Ad Name | Was column N. |
| Q | 1x1 | **Primary image asset** - Google Drive link. Was column O. |
| R | 4x5 | Was column P. |
| S | 9x16 | Was column Q. |

### Approved output columns (the only writable cells)

| Column | Header | Hook/Angle | Notes |
|--------|--------|------------|-------|
| T | Headline | Balanced (primary) | 6-10 words |
| U | Headline Var. 1 | Curiosity | Open a loop |
| V | Headline Var. 2 | Proof | Lead with credibility |
| W | Headline Var. 3 | Pain | Name the problem |
| X | Headline Var. 4 | Transformation | Before/after framing |
| Y | Primary | Skeptic-to-believer | Long form (8-14 lines) |
| Z | Primary Var. 1 | Proof-led | Long form |
| AA | Primary Var. 2 | Pain-led | Long form |
| AB | Primary Var. 3 | Social proof / customer voice | Medium (5-8 lines) |
| AC | Primary Var. 4 | Offer / urgency | Short (3-5 lines) |
| AD | Promo Code | - | **Write target (copy).** TRY20, written by the copy pipeline as part of the standard block. Read-only for the tracker/media-buyer side (confirmed with meta-media-buyer-agent, 2026-08-05) - only copy authors it. |
| AE | Ad Description | - | **Write target (copy).** Required on every ingested row per meta-intake SKILL.md; written by the copy pipeline. |
| AF | Display Link | - | Read-only. Do not write. |
| AG | UTM | - | Read-only. Do not write. |
| AH | CTA | - | Read-only. Do not write. |

### Status & cache columns

| Column | Header | Purpose |
|--------|--------|---------|
| AI | Row Type | Row classification |
| AJ | Status | Read-only. Do not write. |
| AK | Visual_Analysis_Cache | Read-only legacy cache. Do not write. |
| AL | Asset_URL_Hash | Read-only legacy hash. Do not write. |
| AM | Last_Analyzed_Date | Read-only legacy timestamp. Do not write. |

---

## `VIDEOS (Flower)` layout

### Input columns (read)

| Column | Header | Purpose |
|--------|--------|---------|
| A | Hook Screenshot | Screenshot of video hook |
| B | ADMANAGE | Ad management ID |
| C | E-0650 \| Flower 2 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| D | E-0645 \| Flower 2 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| E | E-0494 \| Flower 1 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| F | E-0535 \| Flower 1 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| G | Variant # | Video variant number. Was column C. |
| H | Video Script | Script/description. Was column D. |
| I | Actor | Actor/creator name. Was column E. |
| J | Hook # | Hook type identifier. Was column F. |
| K | Writer | Assigned writer. Was column G. |
| L | Designer | Assigned designer. Was column H. |
| M | ClickUp Card ID | **ClickUp task ID - use this to fetch the brief.** Was column I. |
| N | Partnership Ad? | Partnership flag. Was column J. |
| O | Hook Type | Hook type classification. Was column K. |
| P | Customer Avatar | **Write target.** Classic dropdown filled by the avatar-fill loop. See `avatars.md` §1.2 (6 `FCA=` options as of v0.8.0, identical to `IMAGES (Flower)!L`; was 3 archetype options in v0.7.x). Was column L. |
| Q | FUNNEL STAGE | **Write target.** Classic dropdown - `TOF` / `MOF` / `BOF`. Inferred from the ClickUp brief; default TOF. Was column M. |
| R | Ad Type | Was column N. |
| S | LP | Was column O. |
| T | Homepage | Was column P. |
| U | Landing Page URL | Was column Q. |
| V | Ad Name | Was column R. |
| W | 1x1 | 1x1 video asset link. (Header is `1x1 ` with a trailing space - preserved as-is.) Was column S. |
| X | 4x5 | 4x5 video asset link. Was column T. |
| Y | 9x16 | **Primary video asset** - 9x16 format. Was column U. |

### Approved output columns (the only writable cells)

| Column | Header | Hook/Angle | Notes |
|--------|--------|------------|-------|
| Z | Headline | Balanced (primary) | 6-10 words |
| AA | Headline Var. 1 | Curiosity | Open a loop |
| AB | Headline Var. 2 | Proof | Lead with credibility |
| AC | Headline Var. 3 | Pain | Name the problem |
| AD | Headline Var. 4 | Transformation | Before/after framing |
| AE | Primary | Skeptic-to-believer | Long form (8-14 lines) |
| AF | Primary Var. 1 | Proof-led | Long form |
| AG | Primary Var. 2 | Pain-led | Long form |
| AH | Primary Var. 3 | Social proof / customer voice | Medium (5-8 lines) |
| AI | Primary Var. 4 | Offer / urgency | Short (3-5 lines) |
| AJ | Promo Code | - | **Write target (copy).** TRY20, written by the copy pipeline as part of the standard block. Read-only for the tracker/media-buyer side (confirmed with meta-media-buyer-agent, 2026-08-05) - only copy authors it. |
| AK | Ad Description | - | **Write target (copy).** Required on every ingested row per meta-intake SKILL.md; written by the copy pipeline. |
| AL | Display Link | - | Read-only. Do not write. |
| AM | UTM Parameters | - | Read-only. Do not write. |
| AN | CTA | - | Read-only. Do not write. |

### Status & cache columns

| Column | Header | Purpose |
|--------|--------|---------|
| AO | Row Type | Row classification |
| AP | Status | Read-only. Do not write. |
| AQ | Visual_Analysis_Cache | Read-only legacy cache. Do not write. |
| AR | Transcript_Cache | Read-only legacy brief/transcript cache. Do not write. |
| AS | Asset_URL_Hash | Read-only legacy hash. Do not write. |
| AT | Last_Analyzed_Date | Read-only legacy timestamp. Do not write. |

---

## `VIDEOS (Sleep Gummies)` layout

### Input columns (read)

| Column | Header | Purpose |
|--------|--------|---------|
| A | Hook Screenshot | Screenshot of video hook |
| B | ADMANAGE | Ad management ID |
| C | E-0496 \| Gum 1 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| D | E-0593 \| Gum 1 | **NEW in v0.7.6.** Sister-winner reference column - read-only, not used by the agent. |
| E | Variant # | Was column C. |
| F | Video Script | Was column D. |
| G | Actor | Was column E. |
| H | Hook # | Was column F. |
| I | Writer | Was column G. |
| J | Designer | Was column H. |
| K | ClickUp Card ID | **ClickUp task ID - use this to fetch the brief.** Was column I. |
| L | Partnership Ad? | Was column J. |
| M | Hook Type | Was column K. |
| N | Customer Avatar | **Write target.** Chip dropdown. See `avatars.md` §1.4 (4 `DSCA=` options as of v0.8.0, identical to `IMAGES (Sleep Gummies)!J`; was 2 in v0.7.x). Was column L. |
| O | FUNNEL STAGE | **Write target.** Classic dropdown - `TOF` / `MOF` / `BOF`. Was column M. |
| P | Ad Type | Was column N. |
| Q | LP | Was column O. |
| R | Homepage | Was column P. |
| S | Landing Page URL | Was column Q. |
| T | Ad Name | Was column R. |
| U | 1x1 | Was column S. |
| V | 4x5 | Was column T. |
| W | 9x16 | **Primary video asset** - 9x16 format. Was column U. |

### Approved output columns (the only writable cells)

| Column | Header | Hook/Angle | Notes |
|--------|--------|------------|-------|
| X | Headline | Balanced (primary) | 6-10 words |
| Y | Headline Var. 1 | Curiosity | Open a loop |
| Z | Headline Var. 2 | Proof | Lead with credibility |
| AA | Headline Var. 3 | Pain | Name the problem |
| AB | Headline Var. 4 | Transformation | Before/after framing |
| AC | Primary | Skeptic-to-believer | Long form (8-14 lines) |
| AD | Primary Var. 1 | Proof-led | Long form |
| AE | Primary Var. 2 | Pain-led | Long form |
| AF | Primary Var. 3 | Social proof / customer voice | Medium (5-8 lines) |
| AG | Primary Var. 4 | Offer / urgency | Short (3-5 lines) |
| AH | Promo Code | - | **Write target (copy).** TRY20, written by the copy pipeline as part of the standard block. Read-only for the tracker/media-buyer side (confirmed with meta-media-buyer-agent, 2026-08-05) - only copy authors it. |
| AI | Ad Description | - | **Write target (copy).** Required on every ingested row per meta-intake SKILL.md; written by the copy pipeline. |
| AJ | Display Link | - | Read-only. Do not write. |
| AK | UTM Parameters | - | Read-only. Do not write. |
| AL | CTA | - | Read-only. Do not write. |

### Status & cache columns

| Column | Header | Purpose |
|--------|--------|---------|
| AM | Row Type | Row classification |
| AN | Status | Read-only. Do not write. |
| AO | Visual_Analysis_Cache | Read-only legacy cache. Do not write. |
| AP | Transcript_Cache | Read-only legacy brief/transcript cache. Do not write. |
| AQ | Asset_URL_Hash | Read-only legacy hash. Do not write. |
| AR | Last_Analyzed_Date | Read-only legacy timestamp. Do not write. |

---

## Per-tab key column quick-reference

The image and video write maps are **no longer shared** across products. Reference this table any time SKILL.md uses a per-tab column letter.

| Logical field | `IMAGES (Flower)` | `IMAGES (Sleep Gummies)` | `VIDEOS (Flower)` | `VIDEOS (Sleep Gummies)` |
|---|---|---|---|---|
| Code / Variant # | G | E | G | E |
| Description / Video Script | H | F | H | F |
| Writer | I | G | K | I |
| Designer | J | H | L | J |
| ClickUp Card ID | K (funnel-stage only) | I (funnel-stage only) | M (primary brief source) | K (primary brief source) |
| **Customer Avatar (WRITE)** | **L** | **J** | **P** | **N** |
| **FUNNEL STAGE (WRITE)** | **M** | **K** | **Q** | **O** |
| Ad Type | N | L | R | P |
| LP | O | M | S | Q |
| Homepage | P | N | T | R |
| Landing Page URL | Q | O | U | S |
| Ad Name | R | P | V | T |
| 1x1 (image primary / video 1x1) | S | Q | W (`"1x1 "` trailing space) | U |
| 4x5 | T | R | X | V |
| 9x16 (video primary) | U | S | Y | W |
| **Copy block (WRITE) - Headline → Primary Var. 4** | **V:AE** | **T:AC** | **Z:AI** | **X:AG** |
| Promo Code | AF | AD | AJ | AH |
| Ad Description | AG | AE | AK | AI |
| Display Link | AH | AF | AL | AJ |
| UTM | AI | AG | AM | AK |
| CTA | AJ | AH | AN | AL |
| Row Type | AK | AI | AO | AM |
| Status | AL | AJ | AP | AN |

`product_category` is set by the tab name. See SKILL.md "Tab-mismatch
check" for the safeguard against rows filed in the wrong tab.

---

## ClickUp integration

**Team ID:** 9017980898
**Space ID:** 90174501393

**Lists:**
- Video Ads: 901711553702
- Static Image Ads: 901711558014
- Pod 1 UGC: 901711560388
- Pod 2 UGC: 901712123770
- Pod 3 Axon: 901712093295

**Account alias:** "clean-green"

**Fetch pattern (videos):** Use `CLICKUP_GET_TASK` with the task ID
from column M on `VIDEOS (Flower)` or column K on `VIDEOS (Sleep
Gummies)`. The `team_Id` parameter requires camelCase (capital I).

**Fetch pattern (images, funnel-stage inference only):** Use
`CLICKUP_GET_TASK` with the task ID from column K on `IMAGES (Flower)`
or column I on `IMAGES (Sleep Gummies)`.
