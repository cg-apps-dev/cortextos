---
type: playbook
agent: meta-ads-agent
process: ad-copy
pipeline_stage: 2 (copy)
status: active
date: 2026-07-05
tags: [playbook, meta-ads, copy, compliance]
---

# 03 - Ad Copy

Every intaked row gets its full copy block written to the sheet: Headline + 4 variations, Primary + 4 variations, Customer Avatar, Funnel Stage, Ad Description, Promo. Sheet-only - this stage never launches anything. Runs autonomously right after intake ([01](01-clickup-intake.md)/[02](02-sheet-posting.md)).

Derived from: [brain: agents/meta-ads-agent/meta-ad-copy-agent/SKILL.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/meta-ad-copy-agent/SKILL.md) (the module spec, absorbed into meta-ads-agent 2026-06-02 per Adam) + the intake runner's §9. Copy is NEVER free-handed (Adam hard rule 2026-06-16): it is written to the brain copy spec, pulled live each run.

## Hard rules

1. **Never free-hand copy.** The copy framework, brand voice, and copywriting rules come from the brain repo LIVE each run.
2. **Ad Description on every row** (Adam, 2026-06-23) - complement the headline plus one trust element; a row with copy but a blank Ad Description is an incomplete intake.
3. **3-pass compliance inline**: mechanical grep -> cleanup -> LLM pass, before any cell is written. M-code rules are read live from meta-compliance-agent's `references/rules.md` - never localized (conventions Rule 9). Any hard hit = rewrite until clean, never echo the banned term.
4. **Schema audit before first write** (hard gate): verify the tab's column layout live; halt on mismatch.
5. **Overwrite guards everywhere**: existing avatar/funnel/copy cells are never clobbered; only empty cells are filled.
6. **Dropdown-validated cells** (Customer Avatar): write an exact member of the live validation list.

## The sequence

1. **Detect rows needing copy** across the four tabs (asset present, copy block empty).
2. **Images**: read the creative (OCR the on-image text - hard halt if OCR fails, never guess), generate the copy set per the brain spec, write by header name.
3. **Videos**: group rows by Card ID, fetch the ClickUp brief once per card (hard halt if the brief is missing), generate one copy set per card, write it to all N rows of that card.
4. **Avatar + Funnel Stage fill**: resolve per row (images) or per Card-ID group from the ClickUp brief (videos), with per-row overwrite guards.
5. **Verify + report**: any row whose copy failed goes into a "rows missing copy" report to the orchestrator - a completed card must never silently imply copy-ready.

## Hand-offs

Upstream: [01](01-clickup-intake.md)/[02](02-sheet-posting.md) (intake writes the input columns this stage reads). Downstream: [08](08-compliance-scan.md) stamps the compliance verdict on the finished rows; [04](04-launch-draft.md) only drafts rows whose copy block is complete.
