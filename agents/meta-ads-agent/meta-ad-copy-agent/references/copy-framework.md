---
name: copy-framework
description: The static-ads-dr direct-response framework for Clean Green. Defines the 5-stage conversion arc, the 5 headline hook types, the 5 body copy variation angles (no synonym swaps), the non-negotiable asset-to-copy alignment rule, CTA selection, and per-product proof banks for Flower vs Sleep Gummies. Load on every generation run alongside brand-voice, compliance, and avatars. Grounded in Clean Green's winning ad archive and canonical templates. Vocabulary rebuilt 2026-05 against the meta-compliance scan (M-3 / M-5 / M-6a / M-12 / M-13).
---

# Copy Framework - static-ads-dr

This skill is the structural blueprint. It tells you **what shape each
variation takes and what angle it leads with.** `brand-voice` gives
you the words; this skill gives you the scaffolding.

> **Compliance is single-sourced from the [meta-compliance-agent](../../../meta-compliance-agent/) (2026-06-08).** This file is generation *guidance* (structure, hooks, proof banks), **not** compliance rules. Its proof-bank phrases, openers, and worked examples were rebuilt to be compliant against the agent's M-codes (M-2 / M-3 / M-5 / M-6a / M-12 / M-13 / M-19 / M-24, …) so the agent **learns from clean source vocabulary** rather than fixing copy after the fact. Enforcement is the agent's scan as a hard pre-write gate - see [`compliance.md`](compliance.md). The retired in-pipeline `§9 cleanup` / `§10 mechanical substitution` passes **no longer exist**; wherever older text below references them, read it as: *this is banned (per the cited M-code) - draft the compliant form, and the agent scan is the gate.*

---

## 0. Four product-specific tabs, two workflows

The pipeline now watches **four** product-specific tabs. The tab
declares the product:

| Tab | Workflow | Product |
|-----|----------|---------|
| `IMAGES (Flower)` | Image | `flower` |
| `IMAGES (Sleep Gummies)` | Image | `gummies:deep-sleep` |
| `VIDEOS (Flower)` | Video | `flower` |
| `VIDEOS (Sleep Gummies)` | Video | `gummies:deep-sleep` |

**The image vs. video distinction is still the architectural divide
between source-of-truth pipelines** - image rows read the image,
video rows read the ClickUp brief. The product split is a separate
axis: it shifts the proof bank, voice notes, and per-product
compliance section, but the pipeline shape stays the same per
workflow.

### Image workflow (`IMAGES (Flower)` and `IMAGES (Sleep Gummies)`)

1. **Read the image directly** from the local Shared Drive mount
   (see SKILL.md for the glob). The image itself is the creative
   brief: it tells you the specific offer, on-asset proof, hook
   framing, and visible product spec.
2. **Set `product_category` from the tab name.** Flower tab →
   `flower`. Sleep Gummies tab → `gummies:deep-sleep`. Do NOT infer
   product from the image - the image is for offers, hooks, and
   sanity-checking the tab match.
3. **Run the tab-mismatch sanity check** (see SKILL.md). If the
   image visibly shows the wrong product for the tab, halt with
   `blocked-tab-mismatch` instead of generating.
4. **Write copy that matches the image's offer/proof.** Every
   headline and body variation references specific elements pulled
   from the image (offer text, proof points, on-asset numbers).
   Generic brand copy is a failure. Pull voice and proof from the
   per-product sections in §3.5 and §7.

**NEVER use ClickUp briefs for image ads.** ClickUp tasks for images
contain production metadata, not copy briefs.

### Video workflow (`VIDEOS (Flower)` and `VIDEOS (Sleep Gummies)`)

1. **Fetch the ClickUp task** using the Card ID column for the tab
   (column N on `VIDEOS (Flower)`, column K on `VIDEOS (Sleep
   Gummies)` as of v0.8.1) - one `CLICKUP_GET_TASK` call per unique
   Card ID; rows sharing a Card ID share copy. See SKILL.md Step 3.
2. **Extract the brief** from the task description - hook/body/CTA
   sections, script transcript, core claims, specific numbers.
3. **Set `product_category` from the tab name** (not from the
   brief). Flower tab → `flower`. Sleep Gummies tab →
   `gummies:deep-sleep`. The brief drives hook and copy angles, not
   product.
4. **Run the brief-side tab-mismatch check.** If the brief
   explicitly describes a contradicting product, halt with
   `blocked-tab-mismatch`.
5. **Write copy that mirrors the script.** Opening hook, core
   claims, and emotional arc drive the copy angles. Pull proof and
   voice from the per-product sections.

**For videos, the ClickUp brief IS the source of truth for the
hook, claims, and arc - but the product comes from the tab.**

### Why this matters

The 2026-04-27 IMG_177 incident - a poisoned cache silently flipped
flower copy to gummies copy on three rows - is structurally
impossible under the four-tab architecture. The flower tab contains
flower rows. The gummies tab contains gummies rows. The cache is
ancillary.

What still matters is **asset-to-copy alignment per row.** An image
ad showing "30% OFF SITEWIDE + FREE 420 STARTER PACK" must produce
copy about that specific sale, not generic flower copy. The product
is locked by the tab; the offer, proof, and hook still come from the
specific creative.

Every run produces, per row: 1 primary headline + 4 headline
variations, then 1 primary body + 4 body variations (10 copy cells).
The exact per-tab column letters are in the §4 headline table and §5
body table below - they differ per tab and shifted +1 on the flower
tabs in v0.8.1.

Those 10 lines per ad must be **meaningfully different** - different
psychological entry points, different proof orders, different closes
where appropriate. Synonym swaps and reshuffled word orders are failures.

---

## 1. Read the asset deeply (this is the job)

The single biggest failure mode of this plugin is writing copy that
doesn't actually engage with what the asset shows or says. Brand voice
without asset alignment is wallpaper. This section defines the
analysis discipline that produces the cache JSON - and that the copy
then has to answer to.

This is **not an optional pre-step.** Understanding the ad is a larger
part of doing this job well than writing the headlines. Budget your
effort accordingly: roughly 60% comprehension, 40% generation.

### 1-pre. `product_category` is set by the tab (sanity-check the asset)

`product_category` is no longer derived from the asset. It is set by
the tab the row lives in:

| Tab | `product_category` |
|-----|--------------------|
| `IMAGES (Flower)` | `flower` |
| `VIDEOS (Flower)` | `flower` |
| `IMAGES (Sleep Gummies)` | `gummies:deep-sleep` |
| `VIDEOS (Sleep Gummies)` | `gummies:deep-sleep` |

What the asset analysis still does is **sanity-check the tab match**.
A row should never produce copy until you've confirmed the asset
matches what the tab declares. Use the packaging signature reference
below as the visual yardstick:

| Packaging signature | Expected tab |
|---------------------|--------------|
| Sealed product packaging (Clean Green sun + forest illustration, soft rectangular foil bag) | `IMAGES (Flower)` / `VIDEOS (Flower)` |
| Pre-roll-style sticks, hand-roll-style sticks, multi-pack flower-product packaging | `IMAGES (Flower)` / `VIDEOS (Flower)` |
| Glass/plastic jar with screw cap + "DeepSleep" mountain/night label | `IMAGES (Sleep Gummies)` / `VIDEOS (Sleep Gummies)` |
| Visible gummy pieces or "15mg / 30 ct" / blackberry-colored gummies | `IMAGES (Sleep Gummies)` / `VIDEOS (Sleep Gummies)` |
| USPS / shipping box on a doorstep with sealed product packaging alongside | flower tabs |
| USPS / shipping box on a doorstep with DeepSleep jar alongside | sleep-gummies tabs |

> **Note on packaging vocabulary.** Internal-only descriptors above
> use words like "mylar pouch" because they're documenting visual
> signature for the agent's eyes. **Never write `mylar pouch` /
> `discreet packaging` / `smell-proof` into output copy** - those
> are M-3-banned. The output vocabulary for product packaging is
> `sealed product packaging`, `shipping box`, and similar from
> `compliance.md` §2.

**Rule: text overlays describe benefits or emotion; they do NOT
change the product.** A flower product-packaging shot with a
testimonial sticky note is still a flower ad and belongs in the
flower tab. A DeepSleep jar with a "wind-down after work" tagline is
still a gummies ad. The tab declares the product; the asset's text
overlays drive the copy's hook and angle.

**Tab-mismatch handling:** if the asset visibly shows a product that
contradicts the tab, halt with `blocked-tab-mismatch` (see SKILL.md
"Tab-mismatch check"). Don't silently generate the wrong product's
copy.

The cache (`Visual_Analysis_Cache`, `Transcript_Cache`) is no longer
the source of truth for product. It stores ancillary fields - offer,
proof signals, hook type, visual style - that speed up downstream
runs without driving product detection.

**Everything downstream depends on `product_category` being set
correctly from the tab.** Get the tab right (or block on mismatch);
the rest of the framework follows.

### 1a. Static image ads - what to extract

For every image, pull the following into `Visual_Analysis_Cache` (AH).
Do not paraphrase when the image contains text - transcribe verbatim.

1. **On-image text, verbatim.** Every word visible on the image, in
   reading order. Headline overlays, sub-overlays, price callouts,
   star counts, review quotes, disclaimers, UI elements, price tags,
   sticker burst copy, handwritten captions. Preserve punctuation,
   capitalization, and line breaks as best you can within a
   single-line JSON string. This becomes the `text_overlays` field.
2. **The hook beat.** What makes a thumb stop in the first 0.5
   seconds? Name it in one short phrase. This is `hook_type`.
3. **Visual format / treatment.** UGC selfie vs. studio shot vs.
   flat-lay vs. text-on-color vs. split-screen. This is
   `visual_style`.
4. **Product presentation.** Exactly how the product appears -
   *packaging form, placement, surrounding context*. "Sealed product
   packaging on kitchen counter next to coffee mug." "USPS box with
   label visible on wooden doorstep." "White branded box with Test
   Results card fanned beside it." No flower, bud, plant material, or
   open jars ever - if the image appears to violate that, flag it in
   `compliance_signals`.
5. **Proof / trust signals visible.** Family-grown callouts,
   star ratings, review counts,
   money-back guarantee seals, shipping icons. Write them in
   `compliance_signals` as short flags.
6. **Color palette.** 2–4 dominant colors, comma-joined.
7. **Who is in the frame and what are they doing.** Shapes the avatar
   read.

### 1b. Video ads - what to extract

Videos are a bigger job because you're reading two tracks at once.
Split the work into audio analysis and visual analysis, then
reconcile them.

**Audio / transcript (`Transcript_Cache`, AL):**

1. **Full verbatim transcript.** Every spoken word, in order, as a
   single-line JSON string with `\"` for internal quotes. Do not
   paraphrase. Do not clean up filler words.
2. **Opening hook, first 3 seconds verbatim.** Called out separately
   in your internal analysis.
3. **Emotional arc.** Map the transcript to a shape. Most common:
   `skeptic-to-believer`, `matter-of-fact review`, `excited reveal`,
   `before/after transformation`, `comparison call-out`, `straight
   testimonial`. This is `tone`.
4. **Core claims.** The 2–5 concrete claims the speaker makes.
5. **Selling points.** Benefits in the speaker's words, comma-joined.
6. **CTA in the video.** Explicit or implicit.

**Visual (`Visual_Analysis_Cache`, AL):**

Same fields as in 1a, plus opening frame, text overlays across time,
visual beat changes, on-screen proof.

**Reconciling audio and visual:**

If they tell different stories, the audio wins for tone and claims,
and the visual wins for hook type and product presentation.

### 1c. Quality bar for analysis

Before you consider the cache complete:

- Every word on the image is in `text_overlays`, verbatim.
- Every spoken word in the video is in `transcript`, verbatim.
- `hook_type` names something *specific* to this asset.
- `tone` is specific enough that two reviewers would agree.
- `compliance_signals` flags anything close to a violation.

If any fail, re-analyze before generating copy.

---

## 2. Non-negotiable: asset-to-copy alignment

**Copy is not generic brand copy applied to an asset. It is written
specifically for what is in that image or video - the hook, the
visual framing, the spoken words.**

Hard rules:

- If the transcript opens with a skeptic saying "I didn't believe
  it," the copy must mirror that skeptic-to-believer arc.
- If the image shows an unboxing or a package at the door, the copy
  must reference the arrival and reveal.
- If the transcript's core claim is an M-20 superiority claim (e.g.
  "hits harder than shop quality"), do NOT echo it - reframe to a
  compliant experiential line ("exactly what I hoped for") that still
  aligns to the asset, not a generic proof stack.
- If the `hook_type` is `before/after split`, at least one headline
  variation must use transformation as its lead angle.
- If `text_overlays` contain a phrase, that phrase (or a direct echo)
  appears in the copy unless compliance blocks it.

Asset and copy must feel like they were made together.

---

## 3. The core conversion arc

Every Clean Green ad maps to one of four stages in the conversion
journey. The avatar on the row (column M on `IMAGES (Flower)`, J on
`IMAGES (Sleep Gummies)`, Q on `VIDEOS (Flower)`, N on `VIDEOS (Sleep
Gummies)`) points you to a stage, and the stage shapes what you lead
with.

```
Skepticism  →  Trial  →  Transformation  →  Repeat
```

| Stage | Job of the copy | Default flower avatar (`FCA=`) | Default gummies avatar (`DSCA=`) |
|-------|-----------------|----------------|----------------|
| Skepticism | Name the doubt, answer with proof | `FCA=The Skeptic 1st Time Online Buyer` | `DSCA=Tried Everything` |
| Trial | Reduce risk, make the first order feel safe | `FCA=The Shop Switcher` | `DSCA=Racing Mind` |
| Transformation | Show the before/after, the "what changed" | `FCA=Daily Unwind` / `FCA=Pain Relief` / `FCA=Better Sleep` (benefit-led variants) | `DSCA=Better Mornings` |
| Repeat | Reorder, loyalty, new-product cues | `FCA=Subscribe and Save` | `DSCA=Wellness Stacker` |

The arc is the model; the avatar columns name the closest v0.8.0
dropdown value for each stage. A benefit-driven flower asset (pain
relief, sleep) maps to Transformation when the hook is the "what
changed" outcome; subscription / recurring-purchase creative maps to
Repeat regardless of product.

Every variation you write should consciously target one stage.

---

## 3.5 Per-product proof bank and asset-alignment examples

The 5-hook / 5-angle structure is shared across products. The
**proof points and example openers** that fill those slots split per
product. Pull from the relevant product block below based on which
tab the row is in.

> **Vocabulary contract.** Every phrase below was validated against
> the meta-compliance scan in 2026-05. Pull from these banks
> verbatim. If you find yourself reaching for `bud`, `flower`,
> `lab-tested`, `federally compliant`, `Farm Bill`, `no med card`,
> `discreet`, `End the 3am ceiling stare`, `Better mornings start
> the night before`, `wake up rested`, `sleep through the night`,
> `stay asleep`, `fall asleep faster`, `8 hours straight` - stop and
> use the substituted vocabulary in `compliance.md` §2 instead.

### 3.5a - Flower (`IMAGES (Flower)`, `VIDEOS (Flower)`)

**Proof bank (use these phrases verbatim when the asset supports them):**

- `Family-grown`
- `Work directly with our growers`
- `Fast, reliable shipping`
- `Ships fast and tracked`
- `100% money-back guarantee` / `100% Delivery Guarantee`
- `100-Day Money-Back Guarantee`
- `Real quality, delivered fast`
- `Premium quality`
- `28,000+ customers`

**Signature openers to draw from (compliant-vocabulary versions):**

- `Most people see these ads and think: "Yeah right, ordering quality online is probably a disappointment."`
- `"I'll be honest… I thought you couldn't get real quality online."`
- `Why pay more for less?`
- `You won't want to go back to your local shop after trying this.`
- `From "Probably A Disappointment" To "Completely Wrong"`
- `Three months of orders. Zero shop runs.`
- `Real quality, ordered online, at my door`

**Asset-alignment hooks (mirror these from the asset/brief):**

- If the asset shows a USPS box on a doorstep → reference the
  arrival, the fast, reliable shipping, the tracked delivery.
- If the asset shows sealed product packaging with a sticky-note
  testimonial → quote the testimonial in customer voice (Var 3,
  Review-Style carve-out).
- If the brief opens with "I thought it would be a disappointment" →
  use the skeptic-to-believer arc (Primary).
- If the brief explicitly invokes the family-grown positioning
  → make `Family-grown` the headline of the Proof variation.

### 3.5b - Sleep Gummies / DeepSleep (`IMAGES (Sleep Gummies)`, `VIDEOS (Sleep Gummies)`)

**Proof bank (use these phrases verbatim when the asset supports them):**

- `15mg blackberry` / `15mg per gummy` (echo whatever the asset shows)
- `30 per jar` (echo whatever count the asset shows)
- `4.9 stars` / `4.9 stars from N+ switchers` (only when the asset shows the count)
- `28,000+ switchers` (only when the asset shows the count)
- `100% money-back guarantee`
- `The wind-down ritual`
- `Made for nightly wind-down` (replaces `Better mornings start the night before`)
- `Your nightly wind-down ritual` (replaces `the secret to sleeping through the night`)
- `Your evening reset` (replaces `End the 3am ceiling stare`)
- `Made for your nightly wind-down` (replaces `sleeping deeper`)
- `For deeper, more consistent rest` (replaces `sleep through the night`)
- `A calmer evening wind-down`
- `A wind-down within the hour`
- `Ships to all 50 states` (gummies-only; flower copy omits any ship-to-states line)

**FORMULA ACCURACY - ingredient counts must match the BRAIN product
page (Adam correction 2026-06-11):** the canonical DeepSleep formula
(products/gummies/deepsleep-gummies.md) is SIX ingredients: 15mg
Delta-9 THC + 5mg CBN + ashwagandha + L-theanine + magnesium +
vitamin B2. Two of the six cannot be NAMED in Meta ads (M-2), so:
- A COUNT claim is allowed ONLY as the verified true count from the
  brain product page ("six ingredients" / "6 natural ingredients" =
  TRUE and on-positioning). Never count the nameable subset ("four
  ingredients" is FALSE) and never invent a number.
- Ingredient LISTS in ads are always NON-EXHAUSTIVE in framing:
  "built around X, Y, Z", "with X, Y, Z in the mix" - never "the
  whole formula" / "that's all that's in it" next to a partial list.
- Re-verify the count against the brain page per run; formulas change.
(Production drift caught + corrected 2026-06-11: live rows claimed
3, 4, and 5 ingredients across 85 cells - all corrected to six;
the 89 existing "six" claims were verified true.)

**Signature openers to draw from:**

- `"I'll try it once" is what most say before their first DeepSleep order.`
- `"This one earned its spot." That review keeps coming up jar after jar.`
- `Your evening reset.`
- `Wind down. Settle in. Made for the wind-down.`
- `Made for nightly wind-down.`
- `One gummy, made for the nightly wind-down`

**Asset-alignment hooks (mirror these from the asset/brief):**

- If the asset shows the DeepSleep jar on a nightstand → reference
  the wind-down ritual, the bedtime cue, the morning-after.
- If the asset shows a starry / mountain / night-time visual style →
  lean into evening rhythm in the opener (slowing down, ending the
  day).
- If the brief features a customer who tried melatonin first → start
  with the melatonin-failure customer voice in Var 3 (Review Style),
  not in primary brand voice.
- If the asset shows specific dose callouts (`15mg blackberry. 30
  per jar.`) → echo verbatim in the proof stack.
- If the brief uses a `Tired Of [X]?` headline pattern → the M-12
  rotator replaces the whole headline; use the asset's actual claim
  inside the body instead.

### 3.5c - Cross-product rules (apply to both products)

These rules apply regardless of product:

1. **Asset alignment is non-negotiable.** Pull specific elements
   (offer text, on-asset numbers, customer-voice phrases, visual
   beats) into the copy. Generic per-product copy is a failure even
   when the proof bank is right.
2. **Per-product compliance applies.** Run flower-specific rules
   (`compliance.md` §7) on flower rows, sleep-gummies rules
   (`compliance.md` §8) on gummies rows. Never apply the wrong
   product's compliance.
3. **Don't mix proof banks.** Flower copy should not say `wind-down
   ritual` or `your evening reset`. Sleep-gummies copy should not
   say `real quality, delivered fast`. Each product's voice and
   proof stay in its lane.
4. **Time/duration claims for sleep gummies live only in Review
   Style.** Specific sleep durations and onset times (e.g. "Slept 7
   hours straight," "Asleep in 15 minutes") live only inside the
   Review Style carve-out (`"..."` quote followed by `⭐️⭐️⭐️⭐️⭐️`,
   see `compliance.md` §8a). Primary brand voice uses wind-down
   vocabulary with no time specifics.
5. **Run the meta-compliance-agent scan before writing.** See
   [`compliance.md`](compliance.md). Even if you draft from this
   file's vocabulary, the asset's text overlay or the ClickUp brief
   may pull banned phrasings into the draft. The agent scan catches
   them - FAIL means fix per its suggested substitutions and re-scan.

---

## 4. Headline structure

**One headline per hook type. Five hook types total.** Each variation
leads with a different angle. No synonym swaps.

Per-tab column mapping (v0.8.1 - flower tabs shifted +1 vs v0.7.6; gummies unchanged):

| Slot | `IMAGES (Flower)` | `IMAGES (Sleep Gummies)` | `VIDEOS (Flower)` | `VIDEOS (Sleep Gummies)` | Hook type | Job |
|------|---|---|---|---|---|---|
| Primary | W | T | AA | X | Balanced - the strongest all-around headline | The one most likely to win on its own |
| Var 1 | X | U | AB | Y | Curiosity | Open a loop the reader has to click to close |
| Var 2 | Y | V | AC | Z | Proof | Lead with the hardest credibility signal from the asset |
| Var 3 | Z | W | AD | AA | Pain | Name the problem the asset/avatar solves |
| Var 4 | AA | X | AE | AB | Transformation | Before/after, old-me/new-me framing |

If the row has **no promo** (no TRY20, no free gift), replace the
"Direct offer" primary with the highest-confidence balanced line and
promote the curiosity or proof hook into the primary slot instead.

**Headline length rule:** 6–10 words. Fragments allowed. Title Case
**or** sentence case - match what the asset's text overlays use.
Never end a headline with a period unless it's a two-sentence headline.

**Diagnostic-question headlines forbidden.** Headlines that start with
`Tired Of`, `Sick Of`, `Done With`, `Done Wasting`, `Fed Up With`,
or `Can't sleep?` are M-12-banned. The mechanical substitution pass
in `compliance.md` §10 replaces them via the per-product rotator.
Don't draft them in the first place - pick a different hook angle.

### 4.0b Offer-CTA rules (Adam 2026-06-22 - enforced by `copy-gate.py`)

Two hard, deterministic rules - they apply to **offer ads** (`SHOP_NOW` and every non-LEARN_MORE CTA). The gate (`HEAD_CTA_RE` / `BODY_CTA_RE`) blocks any such row that misses either; don't make Adam catch them.

> **LEARN_MORE / advertorial exception (Adam 2026-06-22, option 2).** A row whose CTA button is `LEARN_MORE` is **exempt from both rules** - advertorial/click-to-learn-more copy uses a curiosity/soft close (`Still skeptical? Test it yourself.`) and curiosity headlines on purpose; the offer lives on the landing page, so forcing offer-CTAs into the ad body/headlines would defeat the funnel (see §C close-matching). The gate reads the row's `cta` (from the sheet **CTA** column, passed as `card["cta"]` / `rows[].cta` at gen time) and **skips both checks only when `cta == LEARN_MORE`**. **FAIL-SAFE: the default is ENFORCE** - a missing / unknown / `SHOP_NOW` / any-other `cta` gets BOTH checks (never let a no-offer close slip through an absent field).

1. **≥2 of the 5 headlines must be DIRECT offer-CTA headlines** - a super-clear call to action, e.g. `Get 20% Off Today`, `Limited Time Offer`, `Subscribe & Save 20% Today`, `20% Off Your First Order`. When the asset carries an offer, put these in the **Var 3 / Var 4** slots and keep Primary / Var 1 / Var 2 as the angled hooks (so the card is ~3 hook-typed + 2 direct-CTA, not 5 pure hooks). Recognized CTA tokens: `TRY20`, a `% off` / `save %` phrase, `Limited Time`, `Subscribe & Save`, or a **free-gift** offer (`🎁` / `free gift` / `free <item> with your/every …`).

2. **Every body (Primary + all 4 variants) must CLOSE on a recognized offer CTA** - the last paragraph carries the offer: the canonical `Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)` line for standard cards, or `Subscribe & Save 20% on every order.` for subscribe-offer cards, or the asset's own `% off` / **free-gift** offer. NEVER close a body on a soft line (`Still skeptical? Test it yourself.`, `Start shopping today.`) with no offer - that drops the CTA. A soft line may appear earlier in the body, but the CLOSE must be the offer.

(Origin: the 2026-06-22 batch had ~1/3 of bodies close soft + cards with 0 CTA headlines; Adam flagged both. These checks make it a pre-write gate.)

### 4.1 The CLARITY GATE (Adam directive 2026-06-11 - every headline, every run)

Hook type tells you the ANGLE; this gate decides whether the headline
is allowed to exist at all. A Facebook headline has one job before any
cleverness: a cold reader who sees NOTHING but the headline must
instantly know (a) WHAT the product is and (b) WHY they should care -
one concrete benefit or differentiator. Compliance pressure is not an
excuse for content-free headlines: a compliant headline nobody
understands converts at zero.

**The cold-reader test (apply to each of the 5 before writing it to
the sheet):** cover the creative and the body. Reading the headline
alone, can a stranger say what is being sold? If the headline could
sit unchanged on any other brand's ad ("The Nightly Routine, Kept
Simple"), it FAILS - rewrite with the product in it.

**Category-naming floor: at least 3 of the 5 headlines must name the
product category explicitly.** Compliant category nouns differ by
product:
- Gummies: `wind-down gummy/gummies`, `DeepSleep Gummies` (the
  PRODUCT name is allowed - only the brand name "Clean Green" is
  M-24-banned), `melatonin-free gummies`.
- Flower: the category word itself is M-2-banned, so flower headlines
  name the category through the compliant frame: `real product`,
  `the real thing` + delivery/quality context. This
  asymmetry is permanent - gummies self-name, flower circumlocutes.

**Banned headline shapes (clarity failures caught in production -
the row-103 class, 2026-06-11):**
- Bare ingredient lists ("Ashwagandha, L-Theanine, Magnesium, B2") -
  ingredients are body-copy SUPPORT, never a whole headline.
- Bare dosage/mechanics as the lead ("One Gummy, 30 Minutes Before
  Bed") - mechanics belong after the reader knows what and why.
- Offer-only with no product ("20% Off Your First Order With TRY20")
  - say what the 20% is off OF: "Try The Wind-Down Gummy: 20% Off".
- Anybrand vagueness ("The Nightly Routine, Kept Simple") - fails the
  cold-reader test by definition.

**Attention rules (after clarity is satisfied):**
- Front-load: category or benefit inside the FIRST FIVE WORDS - feed
  truncation eats the tail on mobile. Researched targets (2026): keep
  headlines UNDER 40 characters (mobile cutoff); Facebook Feed shows
  ~27 before truncating, so the sweet spot is 25-35 with the payload
  in the first ~27. Industry CTR data: clear+direct beats clever+vague
  consistently, and a concrete NUMBER in the headline lifts CTR in a
  majority of tests - in our compliance world that means PRODUCT-spec
  numbers (15mg, 30 gummies, 20% off, 100-day) since social-proof
  counts are M-16a-banned.
- Concrete beats clever: a specific noun, number (product spec only -
  M-16a bans social-proof counts), or named audience out-pulls
  wordplay.
- Avatar-naming converts: one of the 5 should speak to the row's
  avatar directly (e.g. Tried Everything → "The Wind-Down Gummy For
  People Who've Tried Everything").
- Gummies Transformation slot (Var 4) is M-13-constrained: routine or
  logistics transformation ONLY ("One jar became three"), never a
  mental/physiological before-after.

**Row-103 before/after (canonical example, VIDEOS (Sleep Gummies)):**
- BEFORE: "One Gummy, 30 Minutes Before Bed" / "Ashwagandha,
  L-Theanine, Magnesium, B2" / "The Nightly Routine, Kept Simple" -
  compliant, and a cold reader cannot tell what is for sale.
- AFTER: "The Melatonin-Free Wind-Down Gummy" / "DeepSleep Gummies:
  One Before Bed. That's It." / "The Wind-Down Gummy For People
  Who've Tried Everything" - same compliance posture, category and
  benefit visible at a glance.

### 4.2 Ad Description (the `Ad Description` column - shows under the headline in feed)

The description renders in smaller type directly below the headline.
Rules:
1. **Complement, never duplicate.** It must add the ONE thing the
   headline didn't say - usually the trust element (guarantee,
   shipping) or the category if the headline led with benefit.
2. **Shape:** `[category or benefit fragment] + [one trust element]`.
   Meta's recommendation is ~25 characters; in practice keep the
   payload in the first 25-30 and the whole line under ~60. Example:
   "Melatonin-free wind-down gummies. 100-day guarantee." Flower:
   "Real quality, delivered. 100-day guarantee."
2b. **Low-visibility reality (researched 2026-06):** the description
   reliably renders ONLY on Marketplace, Audience Network, Search
   Results, and In-Stream Video - it is absent from Stories, Reels,
   Explore, and most feed renders. Consequence: NEVER let the
   description be the sole carrier of the offer, the CTA, or any
   compliance-required qualifier - everything essential lives in the
   headline/primary; the description is pure bonus reinforcement for
   the placements that show it."
3. **Same compliance surface as headlines** - full M-code set applies
   (the legacy "Better than shop quality" description is the cautionary
   M-20 example; many pre-2026-06 rows still carry it - rewrite on
   touch, never propagate).
4. Write/refresh it whenever you write the copy block - a row with new
   headlines and a stale description ships a non-compliant or
   off-message line into the live ad.

### 4.3 Platform research notes (web research 2026-06, Adam-requested)

Findings that ground 4.1/4.2, kept here so the numbers have provenance:
- **Headline length:** <=40 chars avoids mobile cutoff; FB Feed
  truncates ~27; ideal band 25-35. (cropink.com/facebook-ad-headline;
  adsuploader.com/blog/meta-ad-copy-specs)
- **Clarity beats cleverness:** "simple, clear, direct headlines
  usually outperform clever or vague ones" - independent confirmation
  of the 4.1 gate. (cropink)
- **Numbers lift CTR:** adding a concrete number improved CTR in ~70%
  of tested cases; specificity beats abstraction ("Save $847" >
  "Save Money"). Compliance overlay: product-spec + offer numbers only,
  never social-proof counts (M-16a). (lineardesign.com CTR guide)
- **Primary-text fold:** only ~125 chars show on mobile before "See
  More" and ~99% never expand - the body's ANGLE + category must land
  inside the first 125 chars (our §5 lead-line rule already does this;
  treat it as a hard ceiling, not style advice). (adsuploader)
- **Description visibility:** renders only on Marketplace, Audience
  Network, Search Results, In-Stream Video; ~25-char recommendation.
  (Meta Business Help Center via adsuploader; ridgemarketing.com)
- **Proven angle structures** the 5-slot system already maps to:
  benefit-driven > feature-driven; problem-agitate-solve for pain
  slots; discount-as-headline (not footnote) for offer ads; urgency
  works but fake-urgency mechanics are M-11/M-16-banned here.
  (digitalthriveai, trystirling, superads roundups)

---

## 5. Body copy structure

**Five body variations, each leading with a different psychological
angle.** Same no-synonym-swap rule. Variations differ in the *first
two lines* - that's where the angle lives - then converge on proof
and close.

**STRUCTURAL variety is mandatory, not just angle variety (Adam
directive 2026-06-11):** five different opening angles poured into the
same skeleton (hook line, product sentence, checkmark stack, offer
close) read as five versions of one ad. The set must vary SHAPE:
- At least one SHORT body: 2-3 lines, NO checkmark stack, offer close.
- At least one LONG-FORM body: 3-4 short paragraphs, NO stack - the
  story/advertorial shape (the AdEspresso winning band; see 5.0).
- At least one TESTIMONIAL-led body: opens with a REAL quote from the
  per-product proof bank (§3.5) verbatim - NEVER an invented quote
  (M-6); if the bank has no usable quote for the product, use
  paraphrased customer-pattern voice without quotation marks.
- Stack placement varies across the rest: stack-led (bullets first,
  prose after) is a legitimate shape alongside stack-middle.
- Length spread check before writing: shortest and longest body should
  differ by roughly 2x or more.

Per-tab column mapping (v0.8.1 - flower tabs shifted +1 vs v0.7.6; gummies unchanged):

| Slot | `IMAGES (Flower)` | `IMAGES (Sleep Gummies)` | `VIDEOS (Flower)` | `VIDEOS (Sleep Gummies)` | Angle | Lead move |
|------|---|---|---|---|---|---|
| Primary | AB | Y | AF | AC | Balanced / skeptic-to-believer | The signature Clean Green arc (Template #1 shape) |
| Var 1 | AC | Z | AG | AD | Proof-led | Open with the hardest proof from the per-product proof bank (§3.5) |
| Var 2 | AD | AA | AH | AE | Pain-led | Open by naming the specific frustration (flower: bad shop trip / overpriced / weak gas-station quality; gummies: the long day / unpredictable bedtime) |
| Var 3 | AE | AB | AI | AF | Social proof / customer voice | Open with a customer quote or review excerpt (Template #2 shape, Review Style - `"..."` + `⭐️⭐️⭐️⭐️⭐️`) |
| Var 4 | AF | AC | AJ | AG | Offer / urgency | Open with the offer or a scarcity cue; tight 3–5 line body (Template #3 shape) |

### 5.0 The FIRST-125 HOOK GATE (research-grounded, 2026-06)

Mobile shows ~125 characters of primary text before "See More," and
~99% of viewers never expand. The first sentence is therefore most of
the ad. Hard rules for it:
1. **First sentence under ~100 characters**, hook complete within the
   125-char fold: angle + what-this-is must both land before the cut.
2. **Reader-side before product-side.** Open with the reader's
   situation, desire, or problem - never with the product name or "we."
   ("Talking about your product before the reader's problem is
   backwards.") The product enters in sentence two.
3. **Specific beats generic.** "Improve your evenings" is not a hook;
   a precise, concrete, slightly unexpected statement is. Use real
   product/offer numbers (M-16a bars social-proof counts).
4. **Open loops work.** A curiosity gap the body then closes
   (Zeigarnik) is a legitimate hook shape - as long as the loop's
   subject is clear (the clarity gate applies to hooks too).
5. **Compliant problem-callout shapes ONLY:** our problem hooks are
   M-12/M-13-constrained - no diagnostic questions, no second-person
   condition assertions, no neg-to-pos physiological arcs. Channel
   problem energy into: third-person/neutral framing ("Some evenings
   need a better routine"), product-side contrast ("Most gummies lean
   on melatonin. These don't."), or the approved skeptic frame ("I had
   my doubts"). The skeptic-flip hook (open with the doubt, answer it)
   maps directly onto our Skeptic avatars and is fully compliant.

**Length evidence (AdEspresso $1,000 controlled test + aggregate
studies):** mid-length copy - one to three SHORT paragraphs - beat
both extremes; single-sentence and bullets-plus-emoji versions cost
~2.4x more per lead, and six-paragraph essays also lost. 89% of
surveyed marketers predicted short would win; it did not. For a
considered purchase like ours, substance after the hook earns the
conversion - our 5-body shape (hook line, support, ✅ stack, trust
close, offer) sits exactly in the winning band. Do not shrink bodies
to one-liners chasing "short converts better" - the data says
otherwise for products that need explaining. (adespresso.com copy-
length experiment; anyword.com length studies; trystirling +
metalla hook guides)

### Body shape rules

1. **Opening line = angle.** The first line must make the angle
   obvious. Don't bury it under a generic hook. The 5.0 hook gate
   applies on top: first sentence <100 chars, reader-side, specific.
2. **Middle = proof from the asset.** Pull specifics from the cache -
   not the generic proof stack. If the transcript mentions "third
   order this month," use it. If the visual shows a USPS box,
   reference the package arriving.
3. **Close = one of two moves, never both:**
   - **Skeptic challenge close:** `Still skeptical? Test it yourself.`
   - **Direct offer close:** `Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)`
4. **Body length dial:** Primary + Var 1 + Var 2 = long (8–14 lines
   with the proof stack). Var 3 = medium (5–8 lines, testimonial-led).
   Var 4 = short (3–5 lines, offer-led).

### No-synonym-swap rule (enforced)

Two variations fail the diff test if:
- The first 5 words are identical or near-identical.
- They share the same lead angle.
- The proof points appear in the same order.

When in doubt: rewrite. Better one sharp variation and one weaker
distinct variation than two polished near-duplicates.

---

## 5.5 Visual formatting contract (NON-NEGOTIABLE)

Angle differentiation is not enough. Every variation also has a
**required visual format** that signals "Clean Green" at a glance.
A variation that hits the right angle but ships as dense prose with
no emoji, no stars, no checkmarks, no blank lines is **a failure** -
it reads as generic DTC copy and loses the brand.

The rules below are hard requirements per slot. Every row ships with
all of these, every time.

### Global format rules (apply to every body variation)

- **Blank line between EVERY paragraph (Adam directive, 2026-06-11,
  sharpened from section-level).** Each sentence / idea block is its
  own paragraph separated by a BLANK line (`\n\n`). Never ship a body
  whose lines are separated only by single newlines - on the sheet and
  in preview it renders as one dense block (the failure that triggered
  this rule). The ONLY single-newline grouping allowed is a ✅
  checklist block (consecutive `✅ ...` lines stay compact), and the
  block itself gets a blank line above and below.
- **One idea per line.** Sentences break on natural beats, not at the
  period of every clause.
- **Deterministic enforcement.** The meta-ads copy gate flags any body
  containing `\n` but zero `\n\n` (FORMAT paragraph-spacing) and any
  headline containing a newline - malformed copy cannot ship.
- **No em dashes.** Use periods or colons.
- **Emoji discipline - use these, never others:**
  - ✅ - proof stacks only, one per line, stacked vertically
  - (🌿 removed - HARD-BANNED on Meta ad copy + creative per M-19e 2026-06-07)
  - ⭐️ - review style, always as ⭐️⭐️⭐️⭐️⭐️ (5 in a row)
  - 🎁 - free-gift offers only

### Per-slot formatting requirements - BODY (IMAGES V–Z, VIDEOS Z–AD)

**Shape system (supersedes the old rigid per-slot signatures,
2026-06-11):** the five bodies carry five ANGLES (slot table in §5)
poured into five different SHAPES per the structural-variety mandate:

| Shape | Signature | Required elements |
|-------|-----------|-------------------|
| **Classic mid** | 5-9 lines: reader-side hook, product sentence, ✅ stack, close | First sentence <100 chars (5.0 gate). At least **3 ✅ lines**, each a distinct proof point, blank line above and below the stack. Close line stands alone. |
| **Short** | 2-3 lines, NO stack | Hook + product line + offer close. Every line separated by a blank line. |
| **Long-form story** | 3-4 SHORT paragraphs, NO stack (the AdEspresso winning band) | Reader-side scene first, product enters paragraph 2, philosophy/simplicity paragraph, close folds the offer into prose. Blank line between every paragraph. |
| **Testimonial-led** | Real quote opener + support + optional short stack | Quote comes VERBATIM from the §3.5 proof bank - NEVER invented (M-6). `⭐️⭐️⭐️⭐️⭐️` only when the asset shows a real review. **There is NO M-13/M-4 carve-out for review quotes: real verbatim reviews containing symptom-resolution language ("racing thoughts," "handled my anxiety," sleep-onset/duration claims) FAIL M-13 + M-4 exactly like body copy. Screen every quote before use; drop or switch to a non-quote angle if any are present.** CTA sits outside the quotes. |
| **Stack-led / tight offer** | ✅ stack FIRST (3-4 lines) then one closing prose line, OR 3-5 line offer shape | Stack lines each distinct; blank line between stack and close. TRY20 close per the offer rules. |

**Assignment is flexible and must ROTATE:** distribute the five shapes
across the five slots, but do not fossilize the same shape into the
same slot on every row - the structural-variety mandate exists so the
ad SET reads as five different ads, row after row. Each set: length
spread of roughly 2x or more between shortest and longest.

### Per-slot formatting requirements - HEADLINES (5 per row)

Headlines are short (6–10 words) so visual formatting is lighter, but
**🌿 is BANNED on headlines (M-19e 2026-06-07).** Do not add 🌿 to any headline. Headlines carry no emoji unless the asset has a review/star rating (see Stars note below).

Stars (⭐️⭐️⭐️⭐️⭐️) may appear in the Proof headline when the asset
shows a star rating or review count - otherwise keep stars to the
body Var 3 slot.

### Format failure examples (rewrite, don't ship)

> **All examples below use 2026-05 compliant vocabulary.** Pre-rewrite
> versions of these examples used `bud`, `lab-tested`, `End the 3am
> ceiling stare`, `Asleep faster`, `Through the night`, etc. - every
> one M-3-/M-12-/M-13-banned. Don't revert.

**WRONG - Var 3 without review formatting:**
```
Melatonin quit on me at 2AM every single night.
DeepSleep stays. Slept 7 hours straight the first night.
4.9 stars. 28,000+ switchers.
Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)
```

**RIGHT - Var 3 with review formatting (carve-out applies):**
```
"Melatonin quit on me at 2AM every single night." ⭐️⭐️⭐️⭐️⭐️

"DeepSleep stays. Slept 7 hours straight the first night. Haven't gone back."

4.9 stars. 28,000+ switchers.

Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)
```

(The duration phrase "Slept 7 hours straight" is allowed because it
sits inside `"..."` followed by `⭐️⭐️⭐️⭐️⭐️` - the Review-Style
carve-out documented in `compliance.md` §8a / §10. In primary brand
voice, the same phrase would substitute to `a steady night`.)

**WRONG - Primary body without checkmark stack, dense prose:**
```
Clean Green DeepSleep jar on my nightstand for 21 straight nights.
First week, made for the wind-down once around 3am, settled in minutes.
Second week, made for the nightly wind-down to 6:40am every day.
Third week, evenings settling into a steady rhythm before my alarm.
Blackberry, 15mg, 30 per jar.
```

**RIGHT - Primary body with proof stack (compliant vocab):**
```
"I'll try it once" is what most say before their first DeepSleep order.

Then they realize:

✅ Week 1: A wind-down within the hour, settled in minutes
✅ Week 2: Made for the nightly wind-down, 6:40am wake-up
✅ Week 3: Evenings settling into a steady rhythm before the alarm

15mg blackberry. 30 per jar. Family-grown.

Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)
```

**WRONG - Var 4 short-form (dense, no spacing):**
```
Your nightly reset starts here.
20% off with code TRY20.
```

**RIGHT - Var 4 short-form (spaced, no banned emoji):**
```
Your evening reset.

Still skeptical? Test it yourself.

Get 20% OFF using code 'TRY20' at checkout (Limited Time Only)
```

If any variation you draft doesn't match the format signature above,
rewrite before writing to the sheet. Format is not decoration - it's
the brand.

---

## 6. CTA rules (per-tab CTA column - read-only, not the copy field)

The CTA column letter shifted again with the v0.8.1 flower +1 insertion. Per-tab locations: AK on `IMAGES (Flower)`, AH on `IMAGES (Sleep Gummies)`, AO on `VIDEOS (Flower)`, AL on `VIDEOS (Sleep Gummies)`.

The sheet's CTA column is a Meta button value (e.g. `SHOP_NOW`). This
skill doesn't write that - it's set on the row already. But the
copy's close must *match the urgency* of the CTA:

- `SHOP_NOW` → pair with the direct offer close (TRY20 or free gift). **Offer-CTA close required (§4.0b gate-enforced).**
- `LEARN_MORE` → pair with the skeptic challenge close or a softer
  proof close. No TRY20 in the body. **This is the ONLY CTA exempt from
  the §4.0b offer-CTA rules** (advertorial soft close + curiosity headlines).
- Any other button → treat as an offer ad: **offer-CTA close required
  (§4.0b gate-enforced - only `LEARN_MORE` is exempt; fail-safe toward
  enforcing).**

---

## 7. Worked examples

These examples show what "5 meaningfully different variations" looks
like. They are illustrative - use them as the yardstick for diff
quality, not as templates to copy verbatim. Real output must be
written to the specific asset on the row.

> **Vocabulary note.** Every line in §7 was rewritten in 2026-05
> against the meta-compliance scan. Pre-rewrite versions used
> `bud`, `flower`, `lab-tested`, `2018 Farm Bill`, `no med card`,
> `garbage`, `Tired Of [X]?`, etc. - every one banned. The agent
> should learn the compliant patterns from these examples, not
> revert to the older ones.

> **Second-person rule (Adam 2026-06-20).** Headlines speak TO the reader ("you"/"your"), never about a third-person character (he/she/they/"regulars") and never bare first-person ("the old me") outside a testimonial quote. The headlines below were updated to second person; some body openers still illustrate testimonial first-person inside quotes, which is allowed.

### Example 1 - Image ad (Flower, `FCA=The Skeptic 1st Time Online Buyer`)

**Asset description (from cache):** UGC selfie of a guy on a couch
holding sealed Clean Green product packaging. Text overlay: "First
try that night." `hook_type`: skeptic testimonial.
`compliance_signals`: sealed product packaging visible, money-back
badge.

**Headlines (5 angles):**
- **Q (Balanced):** Real Quality Delivered Fast. Skeptics Welcome
- **R (Curiosity):** What Happens The First Time You Try It
- **S (Proof):** Family-Grown. Real Quality, Delivered Fast.
- **T (Pain):** Wasted Years Paying Shop Prices For Less.
- **U (Transformation):** From "Probably A Disappointment" To "Completely Wrong"

(Pain-headline note: the draft "Done Paying More For Less?" trips
the M-12 diagnostic-question rotator. The mechanical substitution
pass replaces it with one of the flower rotator options. Better:
draft a non-question pain headline directly, e.g. "Wasted Years
Paying Shop Prices For Less.")

**Body copy (5 angles, abbreviated):**
- **V (Balanced / skeptic-to-believer):** Opens `Most people see
  these ads and think: "Yeah right, ordering quality online is
  probably a disappointment."` → proof stack pulled from this asset
  (fast, reliable shipping; sealed product packaging; family-grown)
  → "skeptics into believers" close → TRY20.
- **W (Proof-led):** Opens `Family-grown. Real quality, delivered.`
  → then the skeptic reversal → skeptic challenge close.
- **X (Pain-led):** Opens `Wasted years paying shop prices for less.`
  → contrast pair → TRY20 close.
- **Y (Social proof / customer voice):** Review Style. Opens
  `"I'll be honest… I thought you couldn't get real quality online."`
  → ⭐️⭐️⭐️⭐️⭐️ → TRY20 close.
- **Z (Offer / urgency):** 4 lines. `Get Real Quality, Delivered
  Fast. / Still skeptical? Test it yourself. / Get 20% OFF using
  code 'TRY20' at checkout (Limited Time Only)`.

### Example 2 - Image ad (Flower, `FCA=The Shop Switcher`)

**Asset description (from cache):** Flat-lay of a USPS shipping box
on a doorstep next to sealed product packaging. `hook_type`:
delivery reveal. `text_overlays`: "Why pay more for less?"
`compliance_signals`: no visible flower, family-grown
callout.

**Headlines:**
- **Q (Balanced):** Premium Quality, Delivered.
- **R (Curiosity):** The Reason You'd Switch From The Shop
- **S (Proof):** Family-Grown. Work Directly With Our Growers.
- **T (Pain):** Shop Prices Up. Skip The Trip.
- **U (Transformation):** Your Old Shop Run Vs. Your New One

**Body (angles only):**
- **V:** Reframe opener (`Why pay more for less?`) → fast,
  reliable shipping + family-grown + price proof → skeptic
  challenge close.
- **W:** Proof-led with family-grown + work
  directly with our growers → short contrast pair → TRY20.
- **X:** Pain-led on the shop trip (traffic, markup, the drive) →
  "package arrives fast" reveal → TRY20.
- **Y:** Customer voice in `"..."` + ⭐️⭐️⭐️⭐️⭐️ - review from a
  shop switcher → TRY20.
- **Z:** 3-line offer-led variant.

### Example 3 - Image ad (Flower, `FCA=Daily Unwind` - formerly "Wellness Seeker")

**Asset description (from cache):** Clean studio shot of a sealed
white branded box with family-grown provenance copy. `hook_type`:
proof-first. `compliance_signals`: no visible flower, family-grown
language.

**Headlines:**
- **Q (Balanced):** Family-Grown. Real Quality, Every Time.
- **R (Curiosity):** What Family-Grown Actually Means
- **S (Proof):** Family-Grown. Real Quality, Delivered Fast.
- **T (Pain):** Brands That Won't Show Where It Comes From.
- **U (Transformation):** From Mystery Brands To Real Quality

**Body (angles only):**
- **V:** Balanced, softer opening (no heavy skeptic quote - Avatar
  03 reads as wellness-aware). Lead with family-grown + real quality
  → skeptic challenge close.
- **W:** Proof-led with family-grown specifics → TRY20.
- **X:** Pain-led on mystery brands → family-grown
  + quality reveal → skeptic challenge close.
- **Y:** Customer voice from a wellness-minded buyer (Review Style)
  → TRY20.
- **Z:** Short offer-led.

### Example 4 - Video ad (Flower, `FCA=The Skeptic 1st Time Online Buyer`)

**Asset cache (summary):** 9x16 UGC video. Transcript opens: "I'll
be honest, I thought this was gonna be a waste of money." Core
claims: fast shipping, better than expected, 100%
money-back guarantee. Tone: skeptic-to-believer. CTA in video:
"try it yourself."

**Headlines:**
- **U:** "I Thought This Was A Waste Of Money." It Wasn't.
- **V (Curiosity):** What Would Finally Win You Over
- **W (Proof):** 100% Money-Back Guarantee. Zero Risk.
- **X (Pain):** Stop Overpaying At The Shop.
- **Y (Transformation):** From "Waste Of Money" To Reorder

(Pain headline draft "Tired of wasting money on weak quality?" would
trip the M-12 rotator. Drafted as a statement instead.)

**Body:**
- **Z (Balanced):** Mirrors the transcript arc. Opens with the
  speaker's skeptic line in quotes, echoes the first-try moment, closes
  with the money-back guarantee + skeptic challenge.
- **AA (Proof-led):** 100% money-back, family-grown, fast
  reliable shipping → TRY20.
- **AB (Pain-led):** Overpaid at the shop → transcript
  reversal → TRY20.
- **AC (Social proof, Review Style):** The speaker's quote is itself
  the social proof - lift a second line from the transcript, close
  with skeptic challenge.
- **AD (Offer-led):** 3 lines, TRY20.

### Example 5 - Video ad (Flower, `FCA=Subscribe and Save` - reorder/repeat-purchase framing)

**Asset cache (summary):** 9x16 video of a customer opening a
reorder box. Transcript: "Third order this month. These never
disappoint." Core claims: consistency, new product line, reorder
cadence. Tone: matter-of-fact review.

**Headlines:**
- **U:** Third Order This Month. Here's Why.
- **V (Curiosity):** The New One You'd Keep Reordering
- **W (Proof):** Same Quality. Every Batch. Every Time.
- **X (Pain):** The Brand Worth Reordering.
- **Y (Transformation):** From Trying It Once To Ditching The Local Shop

**Body:**
- **Z (Balanced):** No skeptic arc - this is Repeat Buyer. Lead with
  the reorder cue, reference the new product, close offer-first.
- **AA (Proof-led):** Consistency across every order → offer.
- **AB (Pain-led):** Short - "tired of brands that change on you?" →
  reorder proof → offer. (Note: this draft trips the M-12 trigger;
  reframe as "Brands change. We don't." statement.)
- **AC (Social proof, Review Style):** Customer quote from the
  transcript inside `"..."` + ⭐️⭐️⭐️⭐️⭐️ → offer.
- **AD (Offer-led):** 3 lines, reorder-framed TRY20 or free-gift line.

### Example 6 - Sleep Gummies image ad (`DSCA=Wellness Stacker`)

> **New in 2026-05.** Added to demonstrate compliant Sleep-Gummies
> generation. Pre-rewrite, every Sleep-Gummies example in §7 used
> M-13 banned phrasings. This example draws from the wind-down
> vocabulary in §3.5b.

**Asset description (from cache):** Studio shot of a DeepSleep jar
on a wooden nightstand, a glass of water, and a sticky note that
reads "Try these tonight." `hook_type`: friend's
recommendation. `compliance_signals`: sealed jar, dose callout
visible (15mg, 30 ct), no visible gummies.

**Headlines:**
- **Q (Balanced):** The Gummy A Friend Slips You Before Bed
- **R (Curiosity):** Why Notes Like This Keep Showing Up On Counters
- **S (Proof):** 15mg Blackberry. 30 Per Jar.
- **T (Pain - non-question form):** Your Nightly Wind-Down, Made Simple.
- **U (Transformation):** Your Nightly Wind-Down Ritual

**Body (angles only):**
- **V (Balanced):** `"Try these tonight."` opener → ✅ proof
  stack: a wind-down within the hour, made for the nightly wind-down,
  made for your nightly wind-down → close with TRY20.
- **W (Proof-led):** `15mg blackberry. 30 per jar.` → wind-down ritual claim → skeptic challenge close.
- **X (Pain-led):** Names the end-of-day scramble - the long day, the late
  dishes, sticky-note moments. → ✅ proof stack → TRY20.
- **Y (Social proof, Review Style):** `"This one earned its spot."` review → ⭐️⭐️⭐️⭐️⭐️ → TRY20. Screen the quote for
  M-13/M-4 symptom-resolution language before use - no carve-out.
- **Z (Offer-led):** `Your evening reset. / Still skeptical? Test
  it yourself. / Get 20% OFF using code 'TRY20' at checkout (Limited
  Time Only)`. (🌿 removed from close line - BANNED per M-19e.)

---

## 8. Generation checklist (run per row before writing)

Before writing any of the 10 lines to the sheet, confirm:

**Content checks:**
1. You've loaded the cache for this row (not generic brand copy).
2. You've identified the avatar stage (Skepticism / Trial /
   Transformation / Repeat).
3. You've chosen 5 distinct headline hook types and 5 distinct body
   angles.
4. Each variation's lead references a specific element from the
   cache (hook, visual detail, transcript phrase, text overlay).
5. You've picked **one** close per body variation - never stacked
   skeptic challenge + TRY20.
6. **Every line has passed the meta-compliance-agent scan**
   (asset-type `ad-copy`) - see [`compliance.md`](compliance.md). Any
   FAIL was fixed per the agent's suggested substitutions and
   re-scanned; nothing is written until it passes.
7. No two variations share the same first 5 words, same lead angle,
   or same proof order.

**Format checks (per section 5.5 - non-negotiable):**
8. Primary (V/Z) body has **≥3 ✅ lines** stacked vertically with
   blank lines around the stack.
9. Proof-led (W/AA) body has **≥3 ✅ lines** stacked vertically.
10. Pain-led (X/AB) body has **≥2 ✅ lines** in the proof section.
11. Social proof (Y/AC) body is **wrapped in "..."** and ends with
    **⭐️⭐️⭐️⭐️⭐️**. CTA sits outside the quotes. **NO M-13/M-4
    carve-out for Review-Style** - screen the verbatim quote for
    symptom-resolution language; drop or use non-quote angle if any found.
12. Offer/urgency (Z/AD) body is 3–5 lines with blank-line spacing.
    No 🌿 - BANNED per M-19e (2026-06-07).
13. Headlines: **no 🌿** (BANNED per M-19e). No emoji on headlines
    unless Proof slot has a substantiated star rating (⭐️ only).
14. Every body variation has **blank lines between sections** (never
    a wall of sentence-per-line text).

**Vocabulary checks (per `compliance.md` §1.7–§1.11 - non-negotiable):**
15. Zero `bud`, `flower`, `pre-roll`, `hand-roll`, `strain`,
    `harvest`, `discreet`, `mylar pouch`, `lab-tested`, `lab-verified`,
    `Certificate of Analysis`, `COA`, `federally compliant`, `Farm
    Bill`, `Agriculture Act`, `no med card`, `Potency Promise`,
    `potency`, `potent`, `harmful chemicals`, `no pesticides`,
    `no sprays` (M-3).
16. Zero `not foggy`, `no fog`, `no jitters`, `no crash`, `no
    paranoia`, `zombie fog`, `no overthinking`, `no morning fog`,
    `no melatonin hangover`, `no chemical reset at 2AM`, `no 3AM
    jolt`, `no more 3AM ceiling stares`, `no 3AM wake-ups` (M-5
    universal).
17. Zero `scam`, `garbage`, `junk`, `trash`, `fake` as
    product/brand nouns (M-6a).
18. Zero `Tired Of X?`, `Sick Of X?`, `Done With X?`, `Done Wasting
    X?`, `Fed Up With X?`, `Can't sleep?` headlines (M-12 - replaced
    by rotator).
19. Zero `wake up rested`, `wake up refreshed`, `sleep through the
    night`, `stay asleep`, `fall asleep faster`, `drift off`,
    `8 hours straight`, `sleep deeper`, `sleeping deeper`, `best
    sleep in a long time`, `the secret to sleeping through the
    night`, `Finally Stay Asleep All Night`, `Better mornings start
    the night before`, `End the 3am ceiling stare` (M-13 - outside
    Review-Style carve-out only).

If any check fails, rewrite. Only write all 10 cells when every
check passes.
