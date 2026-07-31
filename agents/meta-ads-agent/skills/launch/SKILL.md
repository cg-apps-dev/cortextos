---
type: skill
agent: meta-media-buyer-agent
skill: launch
status: active
date: 2026-06-02
tags: [meta-ads, admanage, launch, draft, human-gated, pipeline-stage-3]
---

> **Owner: meta-media-buyer-agent** (the-orchestrator ruling, 2026-06-04 role split - confirmed 2026-07-24). This file sits under `agents/meta-ads-agent/skills/` for historical/pipeline-location reasons; the frontmatter previously read `agent: meta-ads-agent`, which was stale. mmb is the actual owner AND executor - meta-ads-agent defers.

# Stage 3 - Launch (DRAFT ONLY · human-gated)

You stage launch-ready rows from the META Ad Upload Sheet as **AdManage drafts**, then hand the operator a link to review and publish. You do **not** publish. Nothing you do puts an ad on Meta.

> ## THE GATE - read this first
> - You may call **`create_draft`** only. You must **never** call `launch_draft`, `launch_ads`, or `launch_google_ads`. They are not your tools.
> - `create_draft` saves the ad configuration as a draft in AdManage - it is **not** submitted to Meta. Only the operator clicking **publish** inside AdManage creates and submits the ads. That human click is the gate, and there is no path around it.
> - Your run ends at "draft created - here is the link." If you ever find yourself about to launch, stop and report instead.
> - This is real ad spend on the other side of the operator's click. Treat every draft as something a human will scrutinize: complete, correctly targeted, correctly mapped.

---

## CONFIGURATION
```
SPREADSHEET_ID = 1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME   # "META - Ad Upload Sheet"
```
Tabs + per-tab columns: read [`../../meta-ad-copy-agent/references/column-maps.md`](../../meta-ad-copy-agent/references/column-maps.md) every run (single source of truth). Account list + IDs: [`../../ad-launch-tracker-agent/SKILL.md`](../../ad-launch-tracker-agent/SKILL.md) (the 6 Flower/Gummies accounts).

## STEP 1 - Find launch-ready rows
A row is launch-ready when: the copy block is fully populated (Stage 2 done - Headline → Primary Var. 4), the Customer Avatar + Funnel Stage are set, the primary creative asset link is present, it **passes the body-compliance gate (Step 1.5)**, and it has **not already been drafted or launched** (no launch date stamped by Stage 4; not already in a pending draft). Read these via Composio Sheets per the column map. Skip rows missing any prerequisite and log why.

## STEP 1.5 - BODY-COMPLIANCE GATE (mandatory · no non-compliant copy goes live)
> **Standing safety gate (established 2026-06-03).** Stage 2 compliance-passes copy at *generation* time, but the sheet also holds rows intaken **before** the compliance stack was tightened - their bodies can carry banned terms (audit found legacy/older rows broadly using `flower`/`bud`, `lab-tested`, `discreet`, Farm-Bill/`2018`, and potency `strong`/`weak`/`potent`, plus M-12 `Tired/Sick of…?` question-headlines). This gate stops Stage 3 from ever drafting NEW non-compliant copy live. It does **not** fix existing copy (live-ad cleanup is a separate, Adam-gated audit) - it only blocks the launch path.

For **every** row that otherwise looks launch-ready, run its **headlines AND body** (Headline + 4 Headline Variations + Primary + 4 Primary Variations) through the copywriter's three compliance passes - `../../meta-ad-copy-agent/references/compliance.md` §10 mechanical → §9 cleanup → §1–8 LLM - **carve-out aware** (the first-person review/testimonial carve-out applies; e.g. `"stronger than expected"` inside a customer quote is allowed, but a brand-voice potency claim, or any `flower`/`bud`/`lab-tested`/`discreet`/Farm-Bill term, is a hard fail regardless of voice).
- **PASS** → eligible to draft.
- **FAIL** → do **NOT** draft this row. Skip it, and list it in the run report under `Rows skipped (compliance)` with the offending term(s). Never auto-rewrite copy inside the launch path - flag it back for a gated copy fix; the launch path only gates, it does not edit.

This is a hard gate: when in doubt, skip. A blocked launch is always cheaper than non-compliant spend / a Meta rejection.

## STEP 2 - Resolve target account + ad set
> **BUILD-TIME CONFIRM (targeting):** the agent must know which **ad account** and which **ad set** each row launches into. Until a sheet-driven rule is confirmed, take the target account(s) and ad set(s) as **operator input per run** (the operator names the account + ad set when triggering this stage). Then:
- `list_ad_accounts` → confirm the target account (prefer `isDefault` when present).
- `list_adsets` for that account → select the designated ad set (check `destinationType` + objective; if `OUTCOME_LEADS`, a lead form is required; if `WEBSITE_AND_PHONE_CALL`/`CALL_NOW`, a phone number is required).
- `get_launch_defaults` for the account → `page` + `insta` (required for Meta).

Never invent an account or ad set. If the operator did not specify and no rule exists, stop and ask.

## STEP 3 - Resolve the creative media URL
The sheet asset cell holds a Google Drive link. Use `browse_google_drive` to get the launchable `launchUrl` and pass it **exactly as-is** to `media[].url` (never proxy-wrap or modify). Pass `width`/`height` (or `dimension`) and `mimeType` when known so Meta maps formats correctly.

## STEP 4 - Assemble the draft (ads[])
Build one `ads[]` entry per launch-ready row. Map the sheet copy → Meta Advantage+ creative:
- `type: "flexible"` (Advantage+) - requires the ad set objective to be `OUTCOME_SALES` or `OUTCOME_APP_PROMOTION`; otherwise use `type: "single"`.
- `title` = the primary Headline; `headlineVariations` = the 4 headline variations.
- `description` = the primary Primary; `bodyVariations` = the 4 Primary variations.
- `adName` = the sheet Ad Name (verbatim - Stage 4 matches on it).
- `media` = the resolved Drive `launchUrl`.
- `adAccountId`, `adSets`, `page`, `insta` from Step 2. `link` = the landing-page URL (sheet `Landing Page URL` column); `cta` per the standard (e.g. `SHOP_NOW`).
- Customer Avatar / Funnel Stage are sheet-organizational, not Meta launch fields - do not send them as ad fields.

## STEP 5 - Create the draft (NOT launch)
Call **`create_draft`** with the assembled `ads[]` and a clear `title` (e.g. `"Meta Ads Agent - {date} - {account short name}"`). Group sensibly (one draft per account/batch so the operator reviews a coherent set). Capture the returned draft `id`. **Do not call `launch_draft`.**

## STEP 6 - Hand off to the operator + STOP
Report, for each draft created:
```
## Stage 3 Launch - Drafts staged for your review (NOTHING launched)
Draft: {title}  ·  id: {draftId}  ·  account: {account name}  ·  ads: {n}
Review + publish in AdManage:  {draft link}     <-- you publish; the agent cannot
Rows drafted: {ad names...}
Rows skipped (not ready): {reasons}
```
> **BUILD-TIME CONFIRM (draft link):** verify whether `create_draft` / `get_draft` returns a direct deep-link URL to the draft; if not, give the operator the AdManage drafts-section URL + the draft `id`/title so it is one click to find. Use `list_drafts` to confirm the draft persisted.

Then **stop**. Do not poll for publish, do not launch, do not advance. Stage 4 (tracking) picks up the launch *after* the operator publishes.

---

## RULES
- **`create_draft` only.** `launch_draft` / `launch_ads` are forbidden in this stage - the operator publishes.
- **Complete or nothing.** Only draft rows that are fully ready (copy + avatar + funnel + asset). Skip + log the rest.
- **Body-compliance gate is mandatory (Step 1.5).** Never draft a row whose headlines or body fail the 3 compliance passes (carve-out aware). The launch path gates only - it never rewrites copy. Skip + flag failures.
- **Never invent targeting.** Account + ad set come from the operator or a confirmed rule.
- **Verbatim ad name + media URL.** Ad name must match the sheet (Stage 4 join key); media URL passed exactly as `browse_google_drive` returns it.
- **One coherent draft per account/batch**, so the human review is clean.
- **Report and stop** - the run ends at "draft staged."

## TOOLS REQUIRED
- **AdManage MCP:** `list_ad_accounts`, `list_adsets`, `get_launch_defaults`, `browse_google_drive`, `create_draft`, `get_draft`, `list_drafts`, `list_lead_forms` (only if objective is `OUTCOME_LEADS`). **Excluded by design:** `launch_draft`, `launch_ads`, `launch_google_ads`.
- **Composio Google Sheets MCP:** read launch-ready rows.

## HANDS OFF TO
Stage 4 - the launch tracker ([`../../ad-launch-tracker-agent/`](../../ad-launch-tracker-agent/)) stamps the launch date back to the account column once the operator has published the draft and AdManage logs the launch.
