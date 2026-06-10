# Meta Image-Creative Compliance Scan - Worker Rubric

You scan Clean Green ad image creatives for Meta compliance. For each assigned row you DOWNLOAD the image, VIEW it (native vision), and judge PASS/FAIL against the rules below. You judge the IMAGE ONLY (visuals + any on-image text) - NOT ad copy in a sheet. Embed this verbatim in each scanner subagent prompt, plus the product-specific FAIL block from SKILL.md.

> COMPLIANCE SOURCE: the FAIL conditions below are an ILLUSTRATIVE working copy. The authoritative, always-current rules are the brain repo (read LIVE every run): `agents/meta-compliance-agent/references/rules.md` + `scan-rules.md` + `asset-type-scanners.md` in `CLEAN-APPS-DEV/clean-green-marketing-brain`. If the live rules differ, the live rules win - re-derive this block from them.

## Download recipe (per file)
1. Load tools once: `ToolSearch` query `select:mcp__claude_ai_Composio__COMPOSIO_MULTI_EXECUTE_TOOL`
2. `mkdir -p /tmp/<scan>/imgs`
3. For your fileids, call `COMPOSIO_MULTI_EXECUTE_TOOL` (sync_response_to_workbench=false) with one `GOOGLEDRIVE_DOWNLOAD_FILE` entry per fileid (batch ~15 per call), arguments `{"fileId":"<fileid>"}`. Each result returns `data.downloaded_file_content.s3url` (presigned ~1h) and `.name`.
4. For each s3url: `curl -sL "<s3url>" -o /tmp/<scan>/imgs/<row>.jpg`
5. `Read` each local jpg to VIEW it. Work in sub-chunks (download ~15, then Read+judge, then next) so URLs don't expire. If a download fails or the file is not an image (e.g. HTML), record verdict `"ERROR"`.

## FAIL conditions - a creative FAILS if ANY appear in the IMAGE (visual OR on-image text)

- **M-19d - cannabis imagery (HIGHEST PRIORITY, hard rule):** any visible cannabis flower bud, nug, ground flower, cannabis plant, or cannabis leaf - EVEN IF blurred, partial, faded, or out of focus. Blurred bud = FAIL, same severity (blurring a drug image is a circumvention signal). Cell element noun: "cannabis bud" / "cannabis leaf" / "cannabis plant" / "blurred cannabis bud".
  - NOT M-19d: the Clean Green brand logo / wordmark (a small stylized leaf in the logo is a BRAND mark - do NOT flag). Pine, mountains, generic foliage, the product pouch/jar = fine.
- **M-2 - banned words as on-image text:** bud, flower, weed, cannabis, marijuana, THC, THCA, CBD, CBN, hemp, indica, sativa, delta-8/9/10, HHC, strain, nug, eighth, gram, dispensary, pre-roll, hand-roll, joint, dank, stoned, smoke/smoking; discreet, stealth, plain box, plain mail, plain billing, unmarked, vacuum sealed, "no smells/labels/logos", "nothing on the statement/card"; legal, illegal, legality, scam, "package seizure", DEA, loophole, "federally compliant", "farm bill"; COA, "certificate of analysis", "lab results", "no pesticides/sprays".
- **M-2 medical (HARD):** the bare word "medical", or "medical card", "medical cannabis", "medical marijuana", "no medical card", "no prescription", "without a doctor".
- **M-20 - potency / superiority / comparison:** "potency"/"potent", "stronger than", "more potent than", "higher-quality than [shop/competitor]", "better than dispensary/the local shop", "not weak", "not gas station", "hits harder", "guarantees potency", "strongest".
- **M-4 - health/medical claims:** treats/cures/prevents/relieves a condition; "helps with sleep/anxiety/pain/inflammation/focus"; "doctor-recommended", "clinically proven", "FDA-approved"; before/after physiological framing.
- **M-5 - side-effects framing:** "no side effects", "no hangover", "no crash", "no jitters", "no paranoia", "no grogginess", "non-habit-forming", "no dependency".
- **M-8 - unverified press:** "As seen on CBS/FOX/USA Today/[outlet]" badges.

(Product-specific additions like M-13 sleep-onset and M-12 diagnostic-question headlines for Sleep Gummies are supplied in the dispatch prompt.)

If NONE of the above appear -> PASS. Clean product-in-package shots, lifestyle scenes, abstract/branded backgrounds, and compliant text-only offers PASS.

## Output - append one JSON object per row to your batch file (`/tmp/<scan>/verdicts/batch_<N>.jsonl`), one per line:
```
{"row":39,"code":"IMG_X","verdict":"FAIL","findings":[{"mcode":"M-13","element":"headline 'Fall asleep in 20 minutes'","fix":"replace with wind-down framing"}]}
```
- PASS -> `"findings":[]`.
- ERROR (download/view failed) -> `"verdict":"ERROR","findings":[{"mcode":"-","element":"download failed","fix":"retry"}]`.
- Keep `element` short and concrete (what + where). Use the canonical codes. For bud use M-19d with the exact phrasing.

## Return value (your final message)
A compact summary ONLY: `scanned=N pass=X fail=Y error=Z; FAIL rows: <row:primaryMcode, ...>`. Do NOT dump per-row detail in your return - it is in the batch file.
