---
type: playbook
agent: meta-ads-agent
executing_owner: meta-media-buyer-agent
process: launch-tracking
pipeline_stage: 4 (track)
status: active
date: 2026-07-09
tags: [playbook, meta-ads, admanage, tracking]
---

# 06 - Launch Tracking

After Adam publishes a draft, this stage syncs the fact back to the sheet: it pulls recent launches from AdManage's activity log and stamps each ad's launch date into the correct per-account tracking cell. Autonomous; write-once (never overwrites an existing stamp). Executed by meta-media-buyer-agent (the launch lane's owner), sitting in this folder per the pipeline-browses-in-one-place rule.

## Cadence: watcher fast-path + daily sweep floor

Two complementary layers (verified live 2026-07-09):

- **15-min launchd watcher** `com.cleangreen.meta-media-buyer.launch-tracker-watch` (mmb `scripts/launch-tracker-watch.sh`, zero-model) - the fast path, chasing recently drafted ads within ~48h of drafting.
- **Daily 8am PT sweep** (mmb cron `launch-tracker-sweep`) - the floor and the watcher-died safety net: activity-log read (last 24h), status refresh, and a retro-disapproval re-check of the Active pool. A draft published more than ~48h after drafting falls out of the watcher window and is caught here, max ~24h lag. Complementary windows, not a gap. **Active pool inclusion (Adam/orch, 2026-07-23/24):** any account that transitions WARMING -> ACTIVE (its first live launch) auto-promotes into this pool immediately - never wait for a manual add or a periodic account-list refresh. See [fleet/standing-rules.md](../fleet/standing-rules.md)'s warming-to-active registry row (the JCG2 near-miss).

**Tracker boundary (Adam-decided 2026-06-11)**: the tracker covers AdManage-originated launches only. Meta-UI-duplicated ads/ad sets are NOT stamped or rejection-watched - dup-launch safety for those is covered at draft time by the ad-set batch rejection guard ([05](05-adset-batch.md)). An optional per-account list_ads-vs-sheet diff exists but is OFF (one-line reverse if Adam wants Meta-UI visibility).

Derived from: [brain: agents/meta-ads-agent/ad-launch-tracker-agent/SKILL.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/ad-launch-tracker-agent/SKILL.md) (module absorbed into meta-ads-agent 2026-06-02).

## Hard rules

1. **Resolve all columns by live header name, every run** (hard gate, step zero) - the account-to-column map is name-based, never hardcoded letters.
2. **Write-once fields**: a stamped launch date is never overwritten; only status fields refresh.
3. **"Launched" comes from AdManage's activity log**, never inferred from a sheet cell.
4. **Ad rejection alert rule (Adam, 2026-07-03, HARDCODED)**: any ad found DISAPPROVED - sandbox or prospecting - is stamped on the sheet AND pinged to Adam immediately, every sweep.
5. **Direct-launch scan gate**: ads Adam launched directly (bypassing the sheet pipeline) get flagged for a creative/VO compliance scan - a copy-PASS stamp is not creative clearance.
6. **Match back to the row's own spreadsheet, not always the main sheet** (Adam, 2026-07-21): an ad name matches a row on whichever spreadsheet [01's actor-sheet routing](01-clickup-intake.md#hard-rules) sent it to at intake (main sheet or an actor-specific one) - check the row's origin sheet before concluding "unmatched."

## The sequence

1. **Resolve columns from live headers** (halt on mismatch).
2. **Pull recent launches** from the AdManage activity log; resolve per-ad names via batch status.
3. **Match ads to sheet rows** by composite key (launch-date + ID token + variant + hook signals - the ad name is the primary join key, matched verbatim).
4. **Read the current per-account cell values**, then write the combined tracking cell (launch date + status), write-once semantics. DONE-WHEN: every written cell re-reads back with the intended stamp, and pulled-launches = stamped + unmatched-reported (no silent drops).
5. **Run the direct-launch scan gate** on any launched ad that never went through the sheet gate.
6. **Report**: updates by account, unmatched ads, pending creative/VO scans, and any DO-NOT-UNPAUSE items. Rejections ping Adam immediately per the standing rule. DONE-WHEN: every DISAPPROVED found this sweep has BOTH a sheet stamp (re-read) and a sent Adam ping; a clean sweep states "rejections: 0" explicitly.

## Notes

- "Still serving?" questions are answered with recent SPEND (query_reports), never effective_status - an ACTIVE status with zero spend means ended.
- UTC/PT date boundaries can off-by-one the match; the composite key tolerates the sheet's re-stamped dates.
