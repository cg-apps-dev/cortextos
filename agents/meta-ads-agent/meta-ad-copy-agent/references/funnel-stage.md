# Funnel Stage - Per-Tab Dropdown Columns

The Funnel Stage cell is a Google Sheets **classic data-validation
dropdown** (`ONE_OF_LIST`, `strict: true`) on all four product-specific
tabs. Allowed values: `TOF`, `MOF`, `BOF` - uppercase, no prefix, no
suffix.

The plugin writes this column on every run as part of the per-tab
funnel-stage-fill loop (see SKILL.md Step 2.6 for image tabs and
Step 3.6 for video tabs). On all four tabs the fill reads the linked
ClickUp card for an explicit declaration and falls back to TOF when
nothing is declared (v0.7.5+).

**As of v0.7.6 the four tabs do not share a single column letter** -
the sister-winner reference columns inserted at C–F (flower) / C–D
(gummies) shifted the FUNNEL STAGE column right by 4 on flower tabs
and 2 on gummies tabs. **v0.8.1 added a 5th flower reference column at
C**, shifting the flower FUNNEL STAGE column one more to the right
(`IMAGES (Flower)` M→N, `VIDEOS (Flower)` Q→R); gummies are unchanged.

| Tab | Column | Dropdown type | Allowed values |
|-----|--------|---------------|----------------|
| `IMAGES (Flower)` | N | classic `ONE_OF_LIST`, strict | `TOF`, `MOF`, `BOF` |
| `IMAGES (Sleep Gummies)` | K | classic `ONE_OF_LIST`, strict | `TOF`, `MOF`, `BOF` |
| `VIDEOS (Flower)` | R | classic `ONE_OF_LIST`, strict | `TOF`, `MOF`, `BOF` |
| `VIDEOS (Sleep Gummies)` | O | classic `ONE_OF_LIST`, strict | `TOF`, `MOF`, `BOF` |

Only the exact strings above pass the strict-validation rule. Lowercased
values (`tof` / `mof` / `bof`), expanded labels (`Top of Funnel`,
`Bottom Of Funnel`), or paraphrases (`cold`, `warm`, `hot`) all fail
validation. Never write any other string.

---

## §1 - Stage framing (Cold / Warm / Hot audience)

Picked by the team 2026-05-14. This is the canonical framing every
inference cue maps back to.

**`TOF` - Top of funnel, cold prospect.** The viewer has no prior
relationship with Clean Green. They might be problem-aware
("driving to the shop is annoying", "online cannabis is sketchy") but
they are not actively evaluating the brand. The ad's job is pattern
interruption and brand introduction. Most prospecting / acquisition
campaigns sit here.

**`MOF` - Middle of funnel, warmed-up consideration.** The viewer is
familiar with the brand and is now evaluating. They've seen the hook
before; this ad reinforces proof, differentiation, and trust. Deep
proof stacks, lab-test framing, family-grown story, side-by-side
comparisons, longer-form testimonial.

**`BOF` - Bottom of funnel, ready to buy.** The viewer has been
retargeted, knows the brand, and needs the close. Offer + risk
reversal do the work: `20% OFF using code TRY20`, `100-Day Money-Back
Guarantee`, scarcity, deadline, FAQ / objection-handling. The ad is
80% commercial mechanism, 20% brand reassurance.

These are **audience-stage** labels, not creative-format labels. A
testimonial ad can be TOF (introducing the brand through a customer
voice) or BOF (closing a retargeted skeptic). The funnel stage is
declared by the brief or the campaign plan, not derived from the ad's
copy structure.

---

## §2 - Extraction rule per tab type

### §2.1 - Video tabs (brief-driven)

For each Card ID group in a video tab:

1. Re-use the ClickUp brief already cached from SKILL.md Step 3b (do
   not re-fetch).
2. Scan the task description, custom fields, and any linked parent
   task for an **explicit funnel-stage declaration**. Common patterns:
   - `TARGET AUDIENCE: TOF`
   - `STAGE: MOF`
   - `Funnel Stage: BOF`
   - A "Funnel Stage" / "Stage" / "Audience Stage" custom field whose
     value matches `TOF` / `MOF` / `BOF`.
3. If a declaration is present and the value normalizes to `TOF`,
   `MOF`, or `BOF`, use it. Done.
4. **Normalization rules** (count as `normalized-from-brief` for the
   Step 4 report):
   - `Top of Funnel` / `Top-of-Funnel` / `top of funnel` → `TOF`
   - `Middle of Funnel` / `Mid-Funnel` / `mof` → `MOF`
   - `Bottom of Funnel` / `Bottom-of-Funnel` / `bof` → `BOF`
   - `Cold` / `Cold audience` / `Prospecting` → `TOF`
   - `Warm` / `Warm audience` / `Consideration` → `MOF`
   - `Hot` / `Hot audience` / `Retargeting` / `Closing` → `BOF`
5. If no declaration is present, **default to `TOF`** (per §3). Add
   the group to the `defaulted-to-TOF` count for the Step 4 report.
6. The chosen value must be exactly one of `TOF`, `MOF`, `BOF` - any
   other string is a hard error; block the row instead of writing.

All rows in a Card ID group share one funnel-stage value. If existing
non-empty values diverge inside a single group, do not overwrite - use
the most common existing value for new rows in the group, and note the
divergence in the Step 4 report.

### §2.2 - Image tabs (linked-card driven, new in v0.7.5)

Image tabs do not use the image asset for funnel-stage inference -
funnel stage is a campaign/audience metadata field, not a creative
content signal. v0.7.5+ reads the **linked ClickUp card** (column L
on `IMAGES (Flower)` as of v0.8.1, column I on `IMAGES (Sleep Gummies)`)
the same way Step 3.6 reads the Card ID column on video tabs.

Image rows naturally group by Card ID (V1 / V2 / V3 of the same ad
share one ClickUp card), so the fetch is per-group not per-row.
For each Card ID group with an empty FUNNEL STAGE cell on at least
one row:

1. Group image rows by Card ID (column L on `IMAGES (Flower)`, column
   I on `IMAGES (Sleep Gummies)`). Rows with no Card ID go into a
   `no_card` bucket and default to `TOF` (image rows are still
   writable without a card, unlike video rows - the image itself is
   the brief for copy, so a missing card only blocks stage inference,
   not the row).
2. Fetch the card with `CLICKUP_GET_TASK`, cache it keyed by Card ID.
3. Scan the task description, custom fields, and any linked parent
   task for an **explicit funnel-stage declaration** matching the
   patterns in §2.1.2 (`TARGET AUDIENCE: TOF`, `STAGE: MOF`,
   `Funnel Stage: BOF`, or a Funnel Stage / Audience Stage custom
   field).
4. If a declaration is present and normalizes to `TOF` / `MOF` /
   `BOF` (per §2.1.4 synonyms), use it. Increment
   `explicit-from-brief` or `normalized-from-brief` accordingly.
5. If no declaration is present, default to `TOF` (§3) and
   increment `defaulted-to-TOF`.
6. If the ClickUp fetch fails (401 / 404 / invalid ID / non-ClickUp
   string), do **not** block the row - image rows have copy that
   can ship without a known stage. Instead, default to `TOF` and
   add the row to `defaulted-to-TOF-from-fetch-failure` for the
   Step 4 report so the operator can see which rows had a bad
   Card ID.

The per-row overwrite guard applies: rows whose FUNNEL STAGE cell is
already non-empty are skipped and never overwritten, even when the
existing value is `MOF` or `BOF` (per-tab letters: N on `IMAGES
(Flower)` as of v0.8.1, K on `IMAGES (Sleep Gummies)`). Operator intent wins.

**Visual-cue inference (offer dominance, brand-intro vs. retargeting)
is still reserved for a future version.** v0.7.5 reads the linked
card; it does not look at the image for stage cues. See §5.

---

## §3 - Per-tab default

When the linked card carries no explicit declaration (or the card
is unfetchable on an image row), the per-tab default is `TOF` on
all four tabs. Picked by the team 2026-05-14. Rationale: most
Clean Green UGC and image ads still run cold acquisition, and TOF
is the safest fallback - it will not over-promise retargeting
performance to the buying platform when the ad is actually a
prospecting unit.

If you want a different default on a specific tab in the future,
update this section and `column-maps.md` together, and bump the plugin
version.

---

## §4 - Ambiguity resolution

Per the v0.7.4 product decision (still in force in v0.7.5):
**never leave the Funnel Stage cell empty when the row qualifies for
write**. Specifically:

- Video row, brief fetched, declaration found → write the
  declared / normalized value.
- Video row, brief fetched, no declaration → write `TOF` (§3
  default).
- Video row, brief unfetchable / Card ID missing → block the row
  per SKILL.md Step 3b-HALT / Step 3c-HALT. Write nothing.
- Image row, card fetched, declaration found → write the declared
  / normalized value.
- Image row, card fetched, no declaration → write `TOF` (§3).
- Image row, card unfetchable or no Card ID → write `TOF` and flag
  as `defaulted-to-TOF-from-fetch-failure` (§2.2.6). Unlike video
  rows, image rows are **not** blocked on card-fetch failure
  because the image itself is the brief for copy; only stage
  inference degrades.
- Image row, image unreadable / tab-mismatch → already blocked by
  Step 2b-HALT / Step 2a. Funnel stage is not written.

The `defaulted-to-TOF` count in the Step 4 report exists so operators
can spot a run that's collapsing every row into the default and catch
classifier drift or brief patterns that should have been recognized.
A run that writes 100% TOF on a tab that's known to have MOF and BOF
campaigns is a signal, not a success.

---

## §5 - Future extensions (not yet implemented in v0.7.5)

These are stubs to keep the inference surface visible. None of them
ship in v0.7.5 - the agent must not implement any of these without an
explicit version bump and a spec update here:

- **Image-visual stage inference** based on offer dominance: an ad
  whose dominant visual is the offer card (4/20 sale, TRY20 hero)
  probably reads as BOF; a pure brand-intro hook probably reads as
  TOF; a proof-stack-heavy creative (10K reviews, lab test,
  family-farm story) with a soft offer probably reads as MOF.
  Currently v0.7.5 reads the linked ClickUp card and falls back to
  TOF - visual cues are not consulted. Adding this requires a
  per-tag cue table in §3 and a confidence threshold for when
  visual cues override the linked-card default.
- **Hook-type cross-reference**: the `Hook Type` column on the video
  tabs (column P on `VIDEOS (Flower)` as of v0.8.1, column M on `VIDEOS (Sleep
  Gummies)`) may carry a funnel-stage signal - e.g. a
  `Closer` hook type implies BOF. Not used in v0.7.6 because the
  column is inconsistently filled.
- **Campaign-source inference**: the brief sometimes mentions
  "prospecting campaign" / "retargeting campaign" - these phrases could
  map to TOF / BOF respectively. Currently normalized through §2.1.4
  via the `Cold` / `Warm` / `Hot` synonyms.
