---
type: playbook
agent: meta-ads-agent
executing_owner: meta-media-buyer-agent
process: adset-batch
pipeline_stage: 3B (launch - draft only, human-gated)
status: active
date: 2026-07-05
tags: [playbook, meta-ads, admanage, adset, draft-only, human-gated]
---

# 05 - Ad-Set Batch (DRAFT ONLY - human-gated)

> **Executing owner: meta-media-buyer-agent.** Lives under meta-ads-agent for pipeline browsability (Adam's call, 2026-07-05); run by meta-media-buyer-agent in the live fleet, manual-trigger only. mmb's own folder cross-links here.

Groups ~10 compatible ads (one customer avatar, same landing page, TOF/MOF/BOF mix, image + video) into one operator-designated broad ad set, staged as a single AdManage draft. Same absolute gate as [04](04-launch-draft.md): draft only, Adam publishes.

Derived from: [brain: agents/meta-ads-agent/skills/adset-batch/SKILL.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/skills/adset-batch/SKILL.md) (whose own title already says PLAYBOOK - this doc is its plain-English distillation; the skill remains the executable spec).

## Why ~10 ads, one avatar, broad

Meta's delivery optimizes creative-vs-audience inside the ad set: a broad ad set with one avatar's creative pack lets the algorithm find the audience per creative instead of fragmenting learning across micro-audiences. Eligibility = ads not yet in the target account.

## Hard rules

1. **Draft only, human-gated** - identical tool exclusions to [04](04-launch-draft.md).
2. **Never bundle a dead card**: ClickUp status guard per candidate (killed/removed cards are out).
3. **Rejection guard, block-where-failed**: a creative DISAPPROVED in an account is never re-bundled into THAT account (other accounts stay eligible).
4. **Three distinct compliance gates per bundle**: per-ad copy compliance, the Meta-POLICY pre-flight, and the M-19f cannabis-coding AGGREGATE gate (a bundle can fail collectively on coded signals even when each ad passes alone).
5. **Selection is recorded structurally**: the `Ad Set Group` column stamps which bundle each row joined (anti-clobber - set-once).
6. **Duplication rule** (fleet): new ad sets duplicate from the most recent PROSPECTING ad set, named Pack N+1 + DSCA + hp + lp + date.

## The sequence

1. **Resolve the holder ad set** - operator-directed (either an existing pre-created ad set is named, or one is duplicated per the duplication rule).
2. **Auto-propose bundles from the sheet**: filter launch-ready rows by the grouping key (avatar, LP, funnel mix, actor-age bracket from intake's vision pass - NO-ACTOR rows are wildcards).
3. **Run the guards**: ClickUp status, per-account rejection history, then the three compliance gates.
4. **Stamp the `Ad Set Group` column** for the selected rows. DONE-WHEN: a re-read shows the stamp on exactly the selected rows and no pre-existing stamp was overwritten (set-once held).
5. **Assemble ONE draft per bundle** and create it (same assembly conventions as [04](04-launch-draft.md)). DONE-WHEN: the created draft re-fetches with ad-count = bundle size, and the run report records all guard results (ClickUp status, rejection history, the three compliance gates) per bundled ad.
6. **Hand off + STOP**: report the staged draft with its bundle composition; Adam reviews and publishes.
