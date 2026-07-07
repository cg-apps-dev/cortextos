# Completeness Mapping — Meta Ad Copy Agent consolidation

**Purpose:** prove that collapsing the 8 source files into the single `playbook.md` lost NO apply-every-run rule. Shown, not asserted. Built from 4 parallel adversarial completeness critics (one per rule-bearing file + one for the 4 lookup files), each mapping every source rule → ELEVATED (in the playbook) / REFERENCE-ONLY (correctly left in its file, which the consolidation KEEPS) / CHANGED (with basis) / GAP (caught + closed).

**The consolidation is ADDITIVE:** the playbook is a new single read-every-run entry layer; all 8 reference files PERSIST (PART 4 points to them on-demand). Nothing is deleted.

---

## ‼️ RATIFY AT MERGE — explicit decisions needed (compliance + Adam)

### 1. WRITE BOUNDARY — does the copy agent write `Ad Description` + `Promo`? → **RESOLVED: YES (WRITE).**
- **The conflict (two brain files disagree):** `SKILL.md` (L45/L225) and `column-maps.md` say `Ad Description` + `Promo Code` are **read-only / do-not-write** (12-cell boundary). But `copy-framework.md` §4.2 carries full `Ad Description` AUTHORING rules, the **ratified** `sheet-column-ownership.md` (2026-06-04, orchestrator-ratified) lists **`Ad Description` under "meta-ads-agent OWNS"**, and this session's live intake DID write `Ad Description` + `Promo`.
- **Ruling (the-orchestrator, this session):** **WRITE governs.** Basis = the ratified ownership doc + live practice + copy-framework §4.2 all align = current ratified reality. The SKILL/column-maps "read-only" is the stale pre-ratification MVP boundary → corrected in the reference-refresh task (`task_1781995021909`).
- **In the playbook:** §G write set = 10 copy + avatar + funnel + **Ad Description + Promo**; §H carries the authoring rules.
- **Asking compliance + Adam to explicitly bless this at merge** (it's a live-sheet write boundary; if Adam wants read-only it's a 1-line flip). **Note: writing `Ad Description` does NOT bypass compliance — the M-code scan + the gate apply to it like any cell.**

### 2. M-code range cite — minor. Playbook §Compliance cites **M-1…M-25**; source SKILL.md cites M-1…M-24. Treated as an intentional brain update (rules.md is the live SoT either way). Confirm at merge.

---

## Completeness result by source file

| Source file | Critic result | Gaps caught → how closed in the revised playbook |
|---|---|---|
| **copy-framework.md** (1121 ln) | 5 GAPS + 1 self-contradiction | (1) asset-to-copy ALIGNMENT enforcement → §C "ASSET-ALIGNED (the #1 rule)… generic = FAILURE"; (2) DeepSleep SIX-INGREDIENT formula accuracy → §De-code (true-count-only, non-exhaustive lists, re-verify); (3) Ad Description authoring → §H; (4) CTA-to-close matching → §C ("Match the close to the CTA button…"); (5) per-body ✅-stack minimums → §C (Classic/Proof ≥3, Pain ≥2); **self-contradiction** (clarity gate recommended `farm-direct` which §De-code bans) → removed from §B. Minors: melatonin-free gummies, avatar-naming headline, no-synonym-swap → §B/§C/gate. |
| **brand-voice.md** (547 ln) | 2 GAPS + 3 second-person conflicts (in the file) | (1) no-dramatic-ellipses-unless-quoting → §A + §5.5 + gate#1; (2) free-gift-replaces-TRY20-never-stack → §C close set. The 3 second-person conflicts ("old me vs new me", "they order again", "then they realize") + stale banned vocab are IN THE FILE → reference-refresh task. |
| **SKILL.md** (519 ln) | 6 GAPS | (1) per-run REPORT format → §I + PART1 step10; (2) write-boundary (see RATIFY #1); (3) no-shared-first-5-words → §B/§C + gate; (4) body length spec → CHANGED-intentional (copy-framework §5.5 SHAPES explicitly supersede the rigid counts; §C "length spread ≥2x" carries the intent); (5) crystal-clear PRODUCT-CLEAR + PROMO-CLEAR + **NEVER "Sleep Gummies" (implied M-13)** → §B + gate#3; (6) OCR/brief/no-card HALT contracts → PART1 step2. |
| **avatars.md** (504 ln) | 1 GAP; lists verified EXACT-match | never-overwrite-non-empty guard → §D + PART1 step3. The 6 FCA + 4 DSCA strings in §D are character-identical to avatars.md §1 (incl the "The" trap). Inference cues + tie-breakers = legit REFERENCE. |
| **funnel-stage.md** (220 ln) | 1 GAP | never-overwrite-non-empty guard → §E. Values + default TOF verified. Added a funnel∈{TOF,MOF,BOF} gate line (gate#6). |
| **column-maps.md** (477 ln) | spreadsheet-ID + boundary | Spreadsheet ID inlined in §G. Header-by-name protocol verified-matching → §G. 12-cell boundary corrected to the ratified 14-cell write set (RATIFY #1). Per-tab letters = legit REFERENCE. |
| **manual-copy-gen.md** (379 ln) | none (separate mode) | Legitimately REFERENCE (the `/adcopy:manual` hand-batch mode). Stale 🌿/farm-direct/family-grown in it → reference-refresh task. |
| **compliance.md** / **sheet-column-ownership.md** | n/a | compliance.md = single-source pointer (no own rules) → §Compliance. ownership doc = the basis for RATIFY #1. |

**Net:** the critics caught **15 apply-every-run rules** the first playbook draft silently dropped + 2 self-contradictions. All are closed in the revised playbook (cited above). Avatar strings, funnel values, and the header-by-name protocol were verified character/semantics-exact against source.

---

## Intentional CHANGES (not losses — basis given)
- **Avatar live-read → §D canonical-list + drift-tripwire.** gog can't read dataValidation; the Sheets API doesn't reject invalid values (tested this session), so the old "read the live dropdown" safety isn't portable. Replaced by: canonical list authority + a gog-native distinct-live-values drift tripwire + read-back. STRONGER, not weaker.
- **Per-slot rigid body length (8-14/5-8/3-5) → 5 SHAPES + length-spread ≥2x.** copy-framework §5.5 explicitly "supersedes the old rigid per-slot signatures."
- **Second-person rule** (Adam 2026-06-20) is NEW (no source equivalent) — layered into §A + gate#2. The stale third-person examples in the reference files → refresh task.

## Deferred to the reference-refresh task (`task_1781995021909`, separate PR)
The KEPT reference files still teach pre-M-19f / pre-second-person patterns (proof-banks push `tested before it ships` / `American farm-direct` / `family-grown` / `ships to states`; §7 + brand-voice §8 examples use 🌿 and third-person headlines; manual-copy-gen lists 🌿). The playbook's PART 4 caveat closes the interim risk ("playbook rules win over stale examples"); the files get scrubbed in the separate refresh PR.
