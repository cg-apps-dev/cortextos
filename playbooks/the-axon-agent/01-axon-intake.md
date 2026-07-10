---
type: playbook
agent: the-axon-agent
process: axon-intake
pipeline_stage: 1 (intake - Axon)
status: active
date: 2026-07-08
tags: [playbook, axon, applovin, clickup, intake, sheet]
---

# 01 - Axon Intake

Every finished Axon/AppLovin creative gets pulled from ClickUp, parsed, and written as a row on the **Axon Ads Upload Sheet** - one row per actor + variant + hook + text ad. Draft-only: the runner writes the sheet and nothing else, it never launches an ad or changes a card's status. This is a fork-and-invert of the Meta intake engine ([meta-ads-agent/01-clickup-intake.md](../meta-ads-agent/01-clickup-intake.md)), adapted for Axon's 9x16-only, disclaimer-tolerant world.

Derived from the executing spec: `skills/axon-intake/SKILL.md` in the agent's local (untracked) skills dir. Engine: `engine.py` (gog-backed, deterministic, Codex-reviewed base + Axon fork); card resolver: `resolve_cards.py`; all-boards sweep: `scan_all_boards.py`. The skill files stay the technical spec the agent executes - this is the readable sequence.

## The sheet

- Sheet: `1uZJwqqfve7ujCTRdrP3G7Lv1GVccuiv9cxHXhDLAaRg`. **Product-routed tabs**: flower creatives -> `VIDEOS (Flower)`, gummies creatives -> the Sleep Gummies tab (the sweep detects both and routes by product - e.g. a recent sweep: 71 Axon creatives -> 69 flower / 2 gummies). Intake is NOT flower-only; the cron prompt's "Flower gate" describes the dominant path, the SCRIPT is the authoritative behavior.
- The agent is the **sole writer** on this sheet.
- 11 columns, header-resolved: Preview (=IMAGE 9x16 thumb) · Added to Sheet · Axon Creative Code (=ClickUp Card ID verbatim) · Concept # (UGC#NN join key) · Variant # · Actor · Hook # · Text # · Designer · ClickUp Card ID · 9x16.

## Hard rules (do not violate)

1. **Header-resolve every read/write** (Adam, 2026-07-06). The engine resolves each column by its row-1 header name via `_headers()`, never a fixed letter. Only `9x16`, `Variant #`, `ClickUp Card ID` are REQUIRED; every other column is written only if its header is present. Columns can be deleted, added, or reordered by hand and intake never breaks - a re-added column just repopulates on the next run.
2. **9x16-only.** Axon is 9x16 vertical only. No 4x5, no 1x1 - a non-9x16 asset is not an Axon ad.
3. **Draft-safe / no-launch.** Sheet only. Never touch live AppLovin or Meta ads, never change a ClickUp card status.
4. **File-ID dedup + anti-clobber append.** Re-running is always safe: the engine dedups on Drive file-ids, appends below existing rows, and floors the start-row at 2. A re-run adds only genuinely new creatives.
5. **Render-gate on the 9x16 thumbnailLink.** `rendered=False` means Drive has not built the async poster yet - it is NOT a broken asset. Do not force-complete; re-check on a later run.
6. **No silent drops.** An unparseable filename or an empty creative folder is FLAGGED in the run status, never dropped quietly.

## Axon-specific parsing

- **Prefix-agnostic match** anchored on `V## - <Actor?> - Hook <h> - <ratio?>`. Real filenames vary widely: `AXON UGC #33 - V01 - Helen - Hook 7 - Text 2 - 9x16.mp4`, `UGC #119 - V01 - Raymond - Hook 1 - 9x16 Disclaimer.mp4`, `UGC-33676 - V02 - Edward B. - Hook 2 - 9x16 disclaimer.mp4`, plus actor-name testimonials.
- **Concept comes from the CARD NAME, not the filename.** `UGC #NN` is pulled off the card title (the filename number is unreliable) and passed as the join key. An actor-name card with no UGC number gets a blank Concept #.
- **Text axis = distinct rows.** Multiple text overlays on the same hook are separate rows (row key = actor, variant, hook, text). An absent Text value stays a blank cell - never defaulted to 1.
- **Ratio optional.** A file that omits `9x16` in its name is defaulted to 9x16 (Axon is 9x16-only).
- **Disclaimer-tolerant tail.** Axon burns a cannabis disclaimer, often as a filename suffix (`...9x16 Disclaimer.mp4`). The parser's tail eats a trailing `disclaimer`, stray hyphens/spaces, and `(1)` duplicate markers.

## The sequence

1. **Precondition check** (fail-fast): import the engine and confirm gog Sheets + Drive and ClickUp REST all work. Any failure -> tell the orchestrator, change nothing, stop.
2. **Pull fresh** (never a cached list). The standing daily path (cron `axon-daily-sweep`, 6:30am PT, verified live 2026-07-10) is the ALL-BOARDS scan: `scan_all_boards.py` sweeps Video Ads + Pod 1/2 UGC + Pod 3 Axon and detects Axon creatives by the `axon|disclaimer` FILE-SIGNAL gate and routes by PRODUCT to the matching sheet tab - flower to `VIDEOS (Flower)`, gummies to the Sleep Gummies tab (not by which board a card sits on - Axon ads land on any production board), dedup-safe append, throttled with 429-retry, quiet if 0 new, pings the-ad-strategist only when new creatives land. A targeted manual run may still pull a single list (Pod-3-Axon `901712093295`) via ClickUp REST, filtered to done statuses. Note: recently finished Axon ads land in `✅ complete`, not `📤 ready to post`. Confirm the live trigger status before changing the recurring cron.
3. **Per card**: extract the concept number from the card name; call `resolve_cards.resolve(id)` for designer / writer / folder; call `intake_video_card(...)` with `axon_code=<CardID>`, `concept=<n>`, `dry_run=True`.
4. **Eyeball the dry-run PLAN** (status, start-row=2 on an empty sheet, row count, dedup result, any unparsed files) BEFORE writing.
5. **Write**: flip `dry_run=False`. Then render-gate - mark a card complete only if `all_ok and rendered`. DONE-WHEN: a post-write re-read matches the dry-run plan (row count + zero duplicate file-ids), and a card completes ONLY on `all_ok and rendered` - anything short stays open with its flag in the run status.
6. **Throttle on batch runs.** Sheets API caps ~60 reads/min/user. A batch run MUST run as a background Python script with `time.sleep(3)` between cards plus a 429-retry wrapper (sleep 30, retry). Foreground shell `sleep` is blocked - use Python's.

## Column ops (add/delete a sheet column)

`gog` has no add/delete-column verb. To restructure the sheet: `gog auth tokens export <email> --out <f>` for an access_token -> Sheets API `spreadsheets.batchUpdate deleteDimension` (order delete ranges HIGH->LOW index) or `values PUT` (RAW) -> then SHRED the token file (`dd` urandom overwrite + `rm`). A brand-new API-created spreadsheet shows `#REF!` in its `=IMAGE` cells until the OWNER clicks "Allow access" once per spreadsheet; tabs added to an already-approved sheet inherit the grant.

## Tools (bearer-safe)

- **ClickUp REST** (token: `orgs/clean-green-marketing/secrets.env` `CLICKUP_API_TOKEN`); `resolve_cards.py` reads it directly.
- **`gog` CLI** as `adam@cleangreen.com` for ALL Sheets + Drive I/O. NOT Composio - bearer auth kills the Composio bridge.

## Downstream

The `Concept #` (UGC#NN) and `Axon Creative Code` columns are the cross-platform **join key** for [the-ad-strategist](../the-ad-strategist/README.md), who joins Axon <-> Meta by UGC concept for the cross-platform synthesis. This intake produces the sheet; the per-creative Axon performance read is a separate analytics workstream - [02-axon-analytics.md](02-axon-analytics.md): the reporting key gives spend + revenue + all-orders at creative_set grain; NC needs the event/store keys (phase 2, gated).

## Related

- [README.md](README.md) - the-axon-agent playbook index
- [meta-ads-agent/01-clickup-intake.md](../meta-ads-agent/01-clickup-intake.md) - the Meta intake this forks from
- Recurring trigger: the daily all-boards sweep (`scan_all_boards.py`), 13:30 UTC (6:30am PT - the cron `30 6 * * *` fires in the agent TZ, America/Los_Angeles), offset +30 min from the Meta 6am PT ingest.
