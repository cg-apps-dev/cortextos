---
name: creative-compliance-scan
description: "The end-to-end Meta-compliance playbook for the META Ad Upload Sheet. PHASE 1 (v2 deterministic): scan each ad CREATIVE by extracting on-image text from THREE sources (two tiled native-vision passes + tesseract OCR), running a deterministic banned-word grep, judging bud/leaf imagery with two agreeing vision passes, and cross-checking Meta's own review status; write a THREE-outcome verdict - PASS (green) / FAIL (red) / UNCLEAR (light blue, for anything not 100% certain) - into the 'Meta Compliance Agent' column (col B). PHASE 1-V: the VIDEO variant - download the 9x16, transcribe the audio locally with Whisper (zero LLM tokens), extract hook/body/CTA frame text via tiled vision + OCR, same grep + same 3 outcomes (the edited video can diverge from the ClickUp brief, so the audio is the source of truth). PHASE 2: on Adam's request, rewrite the ad COPY on image-PASS rows to fully Meta-compliant, asset-aligned copy via a gated pipeline (parallel vision/copy subagents -> deterministic grep hard-gate -> meta-compliance-agent sign-off -> writer). Use whenever Adam says 'run the scan', 'check images against meta compliance', 'scan the video', 'check the video ads', 'rewrite the copy on the PASS rows', 'fix col B formatting', or to re-run any phase on any tab. Any agent should be able to run this verbatim."
triggers: ["compliance scan", "scan creatives", "scan the images", "image compliance", "creative compliance", "video compliance", "scan the video", "check the video ads", "video script compliance", "meta compliance agent column", "col B verdict", "pass fail scan", "run the scan", "m-code scan", "rewrite the copy", "rewrite ad copy", "copy rewrite", "make the copy compliant", "fix col B formatting", "M-19d", "M-25", "headline diversity"]
---

<!-- ============================================================================ -->
<!-- ORG-PRIVATE SKILL - clean-green-marketing ONLY. DO NOT PUBLISH UPSTREAM.       -->
<!-- This is brand-specific (hardcoded Clean Green spreadsheet IDs, product tabs,   -->
<!-- and Meta M-code workflow). It lives in community/skills/ ONLY so it is         -->
<!-- version-controlled and opt-in installable by ONE agent - it is NOT a generic   -->
<!-- reusable skill. NEVER run `submit-community-item` / `community-publish` on it   -->
<!-- and NEVER copy it into templates/agent/ (that would force it onto every agent).-->
<!-- Catalog entry is flagged org=clean-green-marketing, do_not_submit_upstream=true.-->
<!-- Durable home + re-acquire: see "Durability / re-acquire" at the bottom.         -->
<!-- ============================================================================ -->

# Creative & Copy Compliance Playbook (META Ad Upload Sheet)

> **ORG-PRIVATE (clean-green-marketing).** Brand-specific - not a generic community skill. Do not publish upstream or add to the base agent template. Re-acquire instructions + host prerequisites at the bottom.

Phases. PHASE 1 is the v2 DETERMINISTIC creative scan -> a verdict in the **`Meta Compliance Agent`** column (header-resolved each run - currently col B), with **three outcomes: PASS (green) / FAIL (red) / UNCLEAR (light blue)**. It extracts on-image text from THREE sources (2 native-vision tiled passes + tesseract OCR), runs a deterministic banned-word grep, judges bud/leaf imagery with 2 agreeing vision passes, cross-checks Meta's own review status, and routes anything uncertain to UNCLEAR instead of guessing. PHASE 1-V is the VIDEO variant (whisper audio transcript + tiled+OCR frame text + same grep + same 3 outcomes). PHASE 2 (only when Adam asks) rewrites the ad COPY on image-PASS rows. All are gated through the **meta-compliance-agent** (running fleet agent - loop via the bus) + the deterministic grep. Native vision + tesseract OCR are the trustworthy text readers; the Composio workbench `invoke_llm` FABRICATES - never let it judge or write copy.

> **CREATION CADENCE (Adam 2026-06-25):** run the gate at EACH creation stage - brief -> script -> ad - failing specific social-proof counts (M-16a) early = compliant-as-we-build, not just a post-hoc sheet scan. The creation lane (brief-writer / script / copy-gen) invokes the compliance gate at every stage so a banned count never reaches the upload sheet.

**No em dashes anywhere (fleet rule). Files are NOT public - download via authed Composio Drive.**

---

## COPY SOURCE HARD RULE (Adam, 2026-06-16 - read FIRST, non-negotiable, never free-hand)
**NEVER free-hand ad copy.** Every headline, primary text, ad description, and variation MUST be written to the LIVE brain copywriting spec - pulled fresh per run, never from memory or improvisation:
- `agents/meta-ads-agent/meta-ad-copy-agent/references/copy-framework.md` (5 hook-typed headlines, 5 body angles + shapes, §5.5 visual format contract, §4.1 clarity gate, per-product proof banks)
- `.../references/brand-voice.md` (tone/voice/DO-DON'T)
- `.../references/avatars.md`, `.../references/funnel-stage.md` (dropdown values + extraction)
- the brain copywriting skills (`copywriter-agent`, `meta-ad-copy-agent/SKILL.md`)
Process: run copy through the copywriter pipeline (parallel copywriter subagents, each READING the framework + the actual creative -> 5+5 to spec) -> central deterministic grep gate -> meta-compliance-agent sign-off -> write. Inline/freehand copy is a VIOLATION even if it looks good (origin: 2026-06-16, Adam caught a freehand flower rewrite that ignored the framework). The compliance source rule below is the same principle for the M-code rules.

---

## COLUMN RESOLUTION RULE (read first - applies to EVERY column, every run)
**Never hardcode a column letter. Resolve every column by its HEADER NAME from row 1 on each run.** The sheet gains and loses columns over time (it has had multiple structural inserts - ClickUp Status, Meta Compliance Agent, sister-winner cols), so any letter in this skill is a **point-in-time snapshot, not a constant**.
- The verdict column is the one whose **row-1 header == `Meta Compliance Agent`** - it happens to be col B today, but if a column is inserted/removed it moves, and you must follow the header, not the letter. The SAME applies to the conditional-formatting range (it must target wherever that header currently is) and to every other column you touch: `1x1`, `9x16`, `Code`, `ClickUp Card ID`, `Customer Avatar`, `FUNNEL STAGE`, and the copy block (`Headline` ... `Primary Var. 4`).
- Procedure every run: `GOOGLESHEETS_BATCH_GET` row 1 (e.g. `A1:BZ1`) -> map header name -> column index/letter -> use that. If an expected header is missing or renamed, HALT that tab and report the mismatch; do NOT guess or write to a shifted column.
- The letter tables below (and "currently B") are convenience snapshots as of 2026-06-09 ONLY. Confirm them against the live header row before any read or write.

---

## COMPLIANCE SOURCE RULE (read first - the rules are NOT in this skill)
**The canonical, always-current Meta compliance lives ONLY in the Clean Green Marketing Brain GitHub repo. Pull it LIVE on EVERY run - never localize, cache, or hardcode a banned-term list in this skill.** The repo always has the newest rules (new M-codes land there first, e.g. M-25).
- Repo: `CLEAN-APPS-DEV/clean-green-marketing-brain` (your `gh` account has read; the meta-compliance-agent owns the files).
- Files to read live each run: `agents/meta-compliance-agent/references/rules.md` (M-1..M-25, the M-code definitions + bans), `agents/meta-compliance-agent/references/scan-rules.md` (the scan index/tiers), `agents/meta-compliance-agent/references/asset-type-scanners.md` (which codes apply to which asset type). The Stage-2 copy generation guidance is `agents/meta-ads-agent/meta-ad-copy-agent/` (SKILL.md + references) - also read live.
- How: at the START of every run do a FRESH pull (never reuse a prior clone): `cd /tmp && rm -rf brain && gh repo clone CLEAN-APPS-DEV/clean-green-marketing-brain brain -- --depth 1` (or `gh api repos/CLEAN-APPS-DEV/clean-green-marketing-brain/contents/<path>?ref=main -q .content | base64 -d` per file). A fresh clone = the live repo, not a cache.
- **The authoritative gate is the meta-compliance-agent scan** (a running fleet agent - loop it via the bus). It reads the live repo and signs every wave before any live write.
- The deterministic grep (Phase 2) is a FAST PRE-FILTER ONLY - build its term set FROM the freshly-pulled `rules.md` each run, not from a frozen list; it never overrides the live repo or the agent scan. This skill deliberately keeps NO banned-term list of its own (same principle as the brain `meta-ad-copy-agent` skill).
- **Tier-2 SEMANTIC codes are NOT grep-catchable - run the agent semantic pass on the AdDesc / link-description copy field too, not only headlines + bodies.** Some M-codes (e.g. M-20 potency/quality comparison: "better than the shop", "stronger than", "higher-quality than the local shop") are defined in `rules.md` as Tier-2 SEMANTIC flags, explicitly NOT hard greps (the comparison words false-positive on benign copy like "better sleep" / "stronger than ever"). A grep-only pass on a copy field therefore CANNOT catch them, and deterministic-clean is NOT compliant. The meta-compliance-agent semantic pass is MANDATORY on every AdDesc / link-description field, the same as on headlines and bodies. PROOF (523 drift, 2026-06-13): a sheet AdDesc "Better than shop quality" (a clear M-20) passed the grep gate and launched live, because the semantic layer was never applied to that field.
- If anything in this skill's prose names a specific banned phrase, treat it as an EXAMPLE/illustration only - the live `rules.md` is the source of truth and wins on any conflict.

---

## Constants
- **spreadsheet_id:** `1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME`
- **sheetIds:** IMAGES (Sleep Gummies) `491729225` · IMAGES (Flower) `1711671268` · VIDEOS (Sleep Gummies) `1313921284` · VIDEOS (Flower) `1214685724`
- **Compliance source = the LIVE brain repo (see the COMPLIANCE SOURCE RULE above). The references in THIS skill carry generation STRUCTURE and PROCESS only - never the authoritative ban list.**
- **References (read these):** `references/banned-grep.md` (the deterministic grep term set + text NORMALIZATION/de-obfuscation + hard-ban-vs-UNCLEAR split - the core of Phase 1 v2) · `scripts/extract_text.sh` (bundled tesseract OCR: full-res + 2x upscale + 4 quadrant tiles; the 3rd text source) · `references/colb-formatting.md` (the 3-outcome cell values + PASS/FAIL/UNCLEAR conditional formatting + the ADD recipe for the UNCLEAR light-blue rule) · `references/rubric.md` (legacy per-row image rubric - imagery cues still useful; its bans are ILLUSTRATIVE, live `rules.md` wins) · `references/copy-rewrite-gummies.md` + `references/copy-rewrite-flower.md` (Phase-2 per-product GENERATION structure + voice).
- **Canonical M-codes** live in brain `agents/meta-compliance-agent/references/rules.md` (M-1..M-25) - pull LIVE every run; re-pull on a meta-compliance merge ping.

---

# PHASE 1 - Image-compliance scan -> col B (v2 DETERMINISTIC pipeline)

Scan every creative on a tab INDEPENDENTLY (no dedup - variants differ) and write a verdict to col B. **Three outcomes: PASS (green) / FAIL (red) / UNCLEAR (light blue).**

**WHY v2 exists (read this):** a single "look at the image and judge" pass is unreliable in BOTH directions - it MISSES violations (false PASS, the account-risk direction) AND over-calls clean creatives (false FAIL, e.g. range-generalizing a row of pouches as "leaf"). The fix is to make the reliable parts DETERMINISTIC and route everything uncertain to UNCLEAR instead of guessing. Concretely:
- **TEXT** violations (most of them: FLOWER / 420 / 72hr / THC / NO MEDICAL CARD / DISCREET) are caught by EXTRACTING the on-image text from THREE independent sources, then running a deterministic banned-word GREP. A FAIL fires only on an actual banned string -> near-zero over-call; three reads -> near-zero miss.
- **IMAGERY** (cannabis bud / decorative leaf) is the only part that needs visual judgment: TWO independent vision passes; they must AGREE for a confident call, else UNCLEAR.
- **META'S OWN VERDICT** (the per-account combined LAUNCH cells, e.g. `E-0650 | Flower 2` cols: `Status - MM/DD/YYYY HH:MM AM/PM PT - adID`) is free ground truth - reconcile against it. (The old single `Meta Review Status` col E was DELETED 2026-06-11; the launch cells are the only Meta-status source now.)
- **UNCLEAR** absorbs every can't-call-with-100%-certainty case (imagery disagreement, ambiguous semantic claim, low-confidence read). Never guess.

**STANDING SCAN RULE - the Adam 100% standard (verbatim, 2026-06-10, supersedes any close-at-0-UNCLEAR flow):** *"It is better to leave the row as UNCLEAR (light blue color) than try and guess if its PASS/FAIL. Only mark rows as pass or fail if it is 100% certainty. If it is anything under 100% certainty, mark it as unclear."* This binds EVERY verdict writer, including adjudication: meta-compliance may flip an UNCLEAR to FAIL only on verbatim-confirmed banned text, or to PASS only at 100% certainty with a rule cite; anything under 100% STAYS UNCLEAR and gets a one-line human note in the cell (what to look at: the on-image area, the ambiguous phrase, the missing context). An honest UNCLEAR bucket beats a forced-clean one - report FAIL (rework queue) and UNCLEAR (human-review queue) as separate lines, never summed.

**DELIVERY-TIME GUARANTEE - HARD BAN (Adam directive 2026-06-10, REJECTION-PROVEN - final after reversing twice in one day):** ANY quantified delivery-time promise is a HARD FAIL - "delivered in 72 hours", "72-hour delivery", "at your door in 48 hours". Meta REJECTED flower rows 522-524 carrying delivery-time-guarantee / money-back-guarantee wording even though the old brain rules.md M-3 example offered "at your door in under 72 hours" as approved substitute text - REAL REJECTIONS BEAT RULEBOOK THEORY; the rules.md example is amended by brain PR. Compliant: "delivered fast", "fast shipping", "fast tracked to your door" (speed, no number). Quantified OUTCOME timing stays banned too (M-16: asleep in 10 minutes, 8 hours guaranteed, results in X days). Discretion words (discreet/plain box/plain billing) also fail on their own merits - cite both when both present. Full grep in `references/banned-grep.md`.

**M-24 SCOPE (mc ruling 2026-06-10):** M-24 bans the standalone brand-name phrase (`\bclean green\b`, word-boundary) as creative/copy text. Concatenated tokens are EXEMPT: social handles (@cleangreenstore) and brand-domain URLs (cleangreencare.com, hellocleangreen.com) do not trip M-24 - the rule targets the brand NAME as a promotional phrase, not every string containing the characters.

### Step 0 - Task + announce + pull LIVE rules
create-task; col B is the creative-verdict lane. **Pull the brain rules FRESH this run** (`cd /tmp && rm -rf brain && gh repo clone CLEAN-APPS-DEV/clean-green-marketing-brain brain -- --depth 1`) - the banned-term set is rebuilt from `agents/meta-compliance-agent/references/rules.md` every run (see `references/banned-grep.md`). Verify col-B conditional formatting is present incl. the UNCLEAR rule (`references/colb-formatting.md`).

### Step 1 - Resolve columns LIVE by header (HALT on missing)
Read row 1. Need: the `Meta Compliance Agent` verdict col (B), `1x1`, `9x16` (fallback), `Code`, `ClickUp Card ID`, AND every per-account LAUNCH col (headers like `E-0650 | Flower 2` - the combined `Status - timestamp - adID` cells, for the Step 6 cross-check; the old `Meta Review Status` col was deleted 2026-06-11). Letters DRIFT (the sheet gains columns) - never hardcode; if an expected header is missing/renamed, HALT that tab and report.

### Step 2 - Enumerate rows + creative fileids
BATCH_GET Code/CardID/1x1/9x16 + col B (clobber guard) + ALL per-account launch cols over the data range. Extract the Drive fileid from the 1x1/9x16 cell: regex `/file/d/([A-Za-z0-9_-]{20,})` OR `[?&]id=(...)` OR `/d/(...)`. 1x1 present -> scan 1x1; else 9x16 (tag `(9x16)`); neither -> `NO CREATIVE` verdict. Large reads save to `/mnt/files/mex/*.json` -> parse in `COMPOSIO_REMOTE_WORKBENCH` to emit a `row<TAB>asset<TAB>fileid` list (workbench = parse only, never judge). Stage that list on the HOST.

### Step 3 - TEXT extraction: THREE independent sources, unioned (per creative)
Run all three; UNION their text before grepping. They are COMPLEMENTARY (proven: tesseract nails small/clean print like badges + bottom bars but GARBLES large stylized headlines; native vision reads big stylized headlines but can skim fine print - you need both):
- **(a) Vision pass A** - a transcription-only subagent. Download full-res (`GOOGLEDRIVE_DOWNLOAD_FILE` -> `s3url` -> `curl`). The Read tool caps at 256KB, so DO NOT just downscale (that drops small print). Instead TILE: `ffmpeg -nostdin -loglevel error -i img -vf "crop=iw/2:ih/2:0:0" tl.png` (and `iw/2:0`, `0:ih/2`, `iw/2:ih/2` for the other quadrants) + read the whole image downscaled for layout. `Read` each tile (NATIVE VISION) and transcribe ALL visible text VERBATIM; union the tiles. Also emit imagery flags (below). NO verdict.
- **(b) Vision pass B** - a SECOND, independent transcription subagent (ideally a different model so errors do not correlate), same tiling, separately.
- **(c) OCR** - run the bundled `scripts/extract_text.sh <image_path>` (tesseract at full res + 2x upscale + 4 quadrant tiles; prints all recovered text). Deterministic, zero tokens.
**NORMALIZE the unioned text before grep - SPLIT BY PATTERN TYPE (v2.1, 2026-06-10):** lowercase always; collapse intra-word spacing/dots (`F L O W E R` / `f.l.o.w.e.r` -> `flower`). The leet-map `0->o 1->i 3->e 4->a 5->s` applies ONLY to ALPHA-word patterns - NEVER to digit-bearing patterns (it corrupts them: `420`->`a2o`, `60,000+ customers`->`6o,ooo+ customers` -> silent false-PASS, caught in prod 2026-06-10). Digit patterns (M-2 4/20, M-6 social-proof counts/ratings, M-16 outcome timing, M-13 `8 hours`) match on RAW lowered text. `scripts/grep_verdict.py` (v2.1) implements the split - use it, do not re-derive. THREE more v2.1 rules baked into it: (1) single-token product words (flower/bud/hemp/...) FAIL only when CORROBORATED by >=2 independent sources (vision A, vision B, OCR) - a single-source hit is UNCLEAR (`verify on image`), because extractors leak CATEGORY words from descriptions (rows 786-793 false-FAIL class); extraction prompts must demand VERBATIM on-image text only. (2) Plain delivery/shipping timeframes (24/48/72 hours) are NOT banned (brain rules.md M-3 approved text: "at your door in under 72 hours") - only the discretion stack (discreet/plain box/plain billing) and M-16 quantified OUTCOME timing fail. (3) Word-gap classes: `farm bill` (M-2 legality) and `no chemicals` (M-2) are HARD-FAIL; `lab-tested`/`third-party tested`/`COA` are DE-CODE -> on CREATIVE they route to UNCLEAR-for-Adam-review (#154 `surface_handling.creative`, NOT hard-FAIL; they stay HARD-REMOVE on COPY). (See `references/banned-grep.md`.)

### Step 4 - Imagery flags (the only vision JUDGMENT)
Passes A and B each return, per row: `bud_plant` (yes/no/maybe) = a real cannabis bud/nug/plant/fan-leaf depicted; `leaf_icon` (yes/no/maybe) = a STANDALONE decorative leaf/sprig graphic or leaf emoji placed inline with text. **EXEMPT (always "no"):** the Clean Green brand logo / "g" leaf mark / wordmark; pine trees / mountains / sun / generic nature SCENERY printed on the product pouch; the gummy product itself.

### Step 5 - Deterministic GREP -> preliminary verdict (per row, NO guessing)
Run the grep (terms rebuilt from the live `rules.md`, per `references/banned-grep.md`) on the normalized union text:
- ANY **hard-ban** hit (M-2 product/legality/delivery-time, M-19e leaf emoji in text, M-24 brand-name-as-text, M-25 scam/fake) -> **FAIL**, evidence = the matched terms.
- ELSE if **both** imagery passes say bud_plant=yes (or both leaf_icon=yes) -> **FAIL** (M-19d; BLURRED bud = FAIL, circumvention).
- ELSE if imagery passes DISAGREE, or either is "maybe", or an **ambiguous-semantic** trigger hits (M-4 health/"relief", M-6 social-proof NUMBERS, M-8 press "as seen on"/network names, M-20 comparison "better than"/"stronger than") -> **UNCLEAR**, evidence = the trigger.
- ELSE -> **PASS** (grep clean AND both passes agree no cannabis/leaf imagery).

### Step 6 - Cross-check against META'S OWN verdict (free ground truth)
Reconcile the preliminary verdict with the row's Meta status, derived from the per-account combined LAUNCH cells: parse each `E-xxxx` cell's leading status token (`Rejected` / `Pending` / `In Review` / `Active`). ANY account `Rejected` -> treat as DISAPPROVED for reconciliation; any `Active` (and no Rejected) -> ACTIVE; all blank -> unlaunched (no change). **The reconciliation is ASYMMETRIC** - Meta DISAPPROVED is hard proof of a violation, but Meta ACTIVE/APPROVED is NOT proof of compliance (Meta has not necessarily reviewed it yet, and approval is not permanent - Meta re-reviews and retro-disapproves running ads). So:
- our **PASS** + Meta = **DISAPPROVED** -> override to **FAIL** (Meta is authoritative on disapproval; note "Meta-disapproved - scan had missed it"; this is a learning signal - inspect what was missed and widen the grep/rubric).
- our **FAIL (deterministic grep hit)** + Meta = **ACTIVE / APPROVED** -> **KEEP FAIL.** A literal banned word on the creative is a real violation regardless of Meta's current status; do NOT soften it - those are exactly the ads at risk of retro-disapproval. (Optionally append a note "Meta currently ACTIVE but has banned on-image text - at retro-disapproval risk".)
- our **FAIL (JUDGMENT-only: imagery call or ambiguous-semantic, NOT a grep hit)** + Meta = **ACTIVE / APPROVED** -> downgrade to **UNCLEAR** (weak over-call signal worth a human eye; the deterministic layer did not fire, so the call rested on judgment Meta's running status mildly contradicts).
- otherwise keep the verdict. (Blank/PENDING_REVIEW Meta status -> no change.)

**READ META STATUS LIVE AT VERDICT TIME - never from a cached extraction record (gap caught 2026-06-10):** a re-scan that reuses stored extraction records MUST re-read the per-account launch cells fresh for the cross-check. The record's `meta` field is a snapshot from extraction day; Meta disapprovals land AFTER. Proven failure: flower row 522 sat scan-PASS while the live sheet said DISAPPROVED, because the re-verdict used the record's empty meta field - the asymmetric override never fired. Rule: extraction records carry text + imagery only; the Meta status input to reconciliation is ALWAYS a live read.

**IN-PLACE FILE REVISIONS INVALIDATE CACHED VERDICTS (silent-stale class, caught 2026-06-11):** designers revise a creative IN PLACE on Drive (upload a new version of the same file), so the FILE-ID never changes - intake dedup correctly says ALL_DUP, but every cached col-B verdict for those rows was judged against the OLD pixels and is silently stale, in BOTH directions (a fixed creative keeps its FAIL; a worsened one keeps its PASS). The tell is in the ClickUp card history: a compliance-fail comment followed by "fixed"/"updated the files" + the card cycling back to ready-to-post. RULE: on any ALL_DUP reconcile where the card history shows a revision round (or the card was re-readied after a fail), RE-DOWNLOAD the current file content and re-run the full Phase 1 extraction + grep on it before trusting or acting on the existing col-B verdict; write the new verdict with a `[re-scan <date>: creative revised in place...]` note so the flip history is auditable. Proven: IMG_512 rows 795/796 carried stale M-2 FAILs after the designer had genuinely removed the banned text (flipped to PASS on re-scan); a verdict cell is a claim about file CONTENT, and the file-id is not a content hash. Same-day second proof: IMG_499/500/504 re-scans flipped 6 verdicts on revisions made hours earlier.

**VARIANT WITHDRAWAL resolves a flag too (caught 2026-06-11):** a designer can resolve a flagged variant by DELETING its files from the Drive folder instead of re-editing. The tell: the card cycles back to ready-to-post and the intake dedup for that variant disappears (its file-ids are no longer in the folder, so the parse yields fewer variants than the sheet has rows). On reconcile, always compare FOLDER CONTENTS against the sheet's rows for that card - not just modifiedTime. Handling: append a `VARIANT WITHDRAWN: <ratio/version> files deleted from the Drive folder by designer <date>` note to the orphaned row's verdict cell (preserve the existing verdict word so launch-gating holds), exclude the row from the card's deliverable set, and complete the card on the remaining clean variants. (Proven: IMG_233 V3 - the M-13 flag was resolved by deletion; card completed on V1/V2.)

**COPY-COLUMN PASS DOES NOT CLEAR THE CREATIVE / VO SURFACE (verdict-scoping, caught 2026-06-23):** a col-B verdict is a claim about the COPY surface only (the sheet's headline/primary/description/VO-script text columns). The on-creative baked text and the spoken VO are SEPARATE surfaces with their own scan (asset-view / OCR / VO-transcript). A row can be copy-PASS while the spoken VO or the baked creative carries an M-2 the copy never contained. Proven: Brandon M. - copy columns scanned clean (col-B PASS) while the SPOKEN VO carried an M-2 the copy-only read could never see: the whisper transcript "Two-day delivery, plain box, click below" ("plain box" = M-2 discreet-delivery), surfaced only by transcribing the VO, never present in the copy columns. RULE: never let a copy-column PASS read as a launch-clear. Launch-gating requires a copy-surface verdict AND a creative/VO-surface verdict (baked on-image text AND the spoken VO are each their own surface); if the creative/VO surface was not independently scanned, the row is UNCLEAR for launch regardless of the copy verdict. (OCR boundary: tesseract is image-only - the spoken VO rests on the whisper TRANSCRIPT and video frames on meta-ads asset-viewing, not OCR; the Brandon-M catch came from the transcript surface precisely because OCR could never reach it.)

**A RE-RECORD / SUPERSEDE LABEL IS ITSELF A CLAIM - RE-VERIFY THE NEW VO, DON'T TRUST THE LABEL (caught 2026-06-23):** a "re-recorded" / "superseded" / "new VO" / "fixed the voiceover" label does NOT auto-clear the asset - the new recording can reproduce the SAME coded content the original was flagged for. Same family as the in-place-revision gotcha (:107): a version/label change is not a content hash, and a verdict is a claim about CONTENT. Proven: Christine - a re-record intended to supersede a coded VO reproduced the same coded narrative; the "re-record" label would have cleared it if trusted. RULE: a re-record is a NEW asset = a NEW scan surface. Re-run the full VO-transcript scan on the new recording before clearing; write the verdict against the new VO's actual content with a `[re-scan <date>: VO re-recorded - verified new content]` note. The label gates re-verification; it never substitutes for it.

**DIRECT-LAUNCH BYPASSES THE CREATIVE / VO GATE (gate-bypass, caught 2026-06-23):** a row can go live via direct-launch without the creative/VO surface ever passing the compliance gate - the copy may have cleared (or the row launched straight off the sheet) while the baked creative + spoken VO were never independently scanned. RULE: launch-gating must confirm the CREATIVE/VO surface was scanned, not just the copy. On any launched-row reconcile, check that each launched row carries a creative/VO-surface verdict (not only a copy verdict); a launched row with no creative/VO scan on record is a gate-bypass tell - flag it UNCLEAR-for-creative-review and surface to the launcher (mmb / meta-ads). Reconcile launched-state against creative/VO-scan completion, the same way Step 6 reconciles against Meta's own status.
### Step 7 - Write col B (clobber-guard + DESCRIPTIVE evidence)
Build the write-plan: each cell starts with `PASS` / `FAIL` / `UNCLEAR` then a **human-readable reason** so Adam knows exactly WHAT is failing, not just an M-code. **HARD RULE (Adam 2026-07-07): translate every hit into plain English via `scripts/describe_verdicts.py`** - run `python3 scripts/describe_verdicts.py <the grep_verdict *_verdicts.json> <PT date>` to turn terse labels (`M-2 brain-hard:'72 hours'`) into readable cells (`FAIL - M-2: banned specific delivery-time claim ("72 hours") - use "delivered fast", no number · scanned <date> (VO audio+frames)`). It names the M-code, the plain reason, AND the exact matched phrase for each hit. **NEVER stamp the raw terse label; always pipe through describe_verdicts.py.** It is an additive DISPLAY layer only - it never changes detection or the verdict (grep_verdict.py stays the authority). **NO EM DASHES** in the cell (fleet hard rule - the helper strips them; verify none on read-back). Writer subagent: `GOOGLESHEETS_BATCH_UPDATE` (USER_ENTERED) in chunks of ~34 per `COMPOSIO_MULTI_EXECUTE_TOOL`; READ BACK the range and assert every target row starts with its expected verdict word, contains the current marker, and has zero `—`.

### Step 8 - Report
PASS/FAIL/UNCLEAR counts + FAIL-driver breakdown + **the UNCLEAR list explicitly (these need a human eye)** + any Meta-disagreements found. Complete task; log event.

### Direct-launch scan requests
When `meta-media-buyer-agent` or the launch tracker sends `DIRECT-LAUNCH CREATIVE/VO SCAN REQUIRED`, treat it as a mandatory narrow Phase 1 / Phase 1-V run:
- Scan ONLY the requested tab rows. Do not expand to the whole tab unless explicitly asked.
- Use Phase 1 for `IMAGES` tabs and Phase 1-V for `VIDEOS` tabs.
- Write the normal PASS / FAIL / UNCLEAR / SCAN ERROR verdict into `Meta Compliance Agent`.
- Include a recognizable marker in the cell, e.g. `[direct-launch scan: creative/VO <YYYY-MM-DD>]`, so the launch tracker can distinguish a creative/VO verdict from a copy-only PASS.
- Report the result back to `meta-media-buyer-agent` and the requesting thread. FAIL / UNCLEAR / SCAN ERROR means `DO-NOT-UNPAUSE`; PASS means scan-clear from the creative/VO gate, while Adam still owns the manual unpause.

### SUBAGENT DISCIPLINE (mandatory - these are the two bugs that bit this pipeline)
- **REAL ROW IDS:** subagents tend to write LOCAL 1..N indices instead of the sheet row. Require each to echo the row from column 1 of its input file AND, before ANY write, VALIDATE that the jsonl row-set == the input row-set; if mismatched, remap positionally (input-file line order) and re-validate. Never write verdicts whose rows you have not reconciled.
- **NO RANGE-GENERALIZATION:** every verdict must carry per-row EVIDENCE (the exact text quoted / the specific imagery seen on THAT image). A reason copy-pasted across a consecutive range is invalid - it is how clean rows get false-FAILed. One creative = one independent look.

**M-19d** = cannabis bud/leaf/plant imagery in a creative; BLURRED bud = FAIL (circumvention). Do NOT flag the Clean Green brand logo/wordmark leaf. **M-24 logo question:** the brand WORDMARK/logo lockup on a creative is EXEMPT; a "Clean Green"/"cleangreen" appearing as a HEADLINE / overlay / testimonial-quote / ingredient-copy line is the M-24 FAIL case. The split is visually unambiguous but NOT deterministically greppable from OCR (extractors transcribe the logo wordmark too) - so M-24 is a vision/adjudication flag, not a blind grep (see `references/banned-grep.md`).

---

## AT-SCALE EXECUTION + the two refinements that make a full-library run correct (v2.1, proven 2026-06-10 on ~1070 creatives both image tabs)

Running the whole library (not a 100-row slice) surfaced failure modes the small-batch path hides. Bake these in:

### A. IMAGERY is a SEPARATE 2nd-pass adjudication - DECOUPLE it from the text verdict
A single extractor's imagery flag OVER-CALLS: it flags the EXEMPT brand-logo leaf sprig (the "Get Real" billboard run, rows 656-675) and ingredient/botanical sprites (gummy "leaf" next to Magnesium/Ashwagandha) as cannabis. Trusting single-pass imagery would have FALSE-FAILed ~31 clean rows.
- The deterministic TEXT grep is authoritative and runs first. Imagery flags do NOT contribute to the base verdict.
- Only imagery-flagged rows whose TEXT verdict is PASS/UNCLEAR need adjudication (a text-FAIL row is FAIL regardless of imagery). On the flower run that was ~32 of 97 imagery-flagged rows.
- Run ONE adjudicator subagent (use a strong model) over just those rows: re-tile + re-view each, decide `cannabis` (real bud/nug/plant OR a serrated multi-point cannabis FAN-leaf -> FAIL M-19d) vs `exempt` (brand logo, rounded ingredient/herb sprig, nature scenery, the product/gummies) vs `unclear`. Merge: cannabis -> FAIL; exempt -> keep text verdict; unclear -> UNCLEAR. (Result on the run: 1 real cannabis out of 32, the other 31 exempt.)

### B. EXTRACTOR / CENTRAL-GREP / WRITER split (kills the subagent row-index + range-generalize bugs)
- EXTRACTOR subagents are PURE extractors: download (Composio Drive -> presigned url -> curl) -> ffmpeg tile -> native-vision transcribe + tesseract OCR + imagery yes/no/maybe -> emit jsonl with the REAL sheet row. No verdicts.
- I (main loop) run the deterministic grep+verdict CENTRALLY on host (one script) so verdicts are consistent and no subagent can mis-number rows or copy a reason across a range.
- WRITER subagents write col B from a `{row,verdict,cell}` json.
- Batch ~35 rows/extractor, ~6-8 parallel background. **Use HOST batch files, NOT the Composio sandbox /mnt** - the /mnt FUSE mount DROPS and the sandbox ROTATES mid-run (killing /mnt-staged batch files); host files (`/tmp/.../batches/`) are robust. Pull fileids to host once (workbench kernel print -> Write), split with `split`.

### C. VERIFY by re-reading the live sheet for a per-row MARKER, then BACKFILL
Writers report per-write success but individual writes DROP under Composio rate-limiting (had 14 non-landed cells across 5 parallel writers), and stale/external content can sit in a cell. The first-WORD check is not enough (a stale "FAIL (image)" passes it).
- Stamp every cell with a marker: the v2 write uses `(creative v2 <ts>)`; an adjudication re-write adds `[mc-adjudicated]`.
- After writing, re-read col B and assert the marker substring is present on EVERY target row; the rows missing it are the dropped/stale writes -> backfill them directly.
- **Read the column via the WORKBENCH KERNEL** (`run_composio_tool` GOOGLESHEETS_BATCH_GET inside COMPOSIO_REMOTE_WORKBENCH), NOT the MCP MULTI_EXECUTE wrapper - the wrapper inflates even a single-cell column read past its inline limit ("payload too large"). The kernel handles large responses and can do the marker check in-sandbox.

### D. DOWNLOAD_FAIL -> SCAN ERROR -> recovery retry
A failed download is NOT a PASS. Mark the row `SCAN ERROR` (still carries the v2 marker). Presigned Drive urls expire ~1hr; a genuine 404 on retry = the file is unshared/broken. Run ONE recovery pass that re-attempts the SCAN ERROR fileids: recovered -> scan+verdict normally; still-404 -> keep SCAN ERROR and file ONE `[HUMAN]` task listing the rows to re-share. (Run 2026-06-10: 12 broken, 1 recovered = real cannabis, 11 needed re-share.)

### E. UNCLEAR -> route to meta-compliance-agent for a definitive call (no human pile)
Most UNCLEAR rows are genuinely semantic (health/relief M-4, melatonin-comparison, press M-8, social-proof# M-6, comparison M-20) - cheap self-adjudication barely shrinks them. Instead batch ALL UNCLEAR rows to the **meta-compliance-agent** (running fleet agent, reads live brain rules): hand it a `/tmp` json of `{tab,row,fileid,current_evidence,extracted_text}`, ask for a definitive PASS/FAIL + M-code + one-line reason per row (RESIDUAL only if truly uncallable), it writes a verdict file, I write col B (my single-writer lane) tagged `[mc-adjudicated]` + marker-verify. Adjudication-only; Phase 2 stays Adam-gated. (Run 2026-06-10: 99 UNCLEAR -> 6 PASS / 93 FAIL / 0 RESIDUAL -> no human batch.)

---

# PHASE 1-V - Video-compliance scan -> col B (script + visuals)

For VIDEO tabs (VIDEOS (Sleep Gummies), VIDEOS (Flower)) the creative is the video, not a still. Scan BOTH the spoken script and the visuals; the HOOK (open) and CTA (end) are the highest-risk frames. The edited video can DIVERGE from the ClickUp brief, so TRANSCRIBE THE AUDIO - do not trust the brief script alone (verified 2026-06-09 on UGC #168: the real VO opened with split-screen lines the brief body omitted, adding two M-2 fails the brief would not have shown). Same col-B verdict lane, same conditional formatting, same header-resolution + live-brain-rules rules as Phase 1.

1. **Task + announce + resolve columns LIVE** by header. Video tabs need: `Meta Compliance Agent` (=B, write), `ClickUp Card ID`, `Video Script`, `9x16` (primary asset), `4x5`/`1x1` (fallback), `Actor`, `Hook #`, `Variant #`. As of 2026-06-09 VIDEOS (Flower): B / R=CardID / M=Video Script / AD=9x16 / AC=4x5 / N=Actor / O=Hook# / L=Variant. Re-audit every run (letters drift).
2. **Read rows (FORMATTED).** Per row pull the ClickUp Card ID (a `/t/<id>` URL) + the 9x16 Drive fileid (regex `/file/d/([A-Za-z0-9_-]{20,})`). Multiple rows usually share ONE card (per actor/hook/variant) -> the SCRIPT is per-card; the VIDEO file is per-row. The `Video Script` column itself only holds the card NAME, not the script - the script lives on the ClickUp card.
3. **Pull the brief script from the ClickUp card (cross-check only).** GET `/task/<id>` REST (token: `grep '^CLICKUP_API_TOKEN=' orgs/clean-green-marketing/secrets.env`, never echo). `text_content` holds the Script Hook/Body/CTA + on-screen text-hook instructions. Use it to confirm exact wording where the transcript garbles a word - but the AUDIO is the source of truth.
4. **Transcribe the audio LOCALLY (zero LLM tokens, zero API cost).** Download the 9x16 via authed Composio `GOOGLEDRIVE_DOWNLOAD_FILE` -> presigned `s3url` -> `curl` to `/tmp/video_scan/<row>.mp4`. Then `ffmpeg -nostdin -i <row>.mp4 -ar 16000 -ac 1 <row>.wav` and `whisper <row>.wav --model base --language en --output_format txt --output_dir . --fp16 False` (openai-whisper at `~/Library/Python/3.9/bin`; or whisper.cpp `whisper-cli -m ~/.cortextos/models/ggml-tiny.en.bin`). base model is good enough to catch banned tokens; bump to `medium` (`~/.cache/whisper/medium.pt`) only if a verdict hinges on an unclear word. Codex / any LLM is NOT a transcriber - keep ASR local; that is the token-saver.
5. **Sample the visuals.** `ffmpeg -nostdin -ss <t> -i <row>.mp4 -frames:v 1 <row>_<tag>.png` at HOOK (~2s: text-hook overlay + opening frame), BODY (~mid), CTA (~last 6s), END (~last 1s). For each frame, extract on-screen TEXT the SAME 3-source way as Phase 1 Step 3: tiled NATIVE VISION read + `scripts/extract_text.sh <frame>` (tesseract). Also note iconography: authority-figure framing, diploma/credential props, cannabis imagery, the CTA end-card.
6. **Build the text corpus + grep (same deterministic core as Phase 1).** Union: whisper transcript (audio) + the brief Script Hook/Body/CTA (cross-check) + all frame on-screen text (vision + OCR). Normalize (collapse spacing, leet-map) and run the deterministic grep (terms from the live `rules.md`; M-2 scope EXPLICITLY includes "SCRIPTS (VO + on-screen text)"). Hard-ban hit -> FAIL with evidence. Video high-risk surfaces: M-2 spoken/on-screen (bud/flower/legal/"federally compliant"/"off-limits"); M-20 potency/comparison in VO ("genuinely strong", "better than the local shop"); M-24 brand name spoken or on-screen; M-6/M-6a skeptic-arc ("I thought it was fake") + invented review counts ("hundreds of reviews"); authority-endorsement + legality framing (attorney/federal-agent + credential props = Tier-3 frame mismatch) -> if not a clean grep hit, **UNCLEAR** for the semantic ones. Cannabis imagery in a frame = FAIL only if a clean visual call, else UNCLEAR.
7. **Cross-check META status + write col B** (3 outcomes: PASS green / FAIL red / UNCLEAR light blue). Apply the Step 6 Meta-reconcile from Phase 1 (our PASS + Meta DISAPPROVED -> FAIL; our FAIL + Meta APPROVED/ACTIVE -> UNCLEAR). Clobber-guard; evidence = exact spoken/on-screen phrase + per-row hook label. Rows sharing a script get the same core verdict; vary only the hook line.
8. **Report** per-row to Adam (PASS/FAIL/UNCLEAR + the UNCLEAR list); complete task; log event. A FAIL baked into the VO + visuals = a re-edit, not a copy tweak.

**Whisper note:** base-model transcripts carry minor errors (e.g. "blower"/"flower", "Code Try 20"/"TRY20") - the substance is reliable for compliance; quote the ClickUp brief for exact wording where a word garbles.

---

# PHASE 2 - Stage-2 copy rewrite on image-PASS rows (Adam-triggered)

When Adam asks to make the COPY compliant on the PASS rows. SCOPE = every col-B image-PASS row on the named image tab(s). The existing copy is usually heavily non-compliant (medical card / federally compliant / lab-tested / M-13 sleep claims). FAIL-image rows are NOT rewritten (their creative must be fixed first - that's a separate, orchestrator-sequenced cleanup).

### Hard guardrails (orchestrator, non-negotiable - bake into EVERY subagent prompt)
1. **NO new or altered social-proof NUMBERS** - drop customer-count/star/review counts; keep only on-asset star glyph + product specs.
2. **meta-compliance-agent sign-off is a HARD pre-write gate** - nothing goes live until it signs.
3. **No em dashes + Opus(me)-review + the deterministic grep on EVERY row before any live write** - never self-reported clean.

### Steps
1. **Identify PASS rows** from col B; group nothing - rewrite per row, asset-aligned. Read existing avatar/funnel per row (keep them; do NOT overwrite - many flower avatars are stale legacy values, that's fine).
2. **TAB-MISMATCH check + skip+flag.** Some PASS rows are the wrong product for the tab (e.g. gummies/bundle creatives misfiled on the Flower tab - the flower FCA= avatars don't fit a gummies ad). Do NOT write wrong-product copy. SKIP them and FLAG in col B: append `\nMISMATCH: <actual product> creative on <tab> tab - copy rewrite skipped, <action>` to the existing PASS verdict (preserves green). Give the orchestrator the COUNT + per-row product. (2026-06-09: 18 such rows on the Flower tab.)
3. **Cache the creatives.** Reuse the Phase-1 image cache (`/tmp/<scan>/imgs/<row>.jpg`). For PASS rows with no cached 1x1 (9x16-only rows): read the 1x1/9x16 column LIVE (FORMULA) -> fileid -> a recovery subagent downloads via Composio + generates. None of these are "truly missing" if a 9x16 exists; only flag to the orchestrator a row with NO creative at all.
4. **Fan out copywriter subagents** (~21 rows each, background). Each prompt = the per-product GENERATION file (`references/copy-rewrite-gummies.md` or `copy-rewrite-flower.md`) PLUS a directive to read the freshly-pulled brain `rules.md` (M-1..M-25) for the authoritative bans (do NOT rely on any baked-in list). Each: read the cached creative, generate 5 DISTINCT headlines [Balanced, Curiosity, Proof, Pain, Transformation] + 5 bodies [Primary, Var1, Var2, Var3, Var4] aligned to the asset, self-grep against the live rules, write `/tmp/<product>_copy/out/row_<row>.json` = `{row, headlines[5], bodies[5], review_or_health, notes}`. Headlines: at most ONE pure-offer line (see headline-diversity below).
5. **MY consolidated deterministic grep = a FAST PRE-FILTER** over EVERY row's headlines+bodies (NOT the notes field). Build the term set FROM the freshly-pulled brain `rules.md` each run (the M-2/M-19/etc. greps are defined there) - do NOT freeze a list in this skill. Cover the deterministic bans: banned terms (incl pre-rolled, hand-roll, medical, 420), 🌿/🍃, em-dash, the M-13/M-4/M-5 phrase bans, M-12 Q-headlines, M-20 (incl comparison), M-18 ("money-back promise"->"guarantee"), "Clean Green" (M-24), "Sleep Gummies" in headlines, and fabricated social-proof numbers. This grep is subordinate to the live `rules.md` + the meta-compliance-agent gate. LESSON: a grep written before the verdicts is usually incomplete - the catch-all grep catches what the subagents and the semantic pass miss; rebuild it comprehensively from the live rules. Fix or bounce every hit. Fix schema (each row exactly 5 headlines + 5 bodies).
6. **meta-compliance semantic gate (batched).** Send the agent ONE message per wave: point it at the `/tmp/.../out/` files on host + the list of REVIEW (quoted-review/⭐) rows and HEALTH/ingredient-adjacent rows (the risk surface; the deterministic grep covers the rest). It returns FAIL rows + offending cell + fix. Apply, re-grep, send the fixed rows for a spot-confirm, repeat until it signs the wave. (It is fast; M-18/M-24/M-4/M-13 are the usual surfaces.)
7. **Write live** via a writer subagent - ONE contiguous 1x10 range per row, headlines+bodies, into the per-tab copy block; OVERWRITE copy only; do NOT touch avatar/funnel/col B. `GOOGLESHEETS_BATCH_UPDATE {sheet_name, first_cell_location:"<startcol><row>", values:[[10]], value_input_option:"USER_ENTERED"}`, ~40 single-row calls per COMPOSIO_MULTI_EXECUTE_TOOL. Verify read-back of a sample (10 non-empty cells/row, text matches).
8. **Report the milestone to the orchestrator** (it owns the single-voice Adam close-out): rows written + verified, tab-mismatch count, any pending.

### Per-tab copy-block column maps (header-resolve LIVE every run; these are 2026-06-09)
| Tab | Avatar | Funnel | Copy block (Headline, HVar1-4, Primary, PVar1-4) | Code / CardID / 1x1 / 9x16 |
|---|---|---|---|---|
| IMAGES (Sleep Gummies) | N | O | **X:AG** (X / Y,Z,AA,AB / AC / AD,AE,AF,AG) | I / M / U / W |
| IMAGES (Flower) | Q | R | **AA:AJ** (AA / AB,AC,AD,AE / AF / AG,AH,AI,AJ) | L / P / X / Z |

(Video tabs differ + read the ClickUp brief instead of the image - see the brain `meta-ad-copy-agent/SKILL.md` if ever extending Phase 2 to video.)

### Write-tool schema gotcha
`GOOGLESHEETS_BATCH_UPDATE` here wants `{spreadsheet_id, sheet_name, first_cell_location, values:[[...]], value_input_option}` - ONE contiguous range per call. The native `{data:[{range,values}]}` multi-range format ERRORS. Batch many single-range calls inside one `COMPOSIO_MULTI_EXECUTE_TOOL`.

### Headline diversity (Adam, row 522)
5 DISTINCT hook angles; **at most ONE pure-offer/discount headline per row**. Offer-heavy assets tempt 3+ near-duplicate "20% off / TRY20" headlines (ad fatigue + Meta duplicate-creative risk). The other 4 = a real Proof signal, a Pain STATEMENT, a Curiosity loop, a single-state Transformation; no two share the same first 3 words. Detect clustering with a grep (>=3 headlines matching offer tokens, or >=2 duplicate first-3-words) and regenerate just the headlines (write AA:AE / X:AB only) - bodies stay if already signed.

---

## PHASE 2 AT-SCALE pipeline (v2, proven 2026-06-10 on 401 image-PASS rows: 183 flower + 218 gummies)

The 8-step Phase 2 above is the per-row contract; this is how to run it across the WHOLE PASS set reliably. The shape is the same gate-layered design as Phase 1 v2: subagents do the bulk, a CENTRAL deterministic gate decides, an authority (meta-compliance) resolves semantics, and you VERIFY by read-back. Never trust copywriter self-grep alone.

**STATED CONVENTION - KEY EVERY CROSS-TAB ARTIFACT BY (tab, row), NEVER BARE ROW NUMBER.** The gummies and flower tabs share row numbers (30 collisions in the 2026-06-10 401-row run). A flat `{row: ...}` dict keyed by bare row number silently OVERWRITES one tab's entry with the other's - 30 gummies rows lost their generated copy this way and the loss was invisible until a scope-vs-generated diff. Every accumulator, write plan, verdict map, hash map, and worklist that can ever hold rows from both tabs uses a composite key (`"GUM:84"` / `("IMAGES (Flower)", 84)` / per-tab namespaces). Reconcile scope-list vs generated-set COUNTS per tab before writing - the diff is one line and catches the whole class.

### Step A - Enumerate PASS rows + fileids (host-staged)
Header-resolve live, then BATCH_GET col B + 1x1 (FORMULA) + Code + Customer Avatar + FUNNEL STAGE over the data range; PASS rows = col B starts with `PASS`. Stage `row<TAB>product<TAB>fileid` to HOST tsv (NOT the Composio sandbox - it rotates + /mnt drops mid-run), split into ~22-row copywriter batches. (2026-06-10: 401 PASS = 183 flower + 218 gummies.)

### Step B - Copywriter subagents (generate only, ~22 rows each, parallel/background)
Each: read its host batch + a shared `RULES.md` (per-product generation + the full ban-set, rebuilt from live brain rules), FETCH each creative BY FILEID (Composio Drive -> presigned -> curl -> Read; do NOT reuse `/tmp/scan/imgs/<row>.img` - flower & gummies tabs COLLIDE on row number), generate 5 distinct headlines + 5 bodies asset-aligned, self-grep, emit `{row,product,headlines[5],bodies[5],mismatch,asset_text,notes}` to host jsonl. Copywriters are good but MISS things (invented social-proof numbers, URL/@handle in CTAs) - that's what the central gate is for.

### Step C - CENTRAL deterministic grep-gate (the real gate - you run it, not the subagents)
Aggregate all copy jsonl; grep each row's headlines+bodies (NOT notes/asset_text) into THREE buckets:
- **CLEAN** -> write as-is.
- **HARD** (deterministic violation): banned product/legality/stealth (bud/flower/legal/medical/discreet/72-hour), M-25 scam/fake, M-13 sleep-onset (gummies), M-5 grogginess, em-dash, real brand-claim. -> fix.
- **REVIEW** (semantic, can't call deterministically): M-4 health-state (relief/feel-the-difference/feel-present/changed-my-evening), M-5 fog/grog (clear morning/foggy), M-8 press (CBS/FOX/MSNBC/as-seen-on), M-20 comparison (better than), social-proof COUNTS, quoted-review stars, attributed numbers. -> meta-compliance.

### Step D - MECHANICAL auto-fix (clears the biggest false-FAIL class)
Most "M-24 cleangreen" hits are NOT brand-claims - they are `@cleangreenstore` handles or `hellocleangreen.com`/`cleangreencare.com` URLs the copywriter put in a CTA line (which should not be in body copy at all). Deterministically strip them -> "Shop now"; drop a brand-product prefix ("Clean Green DeepSleep" -> "DeepSleep"); residual standalone "Clean Green" -> "this". Re-gate. (2026-06-10: this auto-resolved 33 of ~40 M-24 FAILs.)

### Step E - meta-compliance semantic fix (the authority)
Batch the remaining HARD + all REVIEW rows to the meta-compliance-agent (running fleet agent) as a `/tmp` json of `{row,product,issues,headlines,bodies,asset_text}`. Ask for a definitive per-row FIXED (corrected headlines[5]+bodies[5]) or PASS. KEY RULINGS it applies: social-proof COUNTS (customers/reviews/orders) are DROPPED even if on-asset (the substantiation risk); on-asset STAR ratings are OK; "fixed/changed/transformed my evenings" = M-4/M-13 treatment-claim (paraphrase); press is OK only for the verified set (CBS/FOX News/MSNBC/USA Today), NBC/others = M-8 fail. Apply its fixes, re-gate to confirm.

### Step F - Write (copy block ONLY) + read-back
Writer subagents write the contiguous copy block per tab, header-resolved: IMAGES (Sleep Gummies) `X:AG` (Headline..Primary Var.4), IMAGES (Flower) `AA:AJ` (post-Schema-A, unshifted). Write ONLY the 10 copy cells - NEVER touch avatar/funnel/col-B/assets/Ad Name. Read-back verify 10 non-empty cells/row.

### Step G - TAB-MISMATCH rows + comprehensive absence-scan
- MISMATCH rows (copywriter flagged a wrong-product creative, e.g. gummies/bundle on the flower tab): do NOT write copy; append `\nMISMATCH: <product> creative on <tab> - copy skipped` to col B (preserve the PASS prefix). Report the count BY TAB to the orchestrator (it's a data-quality/refile finding). (2026-06-10: 21 such rows, all on the flower tab, mostly rows 59-92.)
- COMPREHENSIVE ABSENCE-SCAN: after all writes, re-read the written copy block and assert the full ban-set returns ZERO across every row (not a spot check). Report counts written + the absence-scan result.
- Broken creative links (404 on fetch): can't generate copy -> leave existing copy, fold the row into the dead-links [HUMAN] re-share task.

### Launch-cell schema note (REVERSED Schema A, current as of 2026-06-11)
Per-account launch state lives in ONE combined cell per account col (`E-xxxx | <product>` headers, directly after `ADMANAGE`): `Status - MM/DD/YYYY HH:MM AM/PM PT - adID`, written/refreshed by the media-buyer. The 2026-06-10 per-account `- Review Status`/`- Ad ID` paired columns were DELETED same day (Adam reversal), and the single `Meta Review Status` col E was DELETED 2026-06-11. Conditional formatting on the launch cols: contains Rejected->red, Pending/In Review->yellow, Active->green. These cells are the media-buyer's lane - READ them for the Step 6 cross-check, never write them.

### Sequencing rule - copy waves vs media-buyer builds (fleet rule, 2026-06-10)
A copy-rewrite wave on a tab = a media-buyer BUILD FREEZE on that tab, and vice versa for structural changes. Announce symmetrically over the bus: wave-START before the first write -> (for structural changes, WAIT for the counterpart's WRITER-QUIET CONFIRMED) -> do the work -> wave-END when written+verified. Column-disjoint concurrent writes (their launch cols vs our copy/col-B lanes) are allowed; what the freeze prevents is the media-buyer DRAFTING from rows mid-rewrite (version skew, the row-87 incident class).

---

## Cross-cutting hard rules / gotchas
- **Native vision only judges/writes.** Workbench `invoke_llm` fabricates - use the workbench ONLY to parse sheet data / emit fileid lists.
- **Re-resolve columns every run** by header name - the sheet gains inserted columns over time; doc letters go stale.
- **meta-compliance-agent** is a running fleet agent - loop it via `cortextos bus send-message meta-compliance-agent`; batch the risk rows into ONE message; point it at `/tmp` files on host. It signs before any live write.
- **Single-voice to Adam via the orchestrator** for decisions/narrative; answer Adam's direct factual pings briefly + loop the orchestrator.
- **col-B formatting:** FAIL->red / PASS->green / else->yellow; the NOT_BLANK-yellow rule must be the LOWEST priority (see `references/colb-formatting.md` - fixing this was a real Adam ask).
- **No 🌿** in copy (M-19e) - the brain copy-framework §5.5 was stale on this (fixed PR #108); rules.md wins.
- **Durability note:** this skill lives in `orgs/` (gitignored runtime). The durable home is `community/skills/creative-compliance-scan/` (org-private, opt-in - NOT `templates/agent/`, it is Clean-Green-specific and must not auto-load on new agents). Re-acquire via `cortextos bus install-community-item creative-compliance-scan`; dev re-snapshots the community copy when the runtime version stabilizes.

---

## Host prerequisites (verify BEFORE a scan run)

The deterministic pipeline shells out to local binaries. A fresh host (or re-created agent on a new machine) must have:

| Tool | Used by | Install / location |
|---|---|---|
| `tesseract` | Phase 1 + 1-V OCR text source (`scripts/extract_text.sh`) | `brew install tesseract` |
| `ffmpeg` | Image quadrant tiling (Phase 1 Step 3), video frame sampling + audio extraction (Phase 1-V) | `brew install ffmpeg` |
| `whisper` | Phase 1-V local audio transcription (zero LLM tokens) | openai-whisper at `~/Library/Python/3.9/bin` (`pip3 install openai-whisper`), or whisper.cpp `whisper-cli -m ~/.cortextos/models/ggml-tiny.en.bin` |
| `python3` | Deterministic gate scripts (`scripts/grep_verdict.py`, `scripts/copy_gate.py`) | system python3 |
| `gh` | Live brain-repo rules pull (COMPLIANCE SOURCE RULE) | authed with read on `CLEAN-APPS-DEV/clean-green-marketing-brain` |

Quick check: `command -v tesseract ffmpeg gh python3 && (command -v whisper || ls ~/Library/Python/3.9/bin/whisper)` - resolve any miss before starting a run (video scans hard-require all of tesseract/ffmpeg/whisper).

---

## Durability / re-acquire (read if this skill is missing after a re-create)

This skill is ORG-PRIVATE to clean-green-marketing and meta-ads-agent-specific. The runtime copy lives in `orgs/.../meta-ads-agent/.claude/skills/creative-compliance-scan/` (gitignored), so the DURABLE, version-controlled copy is here in `community/skills/creative-compliance-scan/`.

- **Do NOT** put it in `templates/agent/` - that base template is copied into EVERY new agent and would force this brand-specific skill onto unrelated agents.
- **Re-acquire after a re-create** (the base `add-agent` only lays down template skills, so meta-ads boots WITHOUT this skill until you install it):
  ```bash
  cortextos bus install-community-item creative-compliance-scan
  ```
  This step is also recorded centrally in the `agent-management` skill (section 1, post-create) because a freshly re-created agent cannot read this file before the skill exists.
- **When the skill evolves** (meta-ads iterates the runtime copy), re-commit the updated version into `community/skills/creative-compliance-scan/` so the durable snapshot stays current (a dev deploy step). Keep the compliance rules LIVE-pulled from the brain (see the COMPLIANCE SOURCE RULE) - never bake them in here.
