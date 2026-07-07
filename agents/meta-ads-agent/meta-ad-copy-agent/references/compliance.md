---
type: reference
agent: meta-ad-copy-agent
status: active
date: 2026-06-08
tags: [meta-ad-copy, compliance, reference]
---

# Ad Copy Compliance — single-sourced from the meta-compliance-agent

This pipeline does **not** define its own compliance rules. As of 2026-06-08, all Meta ad-copy compliance is **owned by the [meta-compliance-agent](../../../meta-compliance-agent/)** and read from there, so the rules can never drift out of sync with the auditor. (The previous in-file rule set — old Sections 1–11, the §9 cleanup pass, and the §10 mechanical substitution map — had drifted: it still mandated the 🌿 emoji and the word *flower* after both were banned. That drift is exactly what this refactor removes.)

## Where the rules live — read these, never duplicate them here

| Source | What it provides |
|---|---|
| [`meta-compliance-agent/references/rules.md`](../../../meta-compliance-agent/references/rules.md) | The canonical **M-code rules (M-1 … M-24)**: the M-2 banned-term grep gate, the M-3 approved-substitution table, and every other ban — medical claims (M-4), side-effect framing (M-5), testimonial sanitization (M-6 / M-6a), personal-attribute framing (M-12), before/after (M-13), sensational (M-16), outcome-guarantee (M-18), cannabis vocabulary + novel cannabinoids + paraphernalia + **the 🌿 / 🍃 emoji ban (M-19a–e)**, potency-superiority (M-20), illicit drugs (M-21), body-shaming (M-22), and **the brand-name "Clean Green" ban (M-24)**. |
| [`meta-compliance-agent/references/asset-type-scanners.md`](../../../meta-compliance-agent/references/asset-type-scanners.md#2-ad-copy--static-image-ad--headline--primary-text--description) | The **`ad-copy`** scanner — exactly which rules apply to generated ad copy and how. |
| [`brand/compliance.md`](../../../../brand/compliance.md) | The universal cross-channel baseline (HARD-STOP banned words, medical-claim ban) the agent references. **(human-gated)** |

## How this pipeline enforces it — the hard pre-write gate

Generation reads the rules above and produces compliant copy. **Before writing ANY copy cell to the sheet**, every generated line passes the meta-compliance-agent scan, and only PASS lines are written:

1. **Generate** each headline / body variation applying the agent's rules — use M-3 approved substitutes instead of `bud` / `flower` / `Real Bud` / `Clean Green`; no banned emojis; no medical / side-effect / diagnostic-question / before-after / sensational / outcome-guarantee framing; no `legal` / `scam` / `DEA`; no em dashes.
2. **Scan** the generated copy with the [meta-compliance-agent](../../../meta-compliance-agent/SKILL.md) — asset-type `ad-copy`, channel `meta`. It runs the Tier-1 grep gate + the Tier-2 / Tier-3 classifier review and returns a verdict + suggested substitutions.
3. **On FAIL** (any HARD STOP / HIGH finding) → apply the agent's suggested substitutions (its M-3 / M-9 tables), regenerate the offending line, and **re-scan**. Never write a line that has not passed. If a line cannot be made to PASS, block the row and report it.
4. **On PASS** → write per the column map.

**Single source of truth:** to ban a term or change a substitute, edit it **once** in the meta-compliance-agent's `rules.md` (or `brand/compliance.md`). It takes effect here automatically on the next run — there is nothing in this pipeline to update.

## Review-Style carve-out

A customer-voice testimonial block in `"..."` + `⭐️⭐️⭐️⭐️⭐️` is quoted real-review language and is **not reworded** — but it must still pass the agent's scan. The agent's M-6 testimonial sanitization + medical-claim + brand-name checks apply inside quotes: a quote containing a banned term must be paraphrased truthfully or dropped, never shipped as-is.

## What was removed (2026-06-08 refactor)

The former in-file rule set was deleted in favour of the read-and-gate model above:
- Sections 1–8 (banned-word lists, safe-alternative tables, visual / emoji / age-gating rules, per-product Flower & Sleep-Gummies rule sets) → now read from `rules.md`.
- Section 9 (post-substitution cleanup) and Section 10 (the mechanical regex substitution map) → removed; the LLM generates clean copy and the agent scan is the deterministic gate.
- If a specific learned substitution from the old §10 map ever proves worth keeping, promote it **into the agent's M-3 table** (git history retains the old version).
