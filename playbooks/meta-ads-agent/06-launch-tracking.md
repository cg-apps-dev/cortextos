---
type: playbook
agent: meta-ads-agent
process: launch-tracking
status: active
date: 2026-07-05
pipeline_stage: 4 (track)
tags: [playbook, meta-ads, admanage, tracking]
---

# 06 - Launch Tracking

After Adam publishes a draft, this stage syncs the fact back to the sheet: it pulls recent launches from AdManage's activity log and stamps each ad's launch date into the correct per-account tracking cell. Autonomous; write-once (never overwrites an existing stamp).

Derived from: [brain: agents/meta-ads-agent/ad-launch-tracker-agent/SKILL.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/ad-launch-tracker-agent/SKILL.md) (module absorbed into meta-ads-agent 2026-06-02).

## Hard rules

1. **Resolve all columns by live header name, every run** (hard gate, step zero) - the account-to-column map is name-based, never hardcoded letters.
2. **Write-once fields**: a stamped launch date is never overwritten; only status fields refresh.
3. **"Launched" comes from AdManage's activity log**, never inferred from a sheet cell.
4. **Ad rejection alert rule (Adam, 2026-07-03, HARDCODED)**: any ad found DISAPPROVED - sandbox or prospecting - is stamped on the sheet AND pinged to Adam immediately, every sweep.
5. **Direct-launch scan gate**: ads Adam launched directly (bypassing the sheet pipeline) get flagged for a creative/VO compliance scan - a copy-PASS stamp is not creative clearance.

## The sequence

1. **Resolve columns from live headers** (halt on mismatch).
2. **Pull recent launches** from the AdManage activity log; resolve per-ad names via batch status.
3. **Match ads to sheet rows** by composite key (launch-date + ID token + variant + hook signals - the ad name is the primary join key, matched verbatim).
4. **Read the current per-account cell values**, then write the combined tracking cell (launch date + status), write-once semantics.
5. **Run the direct-launch scan gate** on any launched ad that never went through the sheet gate.
6. **Report**: updates by account, unmatched ads, pending creative/VO scans, and any DO-NOT-UNPAUSE items. Rejections ping Adam immediately per the standing rule.

## Notes

- "Still serving?" questions are answered with recent SPEND (query_reports), never effective_status - an ACTIVE status with zero spend means ended.
- UTC/PT date boundaries can off-by-one the match; the composite key tolerates the sheet's re-stamped dates.
