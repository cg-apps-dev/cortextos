---
type: playbook
agent: meta-ads-agent
process: upkeep-analysis
status: active
date: 2026-07-05
pipeline_stage: 5 (upkeep)
tags: [playbook, meta-ads, analysis, upkeep]
---

# 07 - Upkeep & Analysis

Keeps the upload sheet honest and answers "which ads are live in which accounts, and what is stuck?" Read-only against creative/copy - it diagnoses, it never launches or rewrites.

Derived from: [brain: agents/meta-ads-agent/skills/analysis/SKILL.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/skills/analysis/SKILL.md).

## What it reports

1. **Coverage by account**: per account, how many ads launched and the latest launch date (read from the Stage-4 tracking columns).
2. **Stuck rows** - each row sitting between stages, with its state:
   - No asset (intake incomplete or dead Drive link)
   - No copy (Stage 2 hasn't run or failed)
   - Copy-ready, not drafted (Stage 3 hasn't run)
   - Drafted, not launched (waiting on Adam's publish)
   - Launched, not stamped (Stage 4 needs a re-run or a name-match failed)
3. **Data hygiene**: wrong-tab products, duplicate ad names on a tab, ad names that won't match AdManage (which would break Stage-4 stamping).

## Hard rules

1. **Read-only on creative/copy.** Where a fix is mechanical and belongs to another stage, the report says so ("a Stage-4 re-run stamps these 3") - it never performs it here.
2. **Cross-check, don't assume**: "launched" is confirmed against AdManage's activity log and drafts list, never a sheet cell alone.
3. **Light reads**: batched sheet gets; heavy per-row reads 502 under load.

## Output

One report per run - coverage table, stuck-row table with suggested actions, hygiene flags - sent to the operator and/or the orchestrator.
