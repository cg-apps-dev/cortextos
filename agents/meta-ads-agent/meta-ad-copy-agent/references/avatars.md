# Customer Avatars - Per-Tab Dropdown Columns

The Customer Avatar cell is a Google Sheets **dropdown** on all four
product-specific tabs. The plugin writes it on every run as part of
the per-tab avatar-fill loop (see SKILL.md Step 2.5 for image tabs and
Step 3.5 for video tabs).

**As of v0.8.0 the entire avatar taxonomy was migrated** away from the
old `Flower 0X - …` / `DeepSleep 0X - …` archetype naming to a unified
prefixed scheme: `FCA=` on flower tabs (6 values) and `DSCA=` on
gummies tabs (4 values). Both flower tabs now share the **same 6
values** (previously image-flower had 7 with offer/promo tags and
video-flower had only 3 archetype options). The v0.7.3 `Flower 04-07`
offer/promo tag system in §3.5 was retired - `Subscribe and Save`
returns as a first-class avatar, the rest dissolve into the new
benefit-driven options. See CHANGELOG entry for 2026-05-19.

As of v0.7.6 the four tabs do not share a single column letter - Adam
inserted sister-winner reference columns at C–F (flower tabs) and C–D
(gummies tabs), shifting the avatar column right by 4 on flower and 2
on gummies. **v0.8.1 added a 5th flower reference column at C**,
shifting the flower avatar column one more (`IMAGES (Flower)` L→M,
`VIDEOS (Flower)` P→Q); gummies are unchanged. See `column-maps.md`
for the full per-tab layout.

| Tab | Column | Dropdown type | Allowed values |
|-----|--------|---------------|----------------|
| `IMAGES (Flower)` | header-resolve (`Customer Avatar`; P as of 2026-06-11) | classic data validation (`ONE_OF_LIST`) - now API-readable; was a chip dropdown until ~2026-06 (re-verified 2026-06-11) | 6 - see §1.1 |
| `IMAGES (Sleep Gummies)` | J | chip dropdown | 4 - see §1.3 |
| `VIDEOS (Flower)` | Q | classic data validation (`ONE_OF_LIST`, `strict: true`) | 6 - see §1.2 (identical to §1.1) |
| `VIDEOS (Sleep Gummies)` | N | chip dropdown | 4 - see §1.4 (identical to §1.3) |

Only the exact strings in §1 below are valid values per dropdown. Any
other string (paraphrase, missing `FCA=` / `DSCA=` prefix, lowercase,
the retired `Flower 0X - …` / `DeepSleep 0X - …` names) either fails
the strict-validation rule or - in the case of chip dropdowns -
becomes a plain-text cell that fails the chip lookup and breaks
downstream filters.

If you add or rename an option in any dropdown, update this file in
the same change. Chip dropdowns cannot be enumerated programmatically -
verification is manual; classic `ONE_OF_LIST` columns CAN be read via
`GOOGLESHEETS_GET_SPREADSHEET_INFO` with
`fields=sheets(data(rowData(values(dataValidation))))`.

**OPERATIONAL RULE - verify per run, never trust this file alone (2026-06-11,
Adam-directed after an 11-row validation-error incident):** before any avatar
write, read the LIVE validation rule for that tab's `Customer Avatar` column
where the API exposes it, and pick the value FROM that list; where the column
is a chip dropdown, use the §1 strings below. Never write a bare avatar name
(missing prefix), never copy a neighbor cell (neighbors can be uniformly
wrong - rows 822-826 looked consistent and were ALL invalid), never
reconstruct from memory. Wording trap: `FCA=The Shop Switcher` and
`FCA=The Skeptic 1st Time Online Buyer` carry "The"; the other four do not.
After writing, read back and assert every value is an exact list member.

---

## §1 - Allowed values per tab (exact strings, case-sensitive)

### §1.1 - `IMAGES (Flower)` column M (7 options)

Flower avatars use a unified `FCA=` prefix (FCA = Flower Customer
Avatar). Three are archetype-style holdovers from the v0.7.3 taxonomy
(`Shop Switcher`, `Skeptic 1st Time Online Buyer`, `Daily Unwind`),
three are benefit/mechanism-driven (`Pain Relief`, `Better Sleep`,
`Subscribe and Save`).

- `FCA=The Shop Switcher`
- `FCA=The Skeptic 1st Time Online Buyer`
- `FCA=Daily Unwind`
- `FCA=Pain Relief`
- `FCA=Better Sleep`
- `FCA=Subscribe and Save`
- `FCA=The Well Seeker`

### §1.2 - `VIDEOS (Flower)` column Q (7 options)

**Identical to §1.1** - the image-vs-video flower split (7 vs 3) was
retired in v0.8.0. Both flower tabs now carry the same 7 values, and
the video flower path can write any of them (including
`FCA=Subscribe and Save` when the brief is a subscription pitch).

- `FCA=The Shop Switcher`
- `FCA=The Skeptic 1st Time Online Buyer`
- `FCA=Daily Unwind`
- `FCA=Pain Relief`
- `FCA=Better Sleep`
- `FCA=Subscribe and Save`
- `FCA=The Well Seeker`

### §1.3 - `IMAGES (Sleep Gummies)` column J (4 options)

Gummies avatars use a unified `DSCA=` prefix (DSCA = DeepSleep
Customer Avatar). Two are archetype-style holdovers (`Racing Mind`,
`Wellness Stacker`), two are new (`Tried Everything` for the
frustrated multi-product-tried customer, `Better Mornings` for the
next-day payoff framing).

- `DSCA=Tried Everything`
- `DSCA=Racing Mind`
- `DSCA=Wellness Stacker`
- `DSCA=Better Mornings`

### §1.4 - `VIDEOS (Sleep Gummies)` column N (4 options)

**Identical to §1.3.**

- `DSCA=Tried Everything`
- `DSCA=Racing Mind`
- `DSCA=Wellness Stacker`
- `DSCA=Better Mornings`

---

## §2 - Extraction rule per tab type

### §2.1 - Video tabs (brief-driven)

For each Card ID group in a video tab:

1. Re-use the ClickUp brief already cached from SKILL.md Step 3b (do
   not re-fetch).
2. Scan the task description, custom fields, and any linked parent
   task for an **explicit avatar declaration** matching one of the
   allowed values for the tab's product (§1.2 for flower, §1.4 for
   gummies). Common patterns:
   - `Avatar: FCA=The Skeptic 1st Time Online Buyer`
   - `Customer Avatar: DSCA=Racing Mind`
   - A "Customer Avatar" custom field whose value matches a dropdown
     option.
3. If a declaration is present AND it matches the dropdown exactly,
   use it verbatim. Done.
4. If the declaration is present but spelled/cased differently (e.g.
   `the skeptic`, `FCA=skeptic`, `Racing-Mind`, an old-taxonomy name
   like `Flower 02 - The Skeptic - First-Time Online Buyer` or
   `DeepSleep 01 - The Anxious Sleeper`), normalize to the canonical
   `FCA=` / `DSCA=` dropdown string. Add the group to the
   "normalized-from-brief" count for the Step 4 report. **Old-taxonomy
   normalization map** (briefs written before the v0.8.0 migration):

   | Old (pre-v0.8.0) | New |
   |---|---|
   | `Flower 01 - The Dispensary Switcher` | `FCA=The Shop Switcher` |
   | `Flower 02 - The Skeptic - First-Time Online Buyer` | `FCA=The Skeptic 1st Time Online Buyer` |
   | `Flower 03 - The Wellness Seeker` | `FCA=Daily Unwind` |
   | `Flower 06 - Subscribe and Save` | `FCA=Subscribe and Save` |
   | `Flower 04 - The Social Proof Validator` | no direct equivalent - fall through to §3 inference |
   | `Flower 05 - The Deal Hunter - Product Explorer` | no direct equivalent - fall through to §3 inference |
   | `Flower 07 - Sale: 420` | no direct equivalent - fall through to §3 inference (sale creative usually maps to `FCA=Subscribe and Save` or `FCA=The Shop Switcher` depending on the offer mechanism) |
   | `DeepSleep 01 - The Anxious Sleeper` | `DSCA=Racing Mind` |
   | `DeepSleep 02 - The Wellness User` | `DSCA=Wellness Stacker` |
5. If no declaration is present, infer from §3 using the brief's
   hook archetype, customer-stage signals, and primary benefit
   framing. Then apply §4 if the brief is ambiguous.

### §2.2 - Image tabs (image-driven)

Image tabs have no ClickUp brief - the image is the brief. SKILL.md
Step 2a already does the native-vision read and extracts on-image
text (offers, prices, proof signals, hooks, format cues). Reuse that
extraction for avatar selection - do not re-read the image.

For each qualifying image row:

1. Apply §3 inference to map the image's hook, benefit framing, and
   commercial mechanism to one of the six FCA= values (flower) or
   four DSCA= values (gummies).
2. If the image is ambiguous, apply §4 tie-breakers and the per-tab
   default.

The avatar field on images is **per-row**, not per-group - every
image row has its own brief (the image itself), so no Card-ID
grouping applies on image tabs.

---

## §3 - Inference cues

These cues map the asset (image visual / video script) to the right
FCA= / DSCA= value. Pick the **strongest** match; if two look
equally plausible, fall back to §4.

### §3.1 - Flower avatars (FCA=)

Used for both `IMAGES (Flower)` column M and `VIDEOS (Flower)` column
Q.

**`FCA=The Shop Switcher`** - current dispensary / local-shop customer
being converted to direct-to-consumer.

- Mentions of dispensary trips, dispensary prices, dispensary
  inconvenience, "I used to drive to…", "tired of dispensary lines /
  taxes / markups", price comparisons against dispensary shelves.
- Image cues: side-by-side price-comparison layouts, "vs. your
  dispensary" framing, dollar-savings callouts, USPS box vs.
  storefront contrast.
- Hook: convenience + savings + same-or-better-quality vs. a known
  retail experience.
- Reads as someone who already buys cannabis, not a first-timer.

**`FCA=The Skeptic 1st Time Online Buyer`** - believes hemp-derived /
online / mail-order cannabis is fake, weak, mid, or a scam, and the
asset earns trust over the arc.

- Skeptic-quote openers (`"Yeah right, ordering quality online is
  probably a disappointment"`), "I didn't believe it until…",
  surprise/reversal payoffs, scam-detector framing (without using the
  M-6a banned nouns).
- Image cues: quote-overlay creative with the skeptic-voice headline,
  doubt-then-reveal split layouts, customer-reaction visuals.
- Hook: pattern-interrupt that names the doubt, then disarms it.
- Reads as someone burned by online cannabis before - or fearing it.

**`FCA=Daily Unwind`** - uses cannabis primarily for end-of-day
relaxation, evening routine, decompression. Not chasing intensity.

- End-of-day / unwind / wind-down language, "after work" framing,
  ritual / daily routine, "without overdoing it", calm-vs-stress
  framing.
- Image cues: muted/earthy palette, evening lifestyle visuals
  (couch / porch / golden-hour lighting), ritual props (mug, candle,
  book) alongside sealed product packaging.
- Hook: lifestyle routine / evening payoff, not potency or price.
- Reads as a wellness-curious adult, often a lighter or occasional
  consumer. **Inherits the v0.7.3 `Flower 03 - The Wellness Seeker`
  cues** - same archetype, retitled with a stronger end-of-day framing.

**`FCA=Pain Relief`** - uses cannabis for aches, soreness, muscle
recovery, post-workout, chronic-pain management. Benefit-driven, not
archetype-driven.

- Pain / soreness / aches / muscle recovery / post-workout language,
  "after a long day on my feet", "I used to wake up sore", chronic
  pain references (back pain, joint pain, recovery framing).
- Image cues: post-workout visuals, recovery-themed shots (foam
  roller / stretching / ice pack alongside sealed product packaging),
  age-skews-older creative, athletic / blue-collar / manual-labor
  framing.
- Hook: pain-then-relief arc, benefit framing first.
- Distinct from `FCA=Daily Unwind` because the hook is **relief from
  a specific physical pain**, not generic decompression. If the asset
  is about evening calm without a pain reference, route to Daily
  Unwind instead.

**`FCA=Better Sleep`** - uses **flower** specifically for sleep
support. Distinct from the gummies sleep path because the SKU is
flower; the avatar fires when a flower asset's primary hook is
sleep / can't-sleep / bedtime.

- Can't-sleep / wind-down-for-bed / bedtime / "before bed" language
  on a flower asset.
- Image cues: nightstand placement, bedroom visuals, lamp-lit /
  blue-hour lighting, sealed product packaging next to bed.
- Hook: sleep-difficulty-to-rested arc, but the product is flower
  not gummies. If the asset shows the DeepSleep jar instead, this
  avatar does not apply - the row belongs in a gummies tab (Step 2a
  tab-mismatch check catches it).
- Reads as a sleep-troubled adult who reaches for flower as the
  sleep aid.

**`FCA=Subscribe and Save`** - subscription mechanism is the hook.
**Replaces and absorbs the retired v0.7.3 `Flower 06 - Subscribe and
Save` offer/promo tag** but is now a first-class avatar that can
fire on any tab (image or video), not just images.

- "Subscribe & Save", "Auto-Ship", "Monthly Delivery",
  recurring-delivery framing, "save 20% every month" recurring-discount
  framing, or a subscription-discount callout as the dominant hook.
- Image cues: Subscribe & Save badge sized as the headline element,
  recurring-delivery visuals, auto-ship calendar / cadence graphics,
  "never run out" framing.
- Hook: commercial mechanism, not customer archetype. Fires on the
  **dominant hook** rule - a small "subscribe for 10% off" callout
  under the main hero does NOT trigger; the subscription is the
  centerpiece or it isn't.

### §3.2 - Sleep gummies avatars (DSCA=)

Used for both `IMAGES (Sleep Gummies)` column J and `VIDEOS (Sleep
Gummies)` column N.

**`DSCA=Tried Everything`** - frustrated stack-builder who has cycled
through melatonin, magnesium, ZzzQuil, prescription, other sleep
brands, and is still searching.

- "I've tried melatonin / magnesium / [other brand]" framing,
  "nothing has worked" arc, supplement-failure stories,
  brand-comparison reversal ("I switched from X to DeepSleep").
- Image cues: lineup of competitor / supplement bottles being set
  aside, side-by-side "what I used to take vs. what I take now",
  pill-vs-gummy contrast layouts.
- Hook: frustration-then-resolution. Names the failure path
  specifically.
- Distinct from `DSCA=Racing Mind` because the problem is
  product-failure, not anxious cognition.

**`DSCA=Racing Mind`** - racing-mind sleeplessness, can't shut the
brain off, lies awake, wakes up at 3 AM cycling through worries.
**Inherits the v0.7.3 `DeepSleep 01 - The Anxious Sleeper` cues**.

- Mentions of racing thoughts, replaying conversations / emails /
  tomorrow's list, anxiety-driven insomnia, "my brain won't stop,"
  3 AM wake-ups, evening overthinking.
- Image cues: clock-at-3AM creative, "racing mind" visual metaphor,
  bedroom-ceiling / lying-awake imagery, anxious-monologue overlay
  text.
- Hook: name the racing mind, then offer the wind-down ritual.
- Reads as someone whose sleep problem is mental, not physical.

**`DSCA=Wellness Stacker`** - already routine-driven, already takes
supplements / does meditation / has a wind-down ritual, looking for
the next consistent piece of the stack. **Inherits the v0.7.3
`DeepSleep 02 - The Wellness User` cues**, renamed to emphasize the
stacking behavior.

- Stack/supplement framing, ritual / nightly routine / consistency
  language, "I already do X, Y, Z and wanted something that fits."
- Image cues: routine grids ("my nightly stack"), supplement-shelf
  visuals, candles + tea + journal + gummy lifestyle shots,
  morning-after rested-glow visuals.
- Hook: the wind-down ritual is reinforced; the gummy slots into an
  existing routine.
- Reads as a routine optimizer, not someone in crisis.

**`DSCA=Better Mornings`** - morning-after payoff framing. The hook
isn't bedtime - it's how the next day feels. Energy, productivity,
"rested-glow," beating the alarm.

- Morning-after / "woke up rested" / productive-mornings / "best
  morning in months" framing as the primary hook. Mornings are the
  reveal, not the bedtime.
- Image cues: morning visuals (sunrise / coffee / commute / golden
  hour), rested-glow lifestyle shots, before-bed-vs-next-morning
  split layouts where the morning frame is the dominant one.
- Hook: outcome-led - name the morning result, then explain the
  nightly mechanism that produced it.
- Distinct from `DSCA=Racing Mind` (which leads with the bedtime
  problem) and `DSCA=Wellness Stacker` (which leads with the
  routine). Same product, different angle of the story.

---

## §3.5 - Retired offer/promo tag system

The v0.7.3 `Flower 04-07` offer/promo tag trigger table that lived
here has been **retired in v0.8.0** as part of the avatar-taxonomy
migration. The four tags (`Social Proof Validator`, `Deal Hunter`,
`Subscribe and Save`, `Sale: 420`) no longer exist in the dropdown:

- `Subscribe and Save` returns as a first-class avatar (§3.1's
  `FCA=Subscribe and Save`) and is no longer image-flower-only - it
  fires on any flower tab when subscription is the dominant hook.
- The other three (`Social Proof Validator`, `Deal Hunter`, `Sale:
  420`) have no direct successor. Testimonial / review-format
  creative, multi-product grids, and 4/20 sale creative now route to
  the archetype that best fits the underlying customer being
  addressed (usually `FCA=The Skeptic 1st Time Online Buyer` for
  testimonial-led, `FCA=The Shop Switcher` for grid / bundle
  creative, `FCA=Subscribe and Save` for recurring offers, or one
  of the benefit avatars when the creative's hook is benefit-led).

If you find yourself reaching for a tag that was here in v0.7.3,
infer the archetype instead. See the v0.7.3 → v0.8.0 normalization
map in §2.1.4 for the offer-tag-only patterns that have no direct
equivalent.

---

## §4 - Ambiguity resolution (no clear signal)

Per the v0.7.2 product decision: **never leave the avatar cell empty
when a brief is present (videos) or an image is readable (images)**.
Pick the closest option from the per-tab dropdown using the rule
below, and add the row / group to the "inferred-ambiguous" count in
the Step 4 report so a human can spot-check.

Tie-breaker order (apply in sequence):

1. **Commercial-mechanism dominance.** Is the asset's dominant hook a
   commercial mechanism (subscription, recurring discount,
   bundle/cadence)? If yes, prefer `FCA=Subscribe and Save` on flower
   tabs over a generic archetype guess. Gummies tabs have no
   commercial-mechanism avatar - skip this rule on gummies.
2. **Benefit framing.** Is the hook a specific physical benefit
   (pain, sleep)? Prefer the benefit-driven avatar over the
   archetype:
   - Flower: pain framing → `FCA=Pain Relief`; sleep framing →
     `FCA=Better Sleep`.
   - Gummies: morning-after framing → `DSCA=Better Mornings`;
     racing-mind framing → `DSCA=Racing Mind`.
3. **Hook archetype.** Skeptic-quote opener or "I didn't believe it"
   reversal → `FCA=The Skeptic 1st Time Online Buyer` (flower) /
   `DSCA=Tried Everything` (gummies, if the doubt is product-failure
   specific).
4. **Customer-stage signal.** Brief / image references existing
   dispensary or supplement / ritual usage →
   `FCA=The Shop Switcher` (flower) / `DSCA=Wellness Stacker`
   (gummies).
5. **Primary benefit framing - generic.** Calm / relaxation /
   wind-down framing with no skeptic arc, no dispensary mention, and
   no specific physical benefit → `FCA=Daily Unwind` (flower) /
   `DSCA=Wellness Stacker` (gummies).
6. **Final fallback.** If none of 1-5 lands, use the per-tab default
   and flag the row / group for human review:
   - flower (both tabs): `FCA=The Skeptic 1st Time Online Buyer`
   - sleep gummies (both tabs): `DSCA=Racing Mind`

The defaults are chosen because Clean Green's winning ad library
still skews heavily toward skeptic-arc creative on flower and
anxious-mind creative on gummies - they are the safest blind
guesses, but they are still guesses and must surface in the Step 4
report.

---

## §5 - Brief- / asset-side tab-mismatch interaction

The tab declares the product (SKILL.md "Tab-mismatch check"), so:

- A flower asset in a flower tab → pick from §1.1 (image) or §1.2
  (video). Both lists are identical as of v0.8.0.
- A gummies asset in a gummies tab → pick from §1.3 (image) or §1.4
  (video). Both lists are identical.
- An asset whose product **contradicts** the tab → the row / group is
  already blocked at the relevant tab-mismatch check. Do not pick an
  avatar; do not write the Customer Avatar column. The block report covers it.

There is no shared / cross-product avatar value. `FCA=The Skeptic 1st
Time Online Buyer` in a gummies tab is a hard error - block instead
of writing. Likewise `DSCA=Racing Mind` in a flower tab.

---

## §6 - Overwrite behavior

If the Customer Avatar cell on a row already contains a non-empty
value, **skip that row for avatar fill** - never overwrite. Per-tab
letters: M on `IMAGES (Flower)`, J on `IMAGES (Sleep Gummies)`, Q on
`VIDEOS (Flower)`, N on `VIDEOS (Sleep Gummies)` (flower letters are
v0.8.1, +1 vs v0.7.6).
Same pattern as the copy columns. The user may explicitly request
`regenerate avatar` to force an overwrite; that path is not on by
default.

Avatar fill is **independent of copy fill**. A row whose copy columns
are already populated but whose avatar cell is empty is still a
candidate for avatar-only fill on this run. A row whose avatar is
already populated but whose copy is empty is still a candidate for
copy-only generation.

For video tabs (Card ID grouped): if existing non-empty avatar
values diverge inside a single group, use the most common value for
the **empty** cells in the group and note the divergence in the Step
4 report. Do not overwrite the divergent non-empty cells.

For image tabs: avatar selection is per-row (one image per row), no
group divergence to resolve.

**Old-taxonomy carry-over rows.** Rows written before the v0.8.0
migration may carry `Flower 0X - …` / `DeepSleep 0X - …` strings.
Per §6 the plugin does **not** retroactively re-tag these - the
operator may decide to clean them up manually, but avatar-fill leaves
them alone.

---

## §7 - Dropdown drift (future)

If a new option is added to any dropdown (e.g. flower gains
`FCA=New Avatar`, or gummies gains a new DSCA= option):

1. Add the exact string to §1 under the correct tab.
2. Add inference cues to §3 (archetype or benefit framing).
3. Re-rank the §4 tie-breaker chain if the new option should win
   over an existing rule.
4. Re-rank the §4 default if the new option should be the safer
   blind guess.
5. Bump the plugin version and add a CHANGELOG entry naming the
   change.

If an option is removed from a dropdown but the sheet still has rows
tagged with the old value, treat those rows as "already filled" - the
plugin does not retroactively re-tag.

---

## §8 - Why chip dropdowns require manual verification

Three of the four Customer Avatar cells use chip-style dropdowns
(`IMAGES (Flower)!M`, `IMAGES (Sleep Gummies)!J`, `VIDEOS (Sleep
Gummies)!N`) - Google's newer smart-chip system. The fourth
(`VIDEOS (Flower)!Q`) uses classic `ONE_OF_LIST` data validation.
Chip dropdowns are stored in a separate data layer that the Composio
`GOOGLESHEETS_GET_DATA_VALIDATION_RULES` tool does not surface - it
only sees classic validation. v0.8.0 confirms the four dropdowns
through the `audit-sheet-schema` skill: the classic dropdown on
`VIDEOS (Flower)!Q` is measured via the API; the three chip
dropdowns require the user to paste the visible options manually.

Practical consequence: this file (`avatars.md` §1) is the canonical
source of truth for dropdown values. The plugin trusts §1 over any
runtime data-validation read. If the sheet's dropdowns are edited,
§1 must be updated by hand (or via the `audit-sheet-schema` drift
detector with a chip-dropdown paste step) - the Composio API alone
will not catch the drift on chip-style cells.
