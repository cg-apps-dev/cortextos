# Ad Name convention (META Ad Upload Sheet)

The `Ad Name` column on all four tabs is a PER-ROW SHEET FORMULA (relative references, auto-shifts on column inserts/deletes). No agent hand-writes it: the intake engine skips the column, and empty rows below the cursor carry the formula pre-filled. This doc is the contract every consumer keys against.

## Emitted shape

Image tabs:
```
<Code> - <Description>[ - <Customer Avatar>] - W=<writer> - D=<designer> - ID=<clickup-task-id> - <hp=|Homepage> - lp=<lp-domain> - MM-DD-YYYY
```

Video tabs:
```
<Variant #> - <Video Script> - <Actor> - <Hook #> - <Hook Type>[ - <Customer Avatar>] - W=<writer> - D=<designer> - ID=<clickup-task-id> - <hp=|Homepage> - lp=<lp-domain> - MM-DD-YYYY
```

Live example (VIDEOS (Flower) row 996, 2026-06-11):
```
V01 - UGC #141 - The Price Breakdown - Nico - H1 -  - FCA=The Shop Switcher - W=RG - D=GP - ID=86e0tju40 - hp= - lp= - 06-10-2026
```

## Hard requirements (do not break these)

1. **`ID=<clickup-task-id>` token is REQUIRED.** It is the row <-> ad join key for the launch tracker and dedup. Verified emitting on all current rows (2026-06-11); the gap is LEGACY-only - pre-June-2026 rows may carry a legacy id (e.g. `IMG-22884`) or no token. Consumers must treat missing/legacy `ID=` as a legacy row, never as a new-row error.
2. **`<Variant #>` (`V##`) leads video names** - one row per (actor, variant, hook); the version token disambiguates re-edits.
3. **The trailing ` - MM-DD-YYYY` date is LAST.** The media-buyer's rejected-ad guardrail (adset-batch STEP 1.6, PR #89) matches candidates by DATE-NORMALIZED Ad Name: it strips the trailing date and collapses whitespace. If the formula shape ever changes, flag the media-buyer BEFORE it lands so the normalizer is re-aligned.
4. **`TEXT(TODAY(),...)` means the date is volatile** - it renders the CURRENT date, not the intake date. Snapshots taken on different days differ in the date suffix by design; that is why consumers date-normalize (req 3).

## Consumers

- meta-media-buyer-agent: adset-batch naming + rejected-ad guardrail (date-normalized), ad-launch-tracker row keying (`ID=` token).
- meta-ads-agent: intake writes the formula INPUT columns only (Code/Variant/Script/Actor/Hook/W/D/CardID/...); never the Ad Name cell itself.
