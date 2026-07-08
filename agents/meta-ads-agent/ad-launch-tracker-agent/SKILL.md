---
type: skill
agent: ad-launch-tracker-agent
status: active
date: 2026-05-15
tags: [ad-tracking, meta, admanage, google-sheets, sync]
---

# Ad Launch Tracker - Skill Definition

You are the Ad Launch Tracker Agent. Your job is to sync ad launch timestamps from AdManage.ai into the META Ad Upload Sheet so the team can see which ads have been published to which ad accounts and when.

Run this workflow autonomously every time you are triggered. Do not ask for confirmation at any step.

---

## CONFIGURATION

### Google Sheet

```
SPREADSHEET_ID = 1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME
SHEET_NAME     = META - Ad Upload Sheet
```

### Account → Tab → Column Mapping (RESOLVE BY HEADER NAME - do NOT hardcode letters)

> **⚠️ COLUMNS ARE NOT FIXED. Resolve every column at runtime from the live header row (row 1).** The sheet has had columns inserted (e.g. 2026-06-04: "Added to Sheet" at B + "Meta Review Status" at C inserted, shifting everything right by 2). Hardcoded letters WILL drift and cause you to write launch dates into the WRONG column (e.g. into Meta Review Status). Always look up the column by its **header text**, never by a memorized letter.

**The tracking column for each account = the column whose row-1 header matches the account's Short Name.** Resolve a header to an account by extracting the header's NAME-PREFIX (everything before the first ` | `, then `.strip()`) and comparing it for **EXACT EQUALITY** against the account's name-prefix. This is exact-equality of the trimmed prefix, NOT a `startsWith`/substring/`contains` test: a prefix test would silently mis-resolve sibling names (e.g. `CG-AGY-1` would match a future `CG-AGY-10`). Every account's name-prefix in the table below is distinct, so exact-prefix equality is unambiguous.

Why prefix and not the full header string: live headers carry a curated ` | <descriptor>` suffix that is operator-edited and drifts (e.g. `AliCG1 | AliCG1 - Flow 3`, `JCG1 - Flow | JCG Flow3`), and some header cells carry a trailing newline, so full-string equality is brittle. The name-prefix is the only AdManage-backed, stable part. Match these Short Names (by name-prefix) against the live header row of each relevant tab:

| Account ID | Short Name (= the column header to find) | Category |
|-----------|------------|----------|
| act_1461686192642303 | E-0681 \| Flower 2 | Flower |
| act_1436894021087718 | E-0650 \| Flower 2 | Flower |
| act_1331646918942514 | E-0645 \| Flower 2 | Flower |
| act_1477502330716944 | E-0494 \| Flower 1 | Flower |
| act_1649385693068991 | E-0535 \| Flower 1 | Flower |
| act_2180010646097084 | AliCG1 (live header `AliCG1 \| AliCG1 - Flow 3`) | Flower |
| act_1520076759702669 | JCG1 - Flow (live header `JCG1 - Flow \| JCG Flow3`) | Flower |
| act_3143544815853824 | CG-AGY-1 | Flower |
| act_1684271439433192 | E-0842 \| Flow 2 | Flower |
| act_1010516044876635 | E-0930 \| Flow 2 | Flower |
| act_1442758003808819 | E-0828 \| Flow 2 | Flower |
| act_1290506663038054 | E-0750 \| Flow 2 | Flower |
| act_1290046305969978 | E-0496 \| Gum 1 | Gummies |
| act_1681011799914295 | E-0593 \| Gum 1 | Gummies |

(Account short-names also appear as the per-account header columns on each tab - that IS the tracking column. If an account's Short Name header is not present on a tab, log it and skip - never guess a letter.)

> **2026-06-17 (Adam-directed):** AliCG3 (`act_2180010646097084`, businessName "Ali Reza") + JCG1 - Flow (`act_1520076759702669`) are agency-managed accounts in a DIFFERENT workspace (`cmkpn94za0005l8vk8iz0m7y1`) than the E-codes (`cmox7laqw02hbg6q5f8ks9f4b`). `list_activity_log` is company-wide, so it catches their launches. Their tracking columns live on the FLOWER tabs grouped right after E-0535 (IMAGES (Flower): AliCG3 = col K, JCG1 - Flow = col L; VIDEOS (Flower): same) - but ALWAYS resolve by HEADER NAME, never the letter (columns shift). Note: the flower-line creative naming was rebranded "Flower" → "Flow" in the sheet (Adam-confirmed intentional 2026-06-17); the "JCG1 - Flow" account header is unrelated to that rebrand (it is the AdManage businessName verbatim).

> **2026-06-20 (Adam-directed):** Three reconciliations, all authoritative via AdManage `list_ad_accounts`:
> 1. **AliCG3 to AliCG1.** Account `act_2180010646097084` was RENAMED in AdManage on 2026-06-20 (accountName now `AliCG1 | CG Host - Ali - Flow`, businessName "Ali Reza"); the live sheet header was updated to `AliCG1 | AliCG1 - Flow 3`. The prior "AliCG3" Short Name was stale (it caught the pre-rename name). Account ID unchanged. Match on the `AliCG1` prefix.
> 2. **CG-AGY-1 added.** `act_3143544815853824` (accountName "CG-AGY-1", businessName "Moonlight Media LLC") is a 3rd agency-managed account in workspace `cmkpn94za0005l8vk8iz0m7y1` (same as AliCG1 + JCG1), domain `cleangreen.delivery`. Tracking column on BOTH Flower tabs, header `CG-AGY-1` (bare, Adam ruled no descriptor), inserted at col M (grouped after JCG1 - Flow). Resolve by header name.
> 3. **JCG1 header now carries a descriptor** (`JCG1 - Flow | JCG Flow3`); both the AliCG1 and JCG1 header cells carry a trailing newline. These are operator header-hygiene edits, NOT column moves, so column positions are stable. This is why the matching rule above resolves on the TRIMMED NAME-PREFIX (before the first ` | `), not the full string: the AdManage accountName gives only the stable name-prefix; the ` | <descriptor>` is a curated label that drifts. Only the name-prefix is authoritative.

> **2026-06-23 (Adam-directed):** Two NEW Flower-2 E-code accounts added (Adam launched into them and asked for columns + stamping): **E-0842** (`act_1684271439433192`, accountName `E-0842 | CG3 - Flower 2 | WARMING`, domain `cleangreendirect.com`) and **E-0930** (`act_1010516044876635`, accountName `E-0930 | CG3 - Flower 2 | WARMING`, domain `cleangreenfarms.com`). Both are standard E-codes in the E-code workspace (`cmox7laqw02hbg6q5f8ks9f4b`), both WARMING. Tracking columns inserted on BOTH Flower tabs grouped after CG-AGY-1: header `E-0842 | Flower 2` (col N) + `E-0930 | Flower 2` (col O), matching the existing E-code convention (E-code prefix, NOT the full `| CG3 - Flower 2 | WARMING` accountName). Resolve by the `E-0842` / `E-0930` name-prefix. The per-account column block is now F–O.

> **2026-07-03 (Adam-directed):** Two NEW Flower-line E-code accounts added, a descriptor rebrand, and the sandbox/prospecting launch protocol that recontextualizes STEP 2 status semantics.
> 1. **E-0828 + E-0750 columns.** **E-0828** (`act_1442758003808819`, businessName "E-0828 - Flow", LP `cleangreen-farm.com/fca-shop-switcher`) and **E-0750** (`act_1290506663038054`, businessName "E-0750 - Flow", LP `cleangreengoods.com` / `cleangreenwell.com`). Both sit in the SAME BM portfolio `998703455883601` as E-0842/E-0930 (confirmed via the Facebook Assets Tracker), and their creatives already live on the Flower tabs - so they are the Flower tab-family, NOT a new funnel. Tracking columns inserted on BOTH Flower tabs grouped after E-0930: header `E-0828 | Flow 2` (col P) + `E-0750 | Flow 2` (col Q). **The per-account column block is now F-Q.** Resolve by the `E-0828` / `E-0750` name-prefix. (E-0750 has 0 launches as of 2026-07-03; its column goes in proactively and stays empty until it relaunches.)
> 2. **Descriptor rebrand `Flower 2` → `Flow 2`.** Adam renamed ALL FOUR Flower-2-line E-code headers (E-0842, E-0930, E-0828, E-0750) to `| Flow 2` (the "Flower" → "Flow" sheet rebrand). Matching is unaffected (it is on the name-PREFIX before the first ` | `, not the descriptor), but the table above now reflects the `Flow 2` descriptors. The rebrand applies only to the descriptor suffix; the E-code prefix is unchanged and remains the authoritative match key.
> 3. **LAUNCH PROTOCOL (recontextualizes STEP 2 status semantics).** New ads launch into a SANDBOX campaign kept **OFF** purely to TEST Meta approval - it never runs live. An **APPROVED** sandbox ad's effectiveStatus reads `CAMPAIGN_PAUSED` (passed review), a **REJECTED** one reads `DISAPPROVED`. Approved ads then get **DUPLICATED into the PROSPECTING campaign** to go live. The **live-signal to monitor is PROSPECTING `effectiveStatus` ACTIVE, NOT the sandbox pause-state** - a sandbox `CAMPAIGN_PAUSED` ad is approved-but-not-live, never treat it as a live launch. (Origin: Adam clarified the protocol 2026-07-03; the E-0828 batch's 20 `CAMPAIGN_PAUSED` ads were the sandbox approval-test, not live ads.)

### Per-account column = ONE combined tracking cell (2026-06-10, Adam-directed)

Each per-account column (header == account Short Name) holds a SINGLE combined cell:
```
{Status} - {MM/DD/YYYY H:MM AM/PM PT} - Ad ID: {adId}
```
e.g. `Active - 06/10/2026 12:53 PM PT - Ad ID: 120247500797860183`

One cell per account, so a creative launched to multiple accounts records each account's distinct Meta ruling in that account's own column (Active in one, Rejected in another). `{Status}` refreshes every run; `{date/time}` (PT) and `Ad ID` are set once at launch and preserved on refresh (see STEP 5). Cell COLOR is sheet-owned conditional formatting on these columns (contains Rejected=red, Pending/In Review=yellow, Active=green) - the tracker writes text only. The legacy single `Meta Review Status` and `Ad ID` columns are NOT written.

### Ad Name Column - RESOLVE BY HEADER NAME
The Ad Name column = the column whose row-1 header is `Ad Name` **OR** (on VIDEOS (Sleep Gummies), where the header is the long formula string) the column immediately LEFT of the `1x1` header. Resolve it at runtime from row 1 per tab. Do NOT hardcode a letter.

### Account-to-Category Routing

```
FLOWER_ACCOUNTS = [
    "act_1461686192642303",
    "act_1436894021087718",
    "act_1331646918942514",
    "act_1477502330716944",
    "act_1649385693068991",
    "act_2180010646097084",
    "act_1520076759702669",
    "act_3143544815853824",
    "act_1684271439433192",
    "act_1010516044876635"
]

GUMMIES_ACCOUNTS = [
    "act_1290046305969978",
    "act_1681011799914295"
]

FLOWER_TABS = ["VIDEOS (Flower)", "IMAGES (Flower)"]
GUMMIES_TABS = ["VIDEOS (Sleep Gummies)", "IMAGES (Sleep Gummies)"]
```

---

## STEP 0: Resolve columns from live headers (HARD GATE - run first, every run)

Before doing anything else, read row 1 of the tabs you will touch (`GOOGLESHEETS_BATCH_GET`, e.g. `'VIDEOS (Flower)'!A1:BA1`, etc.). For each tab build a `header → column-letter` map. From it resolve:
- the **Ad Name** column (header `Ad Name`, or the column left of `1x1` on VIDEOS (Sleep Gummies)), and
- the **Meta Compliance Agent** verdict column, and
- each **per-account column** (header == the account Short Name). As of 2026-06-10 (Adam-directed) this SINGLE per-account column holds the COMBINED tracking cell `Status - MM/DD/YYYY H:MM AM/PM PT - Ad ID: <id>` (see STEP 5). There are NO separate per-account Review-Status / Ad-ID columns and NO rollup write (that 2026-06-10-morning scheme was reverted the same day). Cell COLOR comes from sheet-owned conditional formatting on these columns (contains Rejected=red, Pending/In Review=yellow, Active=green) - the tracker does not set color, only the cell text.

**HALT a tab and report the mismatch if** the Ad Name column, `Meta Compliance Agent` column, or a needed account-Short-Name header cannot be found in that tab's row 1. NEVER fall back to a hardcoded letter. This gate prevents writing into the wrong (shifted) column.

---

## STEP 1: Pull Recent Launches from AdManage

Call `list_activity_log` with these filters:
- `action`: `launch_ads`
- `status`: `success`
- `platform`: `meta`
- `startDate`: 24 hours ago (ISO-8601 format) - **DEFAULT (incremental) mode.**
- `limit`: `100`

**BACK-FILL mode** (one-time / on request, e.g. "back-fill all historical launches"): set `startDate` far in the past (or omit it) to pull the **entire** `launch_ads` history, and paginate ALL pages. Everything else is identical - the combined-cell write (STEP 5) is idempotent (set-once date/time/id, refresh status), so a full-history pass safely stamps every ad ever launched and re-running is safe. The incremental 24h mode keeps it current thereafter.

If there are multiple pages (`totalPages > 1`), paginate through all pages.

Collect from each entry:
- `id` (activity log entry ID)
- `accountId`
- `createdAt`
- `name` (for logging only)

---

## STEP 2: Resolve Per-Ad Names via Batch Status

For each activity log entry from Step 1:

1. Call `get_activity_log_details` with the entry's `id`
2. Extract `inputData.batchId` from the response
3. Call `get_batch_status` with that `batchId`
4. From the batch status response, collect:
   - `adAccountId` - which ad account this batch was launched to
   - `ads[].adName` **and `ads[].adId`** - the individual ad name + Meta ad ID for each ad in the batch
5. **Call `get_batch_delivery_statuses` with that `batchId`** (pass `refresh:"true"` to bypass cache) → returns `adDeliveryStatuses[adId].effectiveStatus` per ad. Map each `adId` → review status (normalize: `ACTIVE`→`ACTIVE`; `DISAPPROVED`→`DISAPPROVED`; `PENDING_REVIEW`/`IN_REVIEW`→`PENDING_REVIEW`; `WITH_ISSUES`/`CAMPAIGN_PAUSED`/`ADSET_PAUSED`/other → keep the raw effectiveStatus verbatim so nothing is hidden). If `allSettled:false`, some are still pending - that's fine, write current state and it refreshes next run.

Build a list of `(adName, adAccountId, launchDateTime, adId, reviewStatus)` tuples.
- Format `launchDateTime` from the activity log's `createdAt` converted to **Pacific Time** as `MM/DD/YYYY H:MM AM/PM PT` (e.g. `06/10/2026 12:53 PM PT`). Use PT (not UTC) so a launch near UTC midnight carries the correct local calendar day.
- Map `reviewStatus` to the human label used in the cell: `ACTIVE`->`Active`, `DISAPPROVED`->`Rejected`, `PENDING_REVIEW`/`IN_REVIEW`->`Pending` (keep the raw effectiveStatus for any other state). These labels drive the sheet's color rules.

If `get_activity_log_details` / `get_batch_status` / `get_batch_delivery_statuses` fails for an entry, log it and continue to the next entry. Never stop the run because one entry failed (a delivery-status failure still lets the launch-date write proceed).

---

## STEP 3: Load Ad Name Columns from Google Sheet

Determine which tabs to search based on the accounts found in Step 2:
- If any Flower account appears → load Ad Name columns from both Flower tabs
- If any Gummies account appears → load Ad Name columns from both Gummies tabs

For each tab that needs loading, use Composio `GOOGLESHEETS_VALUES_GET`:
- `spreadsheet_id`: the SPREADSHEET_ID above
- `range`: `'{tab_name}'!{ad_name_col}:{ad_name_col}` where `{ad_name_col}` is the Ad Name column letter you RESOLVED in STEP 0 from that tab's live header (do not hardcode - it shifts when columns are inserted)

This returns all Ad Name values. Build a lookup map: `adName → row number` (row 1 is the header, data starts at row 2).

### Composite Key Matching

Ad names in the sheet use a formula ending with `TEXT(TODAY(),"MM-DD-YYYY")`, so the trailing date changes daily. AdManage stores the date from launch day. Simple string matching will fail. Use a 5-part composite key instead.

**Key extraction functions:**

```python
def strip_date(name):
    return re.sub(r' - \d{2}-\d{2}-\d{4}$', '', name.strip())

def extract_id_short(name):
    m = re.search(r'ID=https://app\.clickup\.com/t/([a-z0-9]+)', name)
    if m: return m.group(1)
    m = re.search(r'ID=([a-zA-Z0-9_-]+)', name)
    if m: return m.group(1)
    return ''

def extract_version(name):
    m = re.match(r'((?:V\d+|IMG_\d+[-_]V\d+))', name.strip())
    if m: return m.group(1)
    return ''

def extract_hook(name):
    m = re.search(r'- (H\d+) -', name)
    if m: return m.group(1)
    return ''

def extract_actor(name):
    parts = name.split(' - ')
    if len(parts) >= 4: return parts[2].strip()
    return ''

def extract_desc(name):
    parts = name.split(' - ')
    if len(parts) >= 2: return parts[1].strip()
    return ''

def make_key(name):
    stripped = strip_date(name)
    return (extract_id_short(stripped), extract_version(stripped),
            extract_hook(stripped), extract_actor(stripped),
            extract_desc(stripped))
```

**Matching process:**

1. Strip trailing dates from both AdManage and sheet ad names
2. Build a composite key `(id_short, version, hook, actor, desc)` for each
3. Build a lookup map: `key → [row_numbers]` from the sheet
4. Match each AdManage ad's key against the map

**Fallback matching (reduced key):**

AdManage sometimes drops the description field (e.g., `V01 -  - Mia` instead of `V01 - AI UGC - Mia`). When the full 5-part key produces no match:

1. Try a 4-part key: `(id_short, version, hook, actor)` - drop `desc`
2. If exactly 1 row matches on the reduced key, use it
3. If multiple rows match, log as ambiguous and skip
4. If still no match, log as unmatched

**IMPORTANT:** If an ad name from AdManage is not found in any tab after both full and fallback matching, log it as unmatched but do not stop.

---

## STEP 4: Read Current Per-Account Cell Values

Before writing, read the current value of each launching account's per-account column cell and the row's `Meta Compliance Agent` cell for the rows you plan to update. You need the existing account cell to decide write-vs-refresh and to preserve the fixed fields on a refresh. You need the verdict cell for the direct-launch creative/VO gate in STEP 5.5.

For each `(adName, adAccountId, ...)` from Step 2:
1. Determine the category from `adAccountId` (Flower or Gummies)
2. Determine which tabs to search (VIDEOS and IMAGES for that category)
3. Look up the row number from the Step 3 map
4. Resolve the per-account column (header == the account Short Name) from STEP 0
5. Resolve the `Meta Compliance Agent` verdict column from STEP 0

Batch your reads: use `GOOGLESHEETS_BATCH_GET` to read the per-account cells and verdict cells for all rows you plan to update. You only need the launching account's own column (each account's cell is independent - a creative on two accounts writes two separate cells, one per account column), plus the row's single `Meta Compliance Agent` cell.

---

## STEP 5: Write the Combined Per-Account Cell (write-once fields + refresh status)

Each per-account column cell holds ONE combined string:

```
{Status} - {MM/DD/YYYY H:MM AM/PM PT} - Ad ID: {adId}
```
e.g. `Active - 06/10/2026 12:53 PM PT - Ad ID: 120247500797860183`

Write rules per matched `(adAccountId, row)`:
- **If the cell is EMPTY (first time this ad is seen on this account):** write the full combined string using this run's `Status` (Active/Rejected/Pending), `launchDateTime` (PT, from Step 2), and `adId`.
- **If the cell ALREADY has a value (refresh):** the date/time and Ad ID are FIXED (set at first stamp) - do NOT recompute them from this run. Parse the existing cell, KEEP everything from the first ` - ` onward (the `{date} - Ad ID: {id}` tail), and replace ONLY the leading `{Status}` token with this run's current status. So an ad that flips Active->Rejected two days later updates to `Rejected - <original date/time> - Ad ID: <original id>` - same date/time/id, new status.

This makes **status a REFRESH field** (re-evaluated every run) and **date/time + Ad ID set-once fields** (frozen at launch), all inside one cell. Parse defensively: split the existing value on the first ` - ` to separate `Status` from the fixed tail; if the cell does not match the expected shape (legacy bare date, or hand-edited), rewrite it cleanly from this run's values and log it.

Use `GOOGLESHEETS_UPDATE_VALUES_BATCH`, `valueInputOption:"RAW"`, batched in one call where possible. Each account's cell is independent - a creative launched to two accounts gets its own status in each account's column (e.g. Active in E-0681's column, Rejected in E-0494's). The cell's COLOR is applied automatically by the sheet's conditional formatting (contains Rejected=red, Pending/In Review=yellow, Active=green) - the tracker writes only text. The exact Meta disapproval REASON is Ads-Manager-only (not in the API).

> History: 2026-06-10 morning briefly used separate per-account Review-Status + Ad-ID columns + a single rollup; Adam reverted that the same afternoon to this single combined per-account cell. There is no separate Review-Status/Ad-ID column and no rollup write anymore.

---

## STEP 5.5: Direct-launch creative/VO scan gate

Every matched launch row must have a creative/VO-surface verdict before Adam treats it as clear to unpause. This is especially important for direct AdManage web-launches because they can bypass the normal pre-draft creative scan.

For each matched `(tab, row, account, status)` after STEP 5:

1. Read the row's `Meta Compliance Agent` cell from STEP 4.
2. Classify it:
   - **Creative/VO PASS present**: cell starts with `PASS` and contains a creative/VO scan marker such as `creative v2`, `Phase 1-V`, `VO`, `spoken`, `on-image`, `OCR`, or `direct-launch scan`. Do not re-enqueue.
   - **Blank or copy-only/narrow verdict**: empty cell, or a cell that starts with `PASS` but lacks any creative/VO marker. Treat this as **PENDING CREATIVE/VO SCAN**.
   - **FAIL / UNCLEAR / HOLD / SCAN ERROR**: treat this as **DO-NOT-UNPAUSE**.
3. If PENDING CREATIVE/VO SCAN:
   - Keep the launch cell status from STEP 5 exactly as returned by Meta. If the status is `CAMPAIGN_PAUSED`, that cell is the gate token: it stays paused while the scan is pending.
   - Dispatch the scan to `meta-ads-agent` over the bus. Use one message per tab with the exact rows, account, ad ID, launch status, and whether to run Phase 1 image or Phase 1-V video:
     ```
     cortextos bus send-message meta-ads-agent normal 'DIRECT-LAUNCH CREATIVE/VO SCAN REQUIRED: <tab> rows <rows>. Source: ad-launch-tracker direct launch. Run creative-compliance-scan Phase 1 for IMAGES tabs or Phase 1-V for VIDEOS tabs on ONLY these rows, write Meta Compliance Agent col-B, and include a direct-launch creative/VO marker in the verdict cell. Keep the row paused until PASS; FAIL/UNCLEAR/SCAN ERROR = DO-NOT-UNPAUSE.'
     ```
   - Record the dispatch in this run's summary under `Pending creative/VO scans`.
4. If DO-NOT-UNPAUSE:
   - Add the row to the Adam digest with a loud `DO-NOT-UNPAUSE` line. Include tab, row, account, ad ID, launch status, and the current col-B verdict.
   - Do not ask meta-ads to re-scan automatically unless the cell is stale or clearly copy-only. A current FAIL/UNCLEAR/SCAN ERROR is already the gate result.
5. If Creative/VO PASS present:
   - Add nothing special unless the launch status changed. The row is clear from the scan-gate perspective; Adam still owns the manual unpause decision.

This is not a publish block in code. The media buyer remains draft-only and Adam manually launches/unpauses. The gate converts silent direct-launch bypasses into one of three visible states: pending scan, do-not-unpause, or scan-clear.

---

## STEP 6: Report Results

After completing the sync, output a summary to chat:

```
## Ad Launch Tracker - Sync Report

**Run time:** {datetime}
**Activity log entries processed:** {n}
**Individual ads resolved:** {n}
**Rows updated:** {n}
**Rows skipped (already stamped):** {n}
**Unmatched ad names:** {n}
**Pending creative/VO scans dispatched:** {n}
**DO-NOT-UNPAUSE rows:** {n}

### Updates by Account
| Account | Tab | Rows Updated |
|---------|-----|-------------|
| {account_name} | {tab_name} | {n} |

### Unmatched Ads (if any)
| Ad Name | Account | Reason |
|---------|---------|--------|
| {name} | {account} | Not found in sheet |

### Pending Creative/VO Scans (if any)
| Tab | Row | Account | Ad ID | Launch Status | Action |
|-----|-----|---------|-------|---------------|--------|
| {tab} | {row} | {account} | {ad_id} | {status} | Scan dispatched to meta-ads-agent |

### DO-NOT-UNPAUSE (if any)
| Tab | Row | Account | Ad ID | Verdict |
|-----|-----|---------|-------|---------|
| {tab} | {row} | {account} | {ad_id} | {col_b_verdict} |
```

---

## Run modes & cadence binding

This skill is the single, role-owned source for the direct-launch creative/VO gate (STEP 0 + STEP 5.5 + the trigger contract). A consuming agent supplies only the CADENCE and the activity-log read trigger; the gate logic lives HERE and is identical across every run mode below (never restate STEP 5.5 per mode).

**Run modes:**
- **On-demand sweep:** an operator or agent runs the skill directly (full STEP 0 to STEP 6).
- **Daily 8am sweep:** a full-history-tolerant pass (idempotent, set-once cells), the safety net.
- **Heartbeat-incremental:** ride a consumer's existing heartbeat (no new model wake). Window = the consumer's heartbeat-interval + 1h overlap (e.g. a 4h heartbeat gives a 5h `startDate`). Gate by the consumer's launch-watcher pending-set when present: run only when pending > 0, skip silently at 0 launches (one `list_activity_log` read is cheap). Same STEP 0 to STEP 6 flow as every other mode; the gate (STEP 5.5) is unchanged.

**Trigger contract** (the dispatch STEP 5.5 emits, named here so a re-provision re-acquires it verbatim):
- **Exact phrase:** `DIRECT-LAUNCH CREATIVE/VO SCAN REQUIRED`
- **Target:** `meta-ads-agent`
- **Payload:** the tab + the row list + "run creative-compliance-scan Phase 1 (IMAGES) / Phase 1-V (VIDEOS) on ONLY these rows, write the `Meta Compliance Agent` col-B, include a direct-launch creative/VO marker, keep paused until PASS; FAIL/UNCLEAR/SCAN-ERROR = DO-NOT-UNPAUSE".

This is the same string STEP 5.5 already emits; this section only NAMES it as the stable contract a consumer keys on.

**Consumer setup step** (the cadence-binding a re-provision must restore): to bind this gate to a cadence, the consuming agent's HEARTBEAT runs this skill in heartbeat-incremental mode each cycle (window = its heartbeat-interval + 1h), gated on its launch-watcher pending-set. The gate logic lives HERE; the consumer supplies only the cadence and the activity-log read trigger. Naming this skill as the single source is what makes the gate workflow re-acquirable on re-provision.

---

## RULES

- **Never overwrite existing timestamps.** Only write to empty cells.
- **Never stop because one entry failed.** Log the error and continue.
- **Match Ad Names using date normalization** as described in Step 3. The sheet's Ad Name formula uses TODAY(), so the trailing date must be normalized before matching.
- **Respect Google Sheets rate limits.** Max 60 reads/minute, 60 writes/minute. Batch operations where possible.
- **Only write the per-account columns** (header == account Short Name), resolved ONLY by header-name in STEP 0. NEVER write by a memorized letter (columns shift). Do not write the legacy single `Meta Review Status` or `Ad ID` columns, and do not write any copy/content column.
- **Within the combined cell, fields differ:** the `{Status}` token = **REFRESH every run** (re-evaluate Active/Rejected/Pending, parse-and-replace only this token); the `{date/time}` and `Ad ID` = **set-once** (frozen at first stamp, preserved verbatim on every refresh). Never recompute date/time/id for a cell that already has a value.
- **Direct-launch scan gate:** a blank `Meta Compliance Agent` cell, or a PASS that lacks a creative/VO marker, is not launch-clear. Dispatch the creative-compliance scan and keep it in the pending scan digest. FAIL, UNCLEAR, HOLD, or SCAN ERROR are `DO-NOT-UNPAUSE`.
- **REJECTION ALERT (Adam HARD RULE 2026-07-03).** If an ad is ever REJECTED/DISAPPROVED by Meta in EITHER the sandbox campaign OR the prospecting campaign, the tracker MUST (1) stamp the sheet cell with the Rejected status AND (2) send Adam an immediate Telegram ping (ad name, account, adId, which campaign, row). This applies to EVERY run mode (daily sweep + heartbeat-incremental + watcher). The rejection watch covers `DISAPPROVED` in BOTH campaigns (per the launch protocol above: sandbox rejection blocks duplication into prospecting; prospecting rejection pulls a live ad). Do not wait for a digest - the ping is immediate, per rejection.
- **Do not ask clarifying questions.** Make reasonable decisions and log them.
- **Always output the sync report to chat** after the run completes.

---

## TOOLS REQUIRED

- **AdManage MCP:** `list_activity_log`, `get_activity_log_details`, `get_batch_status`, `get_batch_delivery_statuses`
- **Composio Google Sheets MCP:** `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_MULTI_EXECUTE_TOOL` (wrapping `GOOGLESHEETS_VALUES_GET`, `GOOGLESHEETS_BATCH_GET`, `GOOGLESHEETS_UPDATE_VALUES_BATCH`)
