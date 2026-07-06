---
type: playbook
agent: meta-ads-agent
executing_owner: meta-media-buyer-agent
process: launch-draft
pipeline_stage: 3 (launch - draft only, human-gated)
status: active
date: 2026-07-05
tags: [playbook, meta-ads, admanage, launch, draft-only, human-gated]
---

# 04 - Launch Draft (DRAFT ONLY - human-gated)

> **Executing owner: meta-media-buyer-agent.** This file lives under meta-ads-agent for pipeline browsability (Adam's call, 2026-07-05), but in the live fleet the sheet-to-AdManage lane is run by meta-media-buyer-agent, manual-trigger only. mmb's own folder cross-links here.

Launch-ready sheet rows are staged as AdManage drafts and handed to Adam with a link. The agent NEVER publishes - `create_draft` is the only launch tool it may call; `launch_draft`/`launch_ads` are excluded by design. Adam clicking publish inside AdManage is the gate, and there is no path around it.

Derived from: [brain: agents/meta-ads-agent/skills/launch/SKILL.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/skills/launch/SKILL.md).

## Hard rules

1. **`create_draft` only. Never publish.** A run ends at "draft created - here is the link."
2. **Complete or nothing.** Only rows with full copy block + avatar + funnel + asset + no prior draft/launch. Skip and log the rest.
3. **Body-compliance gate before drafting** (standing since 2026-06-03): every otherwise-ready row's headlines AND body re-run the 3 compliance passes (testimonial carve-out aware) - the sheet holds legacy rows written before the compliance stack tightened. FAIL = skip + flag for a gated copy fix; the launch path gates, it never edits copy.
4. **Never invent targeting.** Account + ad set come from the operator or a confirmed rule; no rule and no instruction = stop and ask.
5. **Verbatim join keys.** Ad name exactly as the sheet computes it (launch tracking, [06](06-launch-tracking.md), matches on it); media URL exactly as AdManage's Drive resolver returns it.
6. **No duplicate launches** (fleet rule): a row already launched to an account (date column stamped) is never drafted to that account again; every ad `link` uses the `https://www.` prefix.

## The sequence

1. **Find launch-ready rows** on the sheet (copy complete, avatar + funnel set, asset present, not already drafted/launched).
2. **Run the body-compliance gate** on each candidate; drop failures into the run report with the offending terms.
3. **Resolve targeting**: confirm the ad account, select the designated ad set (objective/destination sanity-checked), pull the account's page + Instagram defaults.
4. **Resolve each creative's launchable URL** from its Drive link, passed through unmodified.
5. **Assemble one coherent draft per account/batch** - Advantage+ flexible creative where the objective allows: headline + 4 variations, primary + 4 variations, ad name verbatim, landing page link, CTA.
6. **Create the draft, capture the ID, verify it persisted.**
7. **Hand off and STOP**: report each draft (title, ID, account, ads, review link) + skipped rows with reasons. No polling for publish, no advancing - launch tracking ([06](06-launch-tracking.md)) picks up after Adam publishes.
