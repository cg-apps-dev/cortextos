---
name: meta-ad-copy-playbook
description: |
  THE single read-every-run playbook for writing Meta ad copy (5 headlines + 5 primaries per row) for Clean Green. Replaces the gather-from-8-files workflow: everything you APPLY every run is in PARTS 1-3 here; deep theory/examples/exact-columns are read-on-demand in PART 4. Follow top-to-bottom, run the ONE gate, get the meta-compliance sign-off, write, report.
---

# Meta Ad Copy Playbook (read this top-to-bottom every run)

You write Meta ad copy for Clean Green: per row, **5 headlines + 5 primary-text bodies** (+ Customer Avatar + Funnel Stage + Ad Description + Promo). Compliance is single-sourced from the meta-compliance-agent - this playbook never duplicates M-code rules, it points at them.

**The golden rule that caused most past mistakes:** do not free-hand, do not gather rules from memory. Apply PARTS 1-3 of THIS doc every row, then run the ONE GATE (PART 3), then the meta-compliance sign-off. When something here points to a reference (PART 4), open it - but PART 4 examples predate the M-19f de-code + the second-person rule; **if a reference example conflicts with a rule here, the PLAYBOOK rule wins.**

**CHECK THE SPREADSHEET NAME FIRST - two exceptions exist so far.** Everything below (including the second-person rule in §A) is the DEFAULT voice for the main sheet and any actor sheet without its own directive. **If the target spreadsheet is `Meta Ads Upload - Sarahs Finds`, read [`references/sarahs-finds-voice.md`](references/sarahs-finds-voice.md) INSTEAD of §A/§B/§C. If it's `Meta Ads Upload - Jennifer Stone`, read [`references/jennifer-stone-voice.md`](references/jennifer-stone-voice.md) INSTEAD** - each runs its own dedicated first-person persona voice (Adam directive, 2026-07-23) that deliberately overrides second-person, and the two personas are DISTINCT (different age, different tone) - do not cross-apply one persona's voice file to the other's sheet. Compliance (PART 3 gate, meta-compliance sign-off, and the M-15b no-underage-nostalgia-anchor rule both persona files carry) still applies unchanged regardless of which voice file you're following. Other actor sheets follow the standard voice below unless/until Adam gives them their own file the same way.

---

## PART 1 - THE PROCEDURE (ordered, every row)

1. **Read the asset.** Image row → read the image (on-image text verbatim, offer, proof, who's on screen). Video row → read the ClickUp brief + the actual creative (audio is source of truth; the edit can diverge from the brief). Effort ~60% understand / 40% write. The tab declares the product (Flower vs Sleep Gummies) - never infer product from the asset.
2. **HALT conditions** (block the row, leave ALL its cells empty - 10 copy + avatar + funnel + Ad Description + Promo - do NOT write status/cache/helper cells, do NOT fall back to other content, add to the blocked list, surface in the report):
   - asset visibly contradicts the tab → `blocked-tab-mismatch`
   - image unreadable / OCR failure → `blocked-ocr`
   - video brief missing/unusable → `blocked-brief`
   - no ClickUp Card ID on a video row → `blocked-no-card`
3. **Pick Customer Avatar + Funnel** (§D, §E). From the canonical list, validated. **Skip if the cell is already non-empty** (never overwrite operator-set values; only `regenerate` on explicit request).
4. **Write 5 headlines** (§B). 5 hooks, clarity gate, second-person, <40 chars, no two share first 5 words.
5. **Write 5 primaries** (§C). 5 angles, 5 SHAPES (rotate), §5.5 format, second-person, testimonials-in-quotes, de-code vocab, asset-aligned.
6. **Write the Ad Description** (§H).
7. **Run THE GATE** (PART 3). One deterministic pass over all cells. Any hit → rewrite that cell, re-gate.
8. **meta-compliance sign-off** (§F). Batch the risk rows to the meta-compliance-agent; apply fixes; re-gate.
9. **Write to the sheet** (§G). Write the 12 copy/intake cells + Ad Description + Promo. Read back, assert it landed.
10. **REPORT** (§I). Never present blocked rows as done.

---

## PART 2 - THE RULES (apply every row)

### §A - VOICE (+ the second-person rule)
- **SECOND PERSON, always (Adam HARD RULE 2026-06-20).** Headlines AND primary speak TO the one person reading - "you / your". Never about a character in the ad. ❌ "He Got His Saturday Mornings Back" → ✅ "Get Your Saturday Mornings Back".
- **First person is ONLY allowed as a testimonial, and MUST be wrapped in quotes "…" or parens (…).** ❌ bare `I kept scrolling past these ads` → ✅ `"I kept scrolling past these ads…"`, or reframe to the reader: `You've probably scrolled right past these`. Brand "we/our" (the company speaking) is fine - it's not the ad-person's voice.
- Warm, plain-spoken, confident, human. Short sentences (4-12 words), contractions, fragments OK. Specificity over cleverness. **No ellipses for drama unless inside a customer quote.**
- **Per-product lanes never cross.** Flower = daytime/recreational/confident, doorstep/delivery, premium/small-batch - never "wind-down/evening reset". Gummies = evening/wind-down/measured ritual; NO sleep-outcome words (M-13) - never "real quality delivered fast".

### §B - HEADLINES (5 per row)
- **5 hook types, one each:** Balanced · Curiosity · Proof · Pain · Transformation. No synonym-swaps; **no two share their first 5 words**. **6-10 words, under 40 chars** (FB feed truncates ~27; front-load payload in first 5 words). No ending period unless two sentences. Match the asset's caps/case.
- **CLARITY GATE:** a cold reader seeing ONLY the headline must know WHAT it is + WHY they'd care. **≥2 of the 5 must be "crystal-clear": exactly ONE PRODUCT-CLEAR + ONE PROMO-CLEAR**, generated fresh per ad (never a pasted fixed string), and **≥3 of 5 must name the product category.**
  - Gummies category nouns: "wind-down gummy", "DeepSleep Gummies" (product name OK). **NEVER "Sleep Gummies"** - "Sleep" reads as an implied M-13 outcome claim.
  - Flower: the category word is banned, so name it through a compliant frame ("the real thing", "delivered", "the good stuff"). (Do NOT use "farm-direct" - RETIRED, see §De-code.)
- One of the 5 should speak to the row's avatar directly. **No diagnostic-question headlines** ("Tired of…?", "Can't sleep?") - M-12. Product-spec numbers OK (15mg, 20% off, 100-day); social-proof counts banned in headlines (M-16a).

### §C - PRIMARY TEXT (5 per row)
- **5 angles, one each:** Balanced/skeptic-to-believer · Proof-led · Pain-led · Social-proof(customer voice) · Offer/urgency. No two share their first 5 words / lead angle / proof order.
- **5 SHAPES, rotate across the slots** (set reads as 5 different ads, length spread ≥2x): Classic-mid (hook + ✅ stack + close) · Short (2-3 lines, no stack) · Long-form story (3-4 short paras, no stack) · Testimonial-led (a real quoted review/creator line, never invented - M-6) · Stack-led (✅ stack first). **✅-stack minimums:** Classic-mid/Proof-led ≥3 ✅ lines, Pain-led ≥2 ✅, each a distinct proof point.
- **ASSET-ALIGNED (the #1 rule):** every body's hook + proof pulls a SPECIFIC element from this asset (its offer text, on-asset number, a transcript phrase, an overlay echo). Generic per-product copy = FAILURE even with the right proof bank.
- **First sentence < ~100 chars; hook + what-it-is land in the first 125 chars** (mobile fold). Reader-side before product-side.
- **Close = EXACTLY ONE, never stacked:** skeptic-challenge `Still skeptical? Test it yourself.` · offer `Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)` · free-gift (when the asset carries one - replaces the offer line, never stacked with TRY20). **Match the close to the row's CTA button (gate-enforced, §4.0b):** `SHOP_NOW` → offer/free-gift close (REQUIRED); `LEARN_MORE` → skeptic-challenge or soft close, NO TRY20 in the body (the ONLY CTA exempt from the offer-CTA-close rule); any other → offer-CTA close REQUIRED (fail-safe: only `LEARN_MORE` is exempt). For an offer/non-LEARN_MORE row the gate also requires ≥2 direct offer-CTA headlines.
- Second person + testimonials-in-quotes (§A). The offer/CTA line is always reader-directed.

### §5.5 - VISUAL FORMATTING CONTRACT (NON-NEGOTIABLE - the rule most often missed)
- **BLANK LINE (`\n\n`) between EVERY paragraph.** Single-line-break bodies render as one dense block = FAILURE.
- The ONLY single-newline grouping is a ✅ checklist block (consecutive ✅ lines compact); the block gets a blank line ABOVE and BELOW. One idea per line. **No em dashes.** No dramatic ellipses outside a quote.
- **Emoji whitelist:** ✅ proof stacks only (one per line) · ⭐️⭐️⭐️⭐️⭐️ review-style only · 🎁 free-gift only. 🌿/🍃 HARD-BANNED (M-19e). Headlines: no emoji unless the asset shows a real star rating.

### §De-code - FLOWER/GUMMIES VOCAB (M-19f, canonical, brain PR #139/#140)
- NO shipping/eligible-states/legal-in language. NO lab/COA/"third-party tested"/"tested before it ships" testing claims.
- NEVER: grown (ALL forms incl `family-grown` - M-19b banned, Adam 2026-07-01; the pre-2026-07-01 "Adam-allowed 2026-06-22" carve-out is SUPERSEDED/RETIRED), harvest, cultivat*, strain, bud, flower (as product noun → "the good stuff"/"premium"/"small-batch"), marijuana, cannabis, THC, CBD, CBN, dispensary, weed, pot, joint, eighth, 3.5g, hand-roll*, gas station. RETIRED: farm-direct. ALLOWED substitute for provenance: `family-owned` (ownership/craft claim, mc-approved 2026-07-16 - NOT a cultivation-provenance claim, not term-banned).
- M-3 substitutes (rotate, stop over-using "real"): premium / small-batch / quality / gold standard / the good stuff / what we ship / carefully crafted / real deal.
- "Pure Nature" only inside the "clean green PURE NATURE" lockup, never standalone.
- **DeepSleep formula = SIX ingredients** (built around ashwagandha, L-theanine, magnesium, B2; two of six are M-2-unnameable). A count claim is allowed ONLY as the true count ("six"/"6 natural ingredients") - never "four/three" (FALSE), never invent a number. Ingredient lists always framed NON-EXHAUSTIVE ("built around X, Y, Z"), never "that's all that's in it". Re-verify the count against the brain product page each run.

### §Compliance - SINGLE-SOURCED (never duplicated here)
- Canonical M-codes live in brain `agents/meta-compliance-agent/references/rules.md` (M-1…M-25). **Pull LIVE every run.** The deterministic grep (PART 3) is a fast tripwire mirroring them (rebuild the term-set from rules.md each run); the meta-compliance-agent scan is the authority + HARD pre-write gate. Review-Style carve-out: a quoted "…" + ⭐️⭐️⭐️⭐️⭐️ real review isn't reworded, but still must pass the scan (and a quote with symptom-resolution language is dropped, not shipped).

### §D - CUSTOMER AVATAR (canonical list = authority)
- **Write only an EXACT dropdown string** (gog can't read the live dropdown; the Sheets API doesn't reject invalid values - a wrong string silently lands invalid, the 2026-06-10 incident):
  - Flower (both tabs): `FCA=The Shop Switcher` · `FCA=The Skeptic 1st Time Online Buyer` · `FCA=Daily Unwind` · `FCA=Pain Relief` · `FCA=Better Sleep` · `FCA=Subscribe and Save`
  - Gummies (both tabs): `DSCA=Tried Everything` · `DSCA=Racing Mind` · `DSCA=Wellness Stacker` · `DSCA=Better Mornings`
- **DRIFT TRIPWIRE (every avatar write):** gog-read the distinct non-empty values already in the live Customer Avatar column; assert every live-used value is in the list above; any live value NOT in the list → HALT + flag (dropdown changed, list stale). **Never overwrite a non-empty avatar cell.** After writing, read back, assert each == intended. Map avatar → conversion stage (Skepticism→Trial→Transformation→Repeat) for the lead angle; match avatar to the asset concept. Inference cues + tie-breakers + blank-default (flower→Skeptic, gummies→Racing Mind) → PART 4 avatars.md.

### §E - FUNNEL STAGE
- TOF / MOF / BOF (uppercase, exact). From the brief if declared (Cold→TOF, Warm→MOF, Hot→BOF); else default **TOF** (a fetch-failure also defaults TOF + flags). **Never overwrite a non-empty funnel cell.**

### §F - meta-compliance sign-off (HARD pre-write gate)
- After the deterministic gate passes, batch the risk rows (review-quote/⭐ rows + health/ingredient-adjacent rows) to the meta-compliance-agent via the bus; apply its fixes; re-gate until it signs. It owns the semantic verdict; nothing goes live unsigned.

### §G - COLUMN MAP + WRITE
- Sheet ID `1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME`. **Header-map by NAME live every run** (never trust cached letters - structural inserts shift columns); halt the tab + report on a header mismatch. **Write set = the 10 copy cells + Customer Avatar + Funnel + Ad Description + Promo** (live practice per the ratified column-ownership doc; see the mapping's RATIFY-AT-MERGE note). Write only your owned columns; one contiguous range per row where possible; read back and assert. Per-tab letters → PART 4 column-maps.

### §H - AD DESCRIPTION
- The separate Meta "Description" field under the headline. **Complement, never duplicate the headline** - add the one thing it didn't (usually a trust element: guarantee/shipping; or the category if the headline led with benefit). Shape: `[category/benefit fragment] + [one trust element]`, payload in first ~25 chars, whole line < ~60. Same full compliance surface as the copy (de-code + M-codes). It renders only on some placements, so it is NEVER the sole carrier of the offer/CTA/qualifier. Refresh it whenever you rewrite the copy block.

### §I - REPORT (every run, to the orchestrator)
- Per tab: rows processed / skipped (copy present) / skipped (no asset) / blocked (with reason: tab-mismatch/ocr/brief/no-card). Compliance: lines passed first-time vs needed-fix (+ the M-code) vs couldn't-pass. Avatar + funnel fill stats (sources, skips, defaults, any divergences). Schema-audit failures FIRST. A one-paragraph upstream-cause for any blocked rows. **Never present blocked rows as done.**

---

## PART 3 - THE ONE DETERMINISTIC GATE (run over all cells before any write)

One pass; ANY hit = rewrite that cell, re-gate. (Reference impl `references/copy-gate.py`; term-set rebuilt from live brain rules.md each run.)

**AUTHORITY - the gate SELF-ensures the brain; no manual preflight (converge 18f433d).** `copy-gate.py` loads its term-set through the single-source `verdict_core` engine and self-ensures the brain via `verdict_core.ensure_brain()` on first `gate()` (clones `/tmp/brain` under the caller's gh-auth, ~60-min TTL), fail-closing (hard-error, never a reduced-set/degraded pass) if the brain is unreachable. So no manual `/tmp/brain` clone or `$BANNED_TERMS_JSON` export is needed in ANY flow (playbook / standalone `meta-ad-copy-agent` skill / `meta-weekly-copy-scan` cron), and no separate candidate-tier tripwire is needed - `verdict_core` loads the FULL term-set including candidate-tier (`grown`/`product`/`calm`/`body`) and routes candidates to UNCLEAR for meta-compliance Tier-2. Just run `copy-gate.py`; confirm the output shows NO `DEGRADED` / authority-error. (Proven live 2026-07-16 by the 3-path production-auth seal: cleared env + `rm -rf /tmp/brain` → the gate self-cloned and returned CLEAN.)

1. **FORMAT:** every body has `\n\n` (zero single-newline-only); no `\n\n\n`; no headline has a newline; no dramatic ellipsis outside a quote.
2. **SECOND PERSON / TESTIMONIAL:** no third-person-character subject (He/She/His/Her about the ad's person) in any cell; no BARE first-person (I/I'm/I've/my/me) OUTSIDE quotes "…"/parens (…). (Brand we/our allowed.)
3. **HEADLINES:** each ≤40 chars, 6-10 words, no newline; ≥3 of 5 name the category; ≥2 crystal-clear (1 product + 1 promo); no "Sleep Gummies"; no diagnostic-question; no two share first 5 words.
4. **DE-CODE + BANNED:** zero of the de-code/banned set (grown [ALL forms - bare `grown`, `family-grown`, `*-grown`, `grown on/in/by` - M-19b, banned]/cultivat/strain/bud/flower-noun/lab/COA/third-party-tested/states/farm-direct/medical/M-5 negations/M-6a scam-fake/M-13 sleep-onset on gummies/M-20 superiority/"Clean Green" brand name). **`family-grown` is BANNED (M-19b) - the old "adam_accepted_risk / allowed" carve-out is RETIRED (Adam 2026-07-01 anything-about-grown intent; confirmed by mc + the 2026-07-16 copy false-pass incident). Use "family-owned".**
4a. **No comparative/superiority CONTRAST framings (M-20).** Do NOT sell by contrasting against an inferior alternative: "not weak", "not gas station stuff", "hits harder than X", "unlike the fakes", "better than the dispensary". A superiority / inferior-competitor comparison is M-20. Three traps to know: (a) POTENCY-superiority subclass - "not weak" / "hits harder" is the M-20 subclass cannabis copy is most prone to, and "hits harder" is DOUBLE-coded (M-20 comparative + an M-4 potency-EFFECT claim implying a strong physiological hit), so even a self-referential "hits hard" (no vs-X) still risks M-4; the safe substitute for potency is quality/craft language (premium, small-batch), NEVER potency language. (b) M-25 is TOKEN-based - a comparison tips into M-25 when it uses a scam/fake/counterfeit token ("unlike the fakes", "not a scam", "knock-offs"): M-25 fires on the TOKEN itself (scam/fake/counterfeit/rip-off/bogus/fraud/hoax) regardless of who it targets, so "unlike the fakes" hits M-25 on the word "fakes" alone. (c) "better than the dispensary" is double-bad - "dispensary" is ALSO an independent HARD M-2/M-19 ban, so that phrase fails on the term "dispensary" alone, not only the comparison; dropping "better than" does NOT rescue it. SUBSTITUTE: make quality claims SELF-REFERENTIAL and positive - "real, premium quality", "the real thing", "premium quality you can count on". Standalone "the real thing" / "real quality" is FINE (self-referential authenticity); it tips into M-20/M-25 ONLY when paired with an explicit vs-the-fakes / vs-gas-station / vs-competitor framing. (When using these substitutes, ROTATE per the M-3 over-use rule below - do NOT lean on "the real thing" as the only substitute; vary premium / small-batch / quality / gold-standard / the good stuff / carefully crafted. 4a says the phrase is COMPLIANCE-fine; M-3 says do not over-use it.) (Origin 2026-07-16: copywriters used the "not weak" + "gas station alternatives" contrast pair on 9 rows; the M-20 gate caught it and it was reframed positive.)
5. **EMOJI / DASH:** only ✅/⭐️/🎁; no 🌿🍃; no em dashes.
6. **AVATAR + FUNNEL:** each avatar is an exact member of the canonical list (§D) AND the drift-tripwire passed; each funnel ∈ {TOF,MOF,BOF}; neither overwrites a non-empty cell.
7. **SCHEMA / CLOSE:** exactly 5 headlines + 5 bodies; one close per body (never both); offer line present + last where applicable; ✅-stack minimums met; close matches the CTA button.

---

## PART 4 - REFERENCE (read ON DEMAND, not every run)
**Caveat: these files predate the M-19f de-code + the second-person rule - their examples/proof-banks still show banned vocab + third-person headlines. The PLAYBOOK rules above win; do not emulate a stale example. (Refresh tracked separately.)**
- `references/copy-framework.md` - 13 DR frameworks, deep slot theory, worked examples, first-125 research.
- `references/brand-voice.md` - full tone/rhythm, signature openers/closes, DO/DON'T pairs, per-product voice.
- `references/proof-banks.md` - substantiated Flower + DeepSleep proof points (verbatim only; numbers only when the asset shows them).
- `references/avatars.md` - per-avatar inference cues + ambiguity tie-breakers + blank-defaults.
- `references/swipe-file.md` - approved Clean Green headlines + primaries to pattern-match (the quality lever).
- `references/column-maps.md` - exact per-tab columns + the full header lists.
- `references/manual-copy-gen.md` - the separate manual-batch 3-style mode.
- `references/sarahs-finds-voice.md` - **read INSTEAD of §A/§B/§C above** (not in addition to) when the target spreadsheet is `Meta Ads Upload - Sarahs Finds` - dedicated first-person persona voice, age-calibrated to ~45yo, established 2026-07-23.
- `references/jennifer-stone-voice.md` - **read INSTEAD of §A/§B/§C above** when the target spreadsheet is `Meta Ads Upload - Jennifer Stone` - a DISTINCT first-person persona voice (not the same as Sarah's), age-calibrated to ~40yo, calmer/more put-together tone, established 2026-07-23.
