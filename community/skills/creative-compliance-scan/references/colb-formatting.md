# The "Meta Compliance Agent" column - values + conditional formatting

The image-compliance verdict lane is the column whose **row-1 header == `Meta Compliance Agent`** on all 4 META Ad Upload Sheet tabs. It is col **B today (2026-06-09)**, but **NEVER hardcode B** - resolve it by header every run (read row 1, find the column whose header is `Meta Compliance Agent`). If a column is inserted/removed it shifts; both the cell writes AND the conditional-format range below must follow the header to its new column index, or you will write/colour the wrong column. I am the sole writer of image verdicts there.

## Cell values (what Phase 1 / 1-V writes) - THREE outcomes
- PASS    -> `PASS (creative v2 <ts PT>) - <evidence: clean, no banned text, imagery agreed clean>`
- FAIL    -> `FAIL (creative v2 <ts PT>) - <evidence: matched banned term(s) / confirmed imagery / Meta-disapproved>`
- UNCLEAR -> `UNCLEAR (creative v2 <ts PT>) - <why uncertain>; needs human review` (anything not callable with 100% certainty: imagery disagreement, ambiguous semantic claim, low-confidence read, or our-FAIL-but-Meta-approved)
- SCAN ERROR (creative 404/inaccessible) -> `SCAN ERROR (image) - <ts> - 1x1 inaccessible, needs re-share` (renders as UNCLEAR/else color)
- NO CREATIVE (no 1x1 and no 9x16) -> `NO CREATIVE (image) - <ts> - needs review`
- 9x16 fallback used -> add a `(9x16)` tag.
- TAB-MISMATCH (a non-tab-product creative, e.g. a gummies ad on the Flower tab) -> keep the PASS/FAIL/UNCLEAR prefix and APPEND `\nMISMATCH: <actual product> creative on <tab> tab - <action>`.

## Conditional formatting (the colors)
Adam's required logic, on col B of ALL 4 tabs:
- cell text **starts with PASS** -> GREEN (rgb 0.7137255, 0.8784314, 0.8039216)
- cell text **starts with FAIL** -> RED  (rgb 0.95686275, 0.6, 0.6)
- cell text **starts with UNCLEAR** -> LIGHT BLUE (rgb 0.81, 0.886, 0.953)
- **anything else (NOT_BLANK)** -> amber fallback (rgb 1, 0.8980392, 0.4)

Four BooleanRule rules on the **resolved** Meta-Compliance-Agent column range (col B today = `B2:B<lastrow>`, grid_range startColumnIndex=1/endColumnIndex=2 - but use the 0-based index of wherever the `Meta Compliance Agent` header currently sits). The three TEXT_STARTS_WITH prefixes are mutually exclusive so their order among themselves does not matter; what matters is they ALL sit ABOVE the NOT_BLANK amber fallback.

## CRITICAL - rule PRIORITY (the bug Adam caught 2026-06-09)
Rules evaluate **first-match-wins, lowest index first**. The `NOT_BLANK -> amber` fallback MUST be the LOWEST priority (highest index), BELOW the PASS/FAIL/UNCLEAR rules. If NOT_BLANK sits on top, every filled cell renders amber, masking the real colors. Correct: PASS/FAIL/UNCLEAR rules first (any order), NOT_BLANK last.

## Verify + fix tooling
- READ current rules: `GOOGLESHEETS_GET_CONDITIONAL_FORMAT_RULES {spreadsheet_id, worksheet_id:<sheetId>}` (returns per-sheet `rules[]` with index + condition + grid_range).
- MOVE priority: `GOOGLESHEETS_MUTATE_CONDITIONAL_FORMAT_RULES {spreadsheet_id, sheet_id, operation:"MOVE", index, new_index}`.
- ADD a rule (e.g. the UNCLEAR->light-blue rule) - VERIFIED working arg shape: requires `sheet_id` (NOT worksheet_id) + `operation:"ADD"` + `index` (insert position, put it ABOVE the NOT_BLANK fallback) + a full `rule` object:
  ```
  {spreadsheet_id, sheet_id:<id>, operation:"ADD", index:2,
   rule:{ ranges:[{sheetId:<id>, startRowIndex:1, endRowIndex:<lastrow>, startColumnIndex:1, endColumnIndex:2}],
          booleanRule:{ condition:{type:"TEXT_STARTS_WITH", values:[{userEnteredValue:"UNCLEAR"}]},
                        format:{backgroundColor:{red:0.81, green:0.886, blue:0.953}} } }}
  ```
  (The UNCLEAR rule was added to IMAGES (Flower) at index 2 on 2026-06-10; ADD it on the other 3 tabs when v2 runs on them.)
- sheetIds: IMAGES (Sleep Gummies) 491729225 · IMAGES (Flower) 1711671268 · VIDEOS (Sleep Gummies) 1313921284 · VIDEOS (Flower) 1214685724.

(The 4 tabs also carry unrelated rules - a `TEXT_CONTAINS "killed"`->red on the ClickUp Status col, white NOT_BLANK on Added-to-Sheet col D, status-color rules on Meta Review Status col E, and broad B:K header bands. Those are different columns/ranges - do NOT touch them when fixing col B.)
