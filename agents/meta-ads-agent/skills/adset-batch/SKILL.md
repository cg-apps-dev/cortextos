---
type: skill
agent: meta-media-buyer-agent
skill: adset-batch
status: active
date: 2026-06-04
tags: [meta-ads, admanage, adset, batch, draft, playbook, human-gated, pipeline-stage-3]
---

> **Owner: meta-media-buyer-agent** (the-orchestrator ruling, 2026-06-04 role split - confirmed 2026-07-24). This file sits under `agents/meta-ads-agent/skills/` for historical/pipeline-location reasons; the frontmatter previously read `agent: meta-ads-agent`, which was stale. mmb is the actual owner AND executor (its live-read Stage-3B batching skill) - meta-ads-agent defers.

# Stage 3B - Ad-Set Batch PLAYBOOK (group ~10 ads → one ad set → AdManage draft · DRAFT ONLY · human-gated)

**This is the end-to-end playbook** for grouping finished ads into **one Meta ad set** and staging them as a single **AdManage draft** the operator publishes.

**THE FLOW (start → finish):**
1. **Pull a group of ads** from the META Ad Upload Sheet - rows are fed in by the [`clickup-intake`](../clickup-intake/SKILL.md) skill (Stage 1) + copy by the [copywriter module](../../meta-ad-copy-agent/).
2. **Eligibility + status filter** (STEP 1 / 1.5 / 1.6) - active ClickUp card, not-yet-in-target-account, copy-complete, **not Rejected in the target account** (per-account rejection guard: sheet per-account status cells PRIMARY + AdManage live backstop).
3. **Compliance gate per ad** (STEP 3, #72) - headline + body; fail → exclude.
4. **Ad set** (STEP 0) - operator names an existing ad set, OR you duplicate the newest one as a PAUSED structure-only holder (guardrails below).
5. **ONE `create_draft`** (STEP 4) - all the ads into that one ad set, multi-placement creatives.
6. **Hand off + STOP** (STEP 5) - operator reviews + **publishes**; Stage 4 stamps the launch back.

You never publish and never invent targeting - the operator owns audience/budget. This organizes creatives into clean, optimization-friendly ad sets at scale.

> ## THE GATE - read this first
> - **Creatives: `create_draft` only.** Never `launch_draft` / `launch_ads` / `launch_google_ads` - the only creative output is a draft the operator publishes.
> - **Never invent targeting. Never `create_adset`** - a fresh `create_adset` defaults audience to US-broad = inventing targeting. The ad set's audience/budget/objective must always trace to the **operator's** choice.
> - **The ONE permitted live structure write is `duplicate_adset`** of an **existing operator ad set** - and ONLY as a **PAUSED, structure-only** holder (`deepCopy=false`, `initialStatus=PAUSED`). This copies the operator's existing targeting (their choice, not invented) and carries ZERO ads/spend. Governed by the STEP 0 spend guardrails. Any other live Meta write stays excluded.
> - Real ad spend is on the other side of the operator's publish click. Treat every draft as something a human will scrutinize: complete, correctly grouped, compliant.

## STRATEGY BASIS (why ~10 ads, one avatar, broad)
From Clean Green's Meta account-structure reference:
- **Consolidation beats segmentation** - fewer, fuller ad sets perform better; let the creative + Meta distribute spend on a **broad** audience.
- **~3–15 ads per ad set** is the healthy range - target **~10**.
- **"One customer avatar per ad set" = CREATIVE coherence** (which ~10 ads), NOT audience segmentation. The ad set's **audience stays BROAD** and is the **operator's** input. Ad-set vs campaign budget (ABO/CBO) and campaign rollup are the operator's call.
- All ads in a bundle point to the **same Landing Page URL**.

## CONFIGURATION
```
SPREADSHEET_ID = 1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME   # "META - Ad Upload Sheet"
```
Per-tab columns: read [`../../meta-ad-copy-agent/references/column-maps.md`](../../meta-ad-copy-agent/references/column-maps.md) every run (header-map by NAME, never hardcode). Accounts: [`../../ad-launch-tracker-agent/SKILL.md`](../../ad-launch-tracker-agent/SKILL.md).

## STEP 0 - Resolve the ad set (the holder) - TWO operator-directed paths
Every ad in the bundle lands in ONE ad set. The operator chooses HOW that ad set is provided - confirm which path before assembling. Read whichever ad set you end up with via `list_adsets` (confirm `destinationType`/objective; `OUTCOME_LEADS` → `list_lead_forms` + `leadFormId`; `WEBSITE_AND_PHONE_CALL`/`CALL_NOW` → phone).

**Path (a) - operator names an EXISTING ad set.** Operator points to a live/broad ad set in the target account; you assemble the draft into it as-is. Simplest; no structure write.

**Path (b) - DUPLICATE the newest ad set as a fresh PAUSED holder** (used 2026-06-04 for the Skeptic bundle; choose this when the operator wants a NEW ad set but their targeting copied, not invented):
1. `list_adsets` on the target account → identify the **newest** ad set in the relevant campaign (highest adSetId / latest date).
2. `duplicate_adset(adSetId=<newest>, accountId, deepCopy=false, initialStatus=PAUSED, newName=<protocol name>)` - **`deepCopy=false`** so NO child ads are copied (the source's live ads must NOT come along), **`initialStatus=PAUSED`** so it cannot spend. This copies the operator's targeting/budget/objective (their choice) into an empty paused holder.
   - **NAME THE HOLDER PER THE ESTABLISHED PROTOCOL - set it via `newName` AT DUPLICATE TIME** (there is NO ad-set rename API - `update_adset_*` only does budget/bidding/status; name is settable only here, so getting it right at creation avoids a delete+recreate later). The convention (derived from live ad sets across E-0494/E-0535/E-0681, 2026-06-04) is:
     **`Pack {N} - [optional descriptor] - FCA={Customer Avatar} - hp={homepage} - lp={landing-page domain/path} - {MM-DD-YYYY}`**
     where `{N}` = the **next sequential Pack number in THAT account's PROSPECTING campaign** (read the campaign's ad sets via `list_adsets`, take max Pack# + 1); `[descriptor]` = optional format/theme tag (e.g. `Billboards`, `Video-Heavy`) - omit if none; `{Customer Avatar}` = the bundle's FCA; `{homepage}` = `home`; `{lp}` = the bundle's Landing Page (use the account's own domain - cleangreenfarms.com / cleangreenwell.com / cleangreen-farms.com); date = launch/build date. Examples from live: `Pack 5 - Billboards - FCA=The Skeptic 1st Time Online Buyer - hp=home - lp=cleangreenfarms.com/age-cg-listicle - 05-30-2026`; `Pack 4 - FCA=The Skeptic 1st Time Online Buyer - hp=home - lp=cleangreenwell.com/listicle-sb-1 - 05-21-2026`.
3. **SPEND GUARDRAILS - verify post-create before drafting into it:** re-read via `list_adsets` and confirm the new ad set is **`status=PAUSED` AND `adSpend=0` AND `adCount=0`** (zero copied live ads). 
4. **If `duplicate_adset` would create an ACTIVE ad set, or you cannot guarantee zero copied-live-ad spend → STOP and FLAG the operator. Never risk autonomous spend.** Only your bundle's draft ads attach; the operator reassigns/finalizes (or just publishes) in AdManage.

If no ad set is designated and the operator hasn't asked for a duplicate, **stop and ask** which path. (A from-scratch `create_adset` is NOT a path - it invents targeting; see THE GATE.)

## STEP 1 - Auto-propose bundles from the sheet
**Pick a TARGET ACCOUNT first.** Candidate rows = **the ClickUp card status is ACTIVE** (Step 1.5) **AND not yet posted to THAT target account** (the **target account's own column is EMPTY** for the row) **AND NOT Rejected in that account** (Step 1.6 - a per-account cell whose status token is `Rejected` is a HARD block for that account, applied here at row-intake BEFORE any grouping) **AND** copy-complete (Headline → Primary Var. 4 filled) **AND** pass the body-compliance gate (Step 3).
> **"First time in this account," not "never launched."** Clean Green runs many ad accounts and the same winning creative is intentionally deployed across several. The per-account columns track *which accounts each ad is already in*. An ad already live in **other** accounts is **still eligible** for a target account it has **not** been posted to - eligibility is **per the target account's column being empty**, never a global "no stamp anywhere." This avoids re-posting an ad into an account it already runs in.

## STEP 1.5 - ClickUp STATUS guard (mandatory - never bundle a dead card)
A row being copy-complete and compliant on the sheet does **NOT** mean the underlying creative is still alive. Cards get **killed/closed/archived** in ClickUp after the sheet row was written - the sheet does not auto-reflect it. **Putting a killed card in a live ad set would launch a dead/abandoned creative.**
- For every candidate row, fetch its ClickUp card (by the `Card ID` column) and read `status.type`.
- **Eligible = `status.type` is NOT `closed`** (i.e. not `killed`, not archived). Open/active/`done`(complete) creatives are eligible; `closed`-type statuses are **excluded**.
- **Verify status across the ENTIRE candidate pool, not a sample** - killed cards cluster (whole concept batches get killed at once), so a clean-looking pool can be majority-dead. (Real incident 2026-06-03: 25 of 38 "clean" candidates were killed; eligibility had skipped this check.)
- Excluded-as-killed rows go under `Ads excluded (killed/closed)` in the hand-off; never drafted, never written to the `Ad Set Group` column.

## STEP 1.6 - Per-account REJECTION guard (mandatory · block-where-failed · do NOT re-bundle a rejected creative into the account that rejected it)
**Rejection status is PER-ACCOUNT and per-account == per-domain** (each account is LP-domain-isolated: E-0496=hellocleangreen.com, E-0593=cleangreencare.com, each Flower account its own domain). A creative rejected in one account is routinely **approved in a sibling account** (Meta reviews each ad-instance independently + account standing varies; confirmed 2026-06-04: all 23 disapprovals in E-0494 while the same creatives ran approved in E-0535/E-0681/E-0645; confirmed 2026-06-10: IMG_181 V3 rejected in both accounts, V1 rejected E-0494 only, V2 rejected E-0681 only). The rule is **block-where-failed, keep-approved-elsewhere** - and **versions are separate rows**, so blocking is per version-row: a rejected V3 never blocks its sibling V1/V2.

**PRIMARY source - the sheet's per-account status cells (authoritative as of 2026-06-10):** each ad account has its **own column** on the tab, **header == the account Short Name** (e.g. `E-0494`). The old flat single `Meta Review Status` column was **DELETED 2026-06-10** (it held one account's value = ambiguous - never reference it). The per-account cell is a **combined value**: `Status - MM/DD/YYYY H:MM AM/PM PT - Ad ID: <id>`, maintained by the Stage-4 launch tracker (which maps Meta `DISAPPROVED` + `WITH_ISSUES` → `Rejected`).

For the chosen TARGET account, at row-intake (STEP 1) BEFORE any grouping:
1. **HEADER-RESOLVE the target account's column by header == Short Name - NEVER a hardcoded letter.** Columns shifted left on 2026-06-10 when the flat column was deleted (Gummies per-account cols now F/G, Flower F:J) and will shift again; a hardcoded letter reads the wrong account. If the target account has no matching header, HALT and flag the operator (do not guess a column, do not skip the guard).
2. **Parse the candidate row's cell for that account:** split on the **FIRST** ` - `, take the leading token as the status. **`Rejected` → HARD-EXCLUDE** the row for this target account. Any other token (`Active`, `Pending`, empty cell) is NOT a block - block **only on `Rejected`**, never on `Pending`.
3. **Key = creative-row × target-account.** The exclusion applies to that specific version-row in that specific account only. Sibling version-rows and other accounts (their own columns parsed independently) stay fully eligible. **Never carry one account's rejection to another.**
4. **AdManage live BACKSTOP (NON-SKIPPABLE - the genuinely additive layer):** layering note (media-buyer sign-off review, 2026-06-10): a Rejected cell is non-empty, so the per-account EMPTY-cell no-dup check already excludes that row - the sheet path makes the block explicit and digest-visible. The backstop below is what catches the case the sheet CANNOT: a rejection that landed before the tracker stamped the cell (tracker-lag window). Never skip it, even when the sheet pass found nothing. `list_ads(accountId=<target>, limit=200)` → every ad with `effectiveStatus == "DISAPPROVED"` (paginate via `includePaging` past ~200 ads, else a disapproved creative beyond the page slips the guard). Build the **date-normalized Ad Name** key set (trailing ` - {MM-DD-YYYY}` stripped, plus exact `Ad Name`); exclude candidates matching for THIS account. On an unsure near-match, confirm via `get_ad_creative_spec` (`video_id`/`image_hash`) before excluding - never exclude on a fuzzy guess. A rejection that landed minutes ago is in AdManage before the tracker stamps the cell; the sheet is authoritative for history, the live query covers the gap.
4b. **AdManage live NO-DUP BACKSTOP (NON-SKIPPABLE - all-status; covers stamp-lag + UI-direct launches):** the per-account EMPTY-cell check is the PRIMARY no-dup gate, but an empty column does NOT prove "not launched in this account" - it can be stale. Two gaps it misses: (i) **stamp-lag** - a row Adam published sits unstamped until the tracker next runs (under the 15-min-watcher + single 8am-sweep cadence that window can reach ~24h); (ii) **UI-direct launches** - an ad Adam launches straight in the AdManage/Meta UI writes NOTHING to the sheet (no draft stamp, no status cell) until a sweep reconciles it. In both cases the empty column wrongly reads as eligible -> DUPLICATE LAUNCH. So BEFORE trusting an empty per-account column: reuse the SAME `list_ads(accountId=<target>, limit=200)` call item 4 already makes (paginate ALL via `includePaging` past ~200) and build the **date-normalized Ad-Name key set of EVERY ad currently in that account - ANY `effectiveStatus`** (ACTIVE / PAUSED / PENDING_REVIEW / IN_REVIEW / WITH_ISSUES / DISAPPROVED), not just DISAPPROVED (the DISAPPROVED subset still feeds the item-4 rejection guard - one call, two guards). Strip trailing ` - {MM-DD-YYYY}`; also match exact `Ad Name`. **EXCLUDE any candidate whose date-normalized Ad Name is already present in the target account, regardless of the sheet stamp.** On an unsure near-match, confirm via `get_ad_creative_spec` (`video_id`/`image_hash`) before excluding - never exclude on a fuzzy guess. This supersedes trusting the empty column alone for no-dup: the sheet stays authoritative for HISTORY and cross-account state; the live query is authoritative for "already in THIS account right now." Excluded rows go to the **`Blocked - already live in account`** digest section.
5. **Digest:** every excluded row goes under **`Blocked - prior rejection`** (item-4 rejection hits) or **`Blocked - already live in account`** (item-4b dup hits) in the STEP 5 hand-off, one line each:
   `{code/version} | target {account} | rejected {date from the cell, or "live (AdManage)" for backstop hits} | still-eligible-on {other accounts whose cells read Active or empty}`

This is the **launch-time backstop pair**: compliance shift-left (STEP 3 / 3.5) stops policy-tripping copy before the ad is made; this guard stops an **already-rejected** creative from being re-bundled into the account that rejected it. Baked into this skill so the draft flow physically cannot route around it (it sits beside the no-duplicate-launch per-account empty-cell check and the draft-state checks).

Group eligible rows by **`[Customer Avatar]` + `[same Landing Page URL]`** (within the chosen target account).
Within a group, select **~10** (range 3–15) spanning **TOF / MOF / BOF** (use the Funnel Stage column) and **mixing IMAGE-tab + VIDEO-tab** rows for that avatar. **Aim for a funnel spread (TOF + MOF + BOF) so Meta can sequence the bundle toward a conversion** - top-of-funnel creatives introduce, mid/bottom convert; consolidating them in one broad ad set lets Meta distribute spend across the sequence.
- **ACTOR AGE-BRACKET HOMOGENEITY - single-bracket per ad set (Adam, 2026-06-04):** every **actor-present** ad in a bundle must share ONE age bracket. A bundle is **all-YOUNGER actor ads OR all-OLDER actor ads** - never mixed (never a 20s-actor ad in the same set as a 50s/60s-actor ad). Read the **`Actor Age Bracket`** column (header-mapped; auto-populated by intake vision - see [meta-intake](../meta-intake/SKILL.md) step 4.5; values `YOUNGER` / `OLDER` / `NO-ACTOR`). **`NO-ACTOR` ads are age-agnostic WILDCARDS** - eligible for ANY set; they do NOT constrain the bracket. So a valid bundle = `[all-YOUNGER actor ads + any NO-ACTOR wildcards]` **OR** `[all-OLDER actor ads + any NO-ACTOR wildcards]`. Borderline rows carry a trailing ` ⚠` → confirm the bracket with the operator before grouping (don't force). Empty `Actor Age Bracket` (not yet vision-classified) → classify first (intake step 4.5) or exclude; never guess a bracket.
- **INVENTORY CHECK:** if a group cannot fill ~10 across the funnel, propose the **smaller** bundle and **FLAG the shortfall** - **never pad** with off-avatar, off-LP, off-bracket, or non-compliant rows.

## STEP 2 - `Ad Set Group` column (selection record · structural · anti-clobber)
Tag each bundle's rows with a **bundle ID** (e.g. `FCA=The Skeptic | LP=listicle-sb-1 | Set-1`) in the **`Ad Set Group`** column.
- This is a **new structural column** added at the **END of the tab's used range** (first empty column to the right of the current last header). Header = `Ad Set Group`.
- **Header-map it by NAME every run** - never hardcode the letter.
- **Anti-clobber on add:** appending a column at end-of-range must not reindex existing columns; **verify** the `Ad Name` formula is not an open full-row range that would capture the new column, and **re-read row 1 after adding** to confirm placement and that no map shifted.
- The agent writes the **proposed** bundle IDs; the **operator confirms/edits** the column → confirmed value = the locked selection for that ad set.

## STEP 3 - Compliance gate per ad (mandatory)
Run every candidate ad's **headlines AND body** through the copywriter's three passes (`../../meta-ad-copy-agent/references/compliance.md` §10 → §9 → §1–8, carve-out aware), same as `../launch/SKILL.md` Step 1.5.
- **PASS** → eligible for the bundle.
- **FAIL** → **exclude** from the bundle, list under `Ads excluded (compliance)`, never drafted. The path gates only - it never rewrites copy.

## STEP 3.5 - Meta-POLICY pre-flight gate (mandatory · DISTINCT from #72)
Separate from the brand M-code compliance above (#72 = Clean Green brand/claim rules). This gate catches **Meta ad-policy** rejections **before** launch - the kind that get a *published* ad DISAPPROVED (and that Meta does NOT expose a reason for via API; only Ads Manager). Run every candidate ad's **headline + body + on-asset text** against **`M-18`** - defined in the canonical `agents/meta-compliance-agent/references/rules.md` (owned by team-lead; this gate **references it by ID+path, never redefines it**).
- **M-18 = refund-tied-to-a-claim / outcome-guarantee framing.** FAIL examples: `Our Promise: [X] Or Your Money Back`, `[quality/outcome claim] or your money back`, `no real guarantee` framing. **Distinguishing test:** money-back tied to a PROMISE/CLAIM = **FAIL** (this is what got `IMG_413` disapproved 2026-06-04); a plain time-boxed return policy (`100-day money-back guarantee`, `100 days no questions`) = **OK** (approved brand offer - do NOT flag it).
- Also screen common Meta triggers: unrealistic outcomes, before/after, health-cure claims, personal-attribute/"you" targeting of conditions.
- **FAIL** → exclude (list under `Ads excluded (Meta-policy)`), never drafted. Gate only - never rewrites copy. (Meta's literal citation, when an ad is already live + rejected, is Ads-Manager-only - relay it to team-lead to tighten M-18.)

## STEP 3.6 - CANNABIS-CODING aggregate gate (mandatory · M-19f · DISTINCT from #72 and M-18)
STEP 3 (brand M-code) and STEP 3.5 (M-18) both PASS copy with **no hard banned term** that Meta still rejects "It looks like your ad promotes edible cannabis - Drugs & Pharmaceuticals." Meta's ML classifier reads the **aggregate cannabis-CODING** across many soft signals, none individually banned (the *deterministic-clean ≠ compliant* gap at the classifier level; origin: AliCG3/JCG1 rejections 2026-06-18, re-launch into a NEW account drew the SAME rejection → it follows the AD, not the account). This gate scores that aggregate **before** the draft is built.
- **Source (machine-readable, read live - never hardcode):** `agents/meta-compliance-agent/data/cannabis-coding-signals.json` (M-19f, meta-compliance-owned) + human reference + the M-code-safe replacement set in `agents/meta-compliance-agent/references/cannabis-coding-risk.md`.
- **Compute per candidate ad:** grep its copy (Headline + Headline Var. 1–4 + Primary + Primary Var. 1–4 + Ad Description) against every `copy_signals[].pattern` (case-insensitive) and SUM the matched `weight`s; then add the non-text checks - `creative_signals_vision` (plant/smoke/consumption imagery, nature-DOMINANT palette - a vision-layer read of the creative) and `destination_signals` (ingestible-THC anywhere on the destination **DOMAIN**, embedded COA on the linked page, weak/footer-only age-gate - domain/page checks).
- **Flag rule (from the JSON `handling`):** aggregate score `>= scoring.threshold` (4) **OR** any HIGH signal co-occurring with ≥1 MEDIUM → **FLAG**. A flagged ad is NOT auto-drafted → route to meta-compliance for verdict / human pre-launch decision; de-code using the replacement set in `cannabis-coding-risk.md` (e.g. **omit** the "ships to eligible states" line entirely - flower bans only the all-50 CLAIM, not silence; move COA/testing off-ad; rotate the M-3 "real ___" subs), then re-gate. List flagged-and-excluded under `Ads excluded (cannabis-coding)`.
- **This is a RISK flag, NOT a pass/Meta-safe clearance:** `hard[]=0` does NOT auto-PASS when this score is high; a LOW score does NOT mean Meta-safe (Meta **flatly prohibits** THC - no cert path).
- **Adam exclusions (2026-06-18):** the **mylar stand-up pouch** as hero + the **Clean Green leaf LOGO** are FINE - NOT weighted, NOT signals.
- **CEILING:** this is detection-reduction + a pre-launch catch (so account health is not burned on doomed launches), not compliance. The **DOMAIN** signal is the dominant/hardest blocker - fixable only by domain/routing separation (landing-page-agent + **Adam's strategic call**), not copy. Gate only - never rewrites copy.

## STEP 4 - Assemble ONE draft per bundle
One `create_draft` call per confirmed bundle. `ads[]` = one entry per bundle row:
- `adAccountId` = the bundle's account.
- `adSets` = `[ the operator's designated ad set (from list_adsets) ]` - **the SAME ad set object on every ad in the bundle** → all ~10 land in one ad set.
- `media` = **default to `type:"multi"` carrying BOTH aspect ratios per ad** (Adam, 2026-06-04 - single-aspect drafts get sent back): video rows → 9x16 **and** 4x5; image rows → 1x1 **and** 9x16. Pass a `dimension` per item so Meta maps placements correctly (9x16=`"1080x1920"` Stories/Reels, 4x5=`"1080x1350"` Feed, 1x1=`"1080x1080"` Feed) - without dimensions the launcher can swap feed/story variants. The sheet's Drive `…/view?usp=drive_link` URLs are accepted by create_draft as-is (it ingests them to media.admanage.ai); `browse_google_drive` `launchUrl` also works - never proxy-wrap/modify.
- `title` = Headline; `headlineVariations` = Headline Var. 1–4.
- `description` = Primary (the Meta **Primary Text** / body); `bodyVariations` = Primary Var. 1–4.
- `adDescription` = the sheet **`Ad Description`** column → the SEPARATE Meta **Description** field (the link-description shown under the headline). This is DISTINCT from `description`/Primary Text: if you set only `description`, the Meta Description field is left EMPTY (caught 2026-06-04). Always set BOTH when the row has an `Ad Description`.
- `link` = the **shared** Landing Page URL (must match across the bundle); `urlTags` = the UTM column if present.
- `cta` = configurable launch default, **adjustable by funnel stage** (e.g. TOF `LEARN_MORE`, MOF/BOF `SHOP_NOW`; default `SHOP_NOW`); operator can override per bundle.
- `page` / `insta` from `get_launch_defaults` (auto-filled when omitted).
- `adName` = the sheet `Ad Name` **verbatim** (Stage 4 join key).
- **Promo code = NOT API-fillable** (verified 2026-06-04): `create_draft` / `update_draft` / `edit_ads` have no promo-code/offer/coupon param, and the draft's persisted row schema has no such key - the AdManage UI "Promo Code" field is UI-only (likely backs a Meta Offer object at the publish layer). Put the code in the copy (a body line + a headline like `"20% Off Today, Code TRY20"` + the Ad Description), and FLAG the operator to fill the UI Promo Code field before publishing. Do NOT guess-write an unknown field name onto an approved draft to probe it.
Mixed image + video in one ad set is intended and supported. Draft `title` e.g. `"Meta Ad Launch Agent - {avatar} - {account} - {date}"`. Capture the draft `id`. **Do not call `launch_draft`.**

## STEP 5 - Hand off to the operator + STOP
```
## Stage 3B Ad-Set Batch - Draft staged for your review (NOTHING launched)
Ad set: {ad set name}  ·  account: {account}  ·  avatar: {avatar}  ·  LP: {landing page}
Draft: {title}  ·  id: {draftId}  ·  ads: {n}
Review + publish in AdManage:  {draft link}     <-- you publish; the agent cannot
Ads in bundle: {ad names...}
Ads excluded (killed/closed): {...}
Blocked - prior rejection: {code/version} | target {account} | rejected {date} | still-eligible-on {accounts}
Ads excluded (compliance): {...}
Inventory note (if under ~10): {shortfall + why}
BEFORE YOU PUBLISH: (1) set the UI **Promo Code** field (e.g. TRY20) - it is UI-only, not API-fillable (STEP 4); (2) confirm the Drive media previews render (poster build can lag on same-day shares); (3) {if holder was duplicated} the ad set is a PAUSED copy of your newest set - keep it or reassign, then publish.
```
Then **stop**. Stage 4 (tracking) stamps the launch date back after the operator publishes.

## ROLLOUT
**Start with 2 bundles**, validate the published result with the operator, then scale. Quality + correct grouping over volume.

## RULES
- Creatives: `create_draft` only; `launch_draft`/`launch_ads`/`launch_google_ads` excluded - operator publishes. `create_adset` excluded (invents targeting).
- The ONLY permitted live structure write: `duplicate_adset` of an existing operator ad set as a PAUSED, structure-only (`deepCopy=false`) holder - verify post-create `status=PAUSED`+`adSpend=0`+`adCount=0`; STOP+flag if active or any copied live ad; never autonomous spend (STEP 0 path b).
- Never invent targeting - ad set audience/budget/objective are the operator's (existing or duplicated-from-existing, broad).
- THREE gates per ad, any fail=exclude (never drafted, never auto-rewritten): (#72) brand M-code compliance (STEP 3) AND (M-18) Meta-policy pre-flight (STEP 3.5, refund-tied-to-claim / outcome-guarantee - references M-18 @ landing-page meta-compliance.md, never redefines it) AND (M-19f) cannabis-coding aggregate score (STEP 3.6, reads `agents/meta-compliance-agent/data/cannabis-coding-signals.json`; FLAG≥threshold → meta-compliance verdict / human pre-launch; risk-flag not a pass; never redefines the signals). All three reference the canonical meta-compliance rules by path, never redefine them.
- SINGLE AGE-BRACKET per ad set (STEP 1): all-YOUNGER actor ads OR all-OLDER actor ads, never mixed; NO-ACTOR ads = age-agnostic wildcards (any set). Read `Actor Age Bracket` col (header-mapped); borderline ` ⚠` → confirm; empty → classify or exclude.
- Eligibility = **ClickUp status ACTIVE (not killed/closed/archived - Step 1.5)** AND **not yet in the TARGET account** (that account's column empty) AND copy-complete AND gate-clean. NOT "never launched anywhere" - same creative may deploy to multiple accounts, one ad set per (account × avatar). **Status-check the WHOLE candidate pool - killed cards cluster.**
- PER-ACCOUNT REJECTION GUARD (STEP 1.6, at row-intake BEFORE grouping): PRIMARY = the target account's own per-account status column (header == Short Name, header-resolved, never a letter - the flat review-status col was DELETED 2026-06-10); parse the combined cell on the FIRST ` - `, leading token `Rejected` = HARD block for that account ONLY (block-where-failed, keep-approved-elsewhere; per version-row; never block on Pending; never carry one account's rejection to another). BACKSTOP = AdManage `list_ads` date-normalized Ad-Name match, TWO guards from one call: the DISAPPROVED subset blocks re-launch-where-rejected (covers tracker lag) AND the ALL-STATUS set blocks duplicate launches (covers stamp-lag + UI-direct launches - an empty per-account cell does NOT prove not-launched; STEP 1.6 item 4b). Excluded → `Blocked - prior rejection` / `Blocked - already live in account` digest sections.
- Same avatar + same Landing Page URL + same target account per bundle; ~10 ads (3–15), funnel-spread (TOF/MOF/BOF so Meta sequences toward conversion), image+video mixed; never pad.
- Verbatim ad name + media URL; `Ad Set Group` column added anti-clobber at end-of-range, header-mapped.
- Report and stop at "draft staged."

## TOOLS REQUIRED
- **AdManage MCP:** `list_ad_accounts`, `list_adsets`, `list_ads` (STEP 1.6 per-account disapproval guard - read `effectiveStatus`), `get_ad_creative_spec` (STEP 1.6 near-match confirmation only), `get_launch_defaults`, `browse_google_drive`, `create_draft`, `get_draft`, `list_drafts`, `list_lead_forms` (only if `OUTCOME_LEADS`); `duplicate_adset` - ONLY for STEP 0 path (b), `deepCopy=false`+`initialStatus=PAUSED`, guardrail-verified. **Excluded by design:** `create_adset`, `launch_draft`, `launch_ads`, `launch_google_ads`.
- **Composio Google Sheets MCP:** read candidate rows; write the `Ad Set Group` column.
- **ClickUp (MCP `clickup_get_task` or REST `GET /task/{id}`):** Step 1.5 status guard - read `status.type` for every candidate card; exclude `closed`-type (killed/archived).

## HANDS OFF TO
Stage 4 - the launch tracker ([`../../ad-launch-tracker-agent/`](../../ad-launch-tracker-agent/)) stamps the launch date back once the operator publishes the draft.
