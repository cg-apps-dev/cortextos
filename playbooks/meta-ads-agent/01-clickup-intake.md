---
type: playbook
agent: meta-ads-agent
process: clickup-intake
pipeline_stage: 1 (intake - ClickUp side)
status: active
date: 2026-07-05
tags: [playbook, meta-ads, clickup, intake]
---

# 01 - ClickUp Intake

Every finished creative that is `📤 ready to post` for Meta gets pulled from ClickUp, classified, and resolved into a write-ready package for the sheet-posting playbook ([02-sheet-posting.md](02-sheet-posting.md)). This playbook covers the ClickUp side: pulling, classifying, flagging, and card lifecycle. Runs autonomously (~15-min poll + daily sweep).

Derived from: [brain: agents/meta-ads-agent/skills/clickup-intake/SKILL.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/skills/clickup-intake/SKILL.md) (Stage-1 conventions) + the intake runner ([brain: agents/meta-ads-agent/skills/meta-intake/SKILL.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/skills/meta-intake/SKILL.md); the executing copy runs from the agent's local, untracked `skills/meta-intake/`). The skill files stay the executable spec - this is the readable sequence.

## Hard rules

1. **Compliance never blocks intake** (Adam, 2026-06-30). Every ad goes on the sheet first; the compliance verdict is a col-B stamp Adam uses to gate posting, never a reason to hold a card off-sheet. The only non-adds are data-integrity: an empty/unparseable creative folder, or an ambiguous product.
2. **Meta only - exclude Axon at two levels.** Card level: Ad Platform=Axon, an AXON name prefix, or the Pod 3 Axon list. Folder level: an Axon-named subfolder or file inside a legitimate Meta card's Drive folder is never picked as the finished folder (Adam, 2026-06-25).
3. **Classify deterministically, never by eyeballing the card.** The resolver script does a full per-card read and returns product, writer, designer, folder, description by exact custom-field IDs - its output is used verbatim.
4. **Never guess the product.** Ambiguous flower-vs-gummies = flag + skip; wrong-tab rows are a hard error downstream.
5. **Writer + Designer required but non-blocking** (Adam, 2026-06-28). Apply standing conventions first (`MB_CG_IMG_*` -> Writer MB, Designer TS), intake the row regardless, THEN flag the card (marker comment + @leeza + Agent Flagged status) if either is still unset; the daily reconcile sweep backfills the sheet once the team assigns.
6. **No silent drops, no comment spam.** Every non-added card is flagged loudly (comment names the exact reason: EMPTY_FOLDER vs FILES_PRESENT_UNPARSEABLE vs AMBIGUOUS vs MISSING_WRITER_DESIGNER), and flagging is idempotent so the poll never re-spams a stuck card.
7. **One failed card never stops the run.** Log it, continue.

## The sequence

1. **Precondition check** (fail-fast): probe Sheets + Drive + ClickUp access. Any failure -> tell the orchestrator, change nothing, stop.
2. **Pull fresh** (never a cached list) from the four ad lists: Static Image Ads, Video Ads, Pod 1 UGC, Pod 2 UGC. Zero ready = log + quiet exit.
3. **Classify each card** via the resolver: product -> tab (Flower vs Sleep Gummies; source list decides IMAGES vs VIDEOS), writer/designer, Drive folder.
4. **Hand the package to sheet-posting** ([02](02-sheet-posting.md)): the engine plans and writes the rows (dry-run reviewed first). Images: one row per variant. Videos: one row per finished video across the per-actor finished subfolders - one card can yield ~10 rows.
5. **Verify, then complete the card.** A card only moves to `✅ Posted To Sheet` (status resolved from the card's live list statuses - never a hardcoded string) when 02's verification passes end-to-end: every finished deliverable has a row, every link resolves and is shared, every preview actually rendered. Anything short stays `📤 ready to post` with an exact report of what's missing - a partially-intaked card must never be completed, because that would hide the un-added ads.
6. **Copy + scan follow immediately**: ad copy ([03](03-ad-copy.md)) runs on the new rows, then the compliance scan ([08](08-compliance-scan.md)) stamps col B. A fresh row is never left copy-less or verdict-less.
7. **Report to the orchestrator**: cards intaken/completed/flagged with reasons. Proactive reports go to the orchestrator only; Adam's direct pings get brief operational answers with the orchestrator notified.

## Related

- [02-sheet-posting.md](02-sheet-posting.md) - the sheet-write half of intake
- Daily reconcile sweep: backfills Writer/Designer cells once the team assigns flagged cards (fills blanks only, never overwrites)
