---
type: agent
status: active
date: 2026-06-02
tags: [agent, meta, ads, pipeline, clickup, admanage, google-sheets, conductor]
---

# The Meta Ad Launch Agent

_(system id: `meta-ads-agent` - unchanged)_

The conductor of Clean Green's Meta ads upload-to-launch pipeline. It moves a creative from a finished ClickUp card all the way to a launch-ready Meta draft - and stamps the result back - by running four stages in order on the **META Ad Upload Sheet**. Two of the four stages are existing, proven agents it orchestrates as self-contained sub-modules; two are new skills it owns.

> **The launch gate is the whole point.** This agent NEVER publishes an ad. Its launch stage stops at creating an AdManage **draft**. The operator reviews the draft in AdManage and clicks publish - that human action is the only thing that pushes anything live to Meta. See [skills/launch/SKILL.md](skills/launch/SKILL.md).

## The Pipeline

| Stage | What | Handled by | Autonomy |
|-------|------|------------|----------|
| 1. Intake | Pull `📤 Ready to Post` cards from ClickUp → write each as a row on the correct sheet tab (ad name, Drive URL, Card ID, all required columns) | [skills/clickup-intake/SKILL.md](skills/clickup-intake/SKILL.md) **(new)** | Autonomous |
| 2. Copy | Read each new row's asset → write 5 headlines + 5 bodies + Customer Avatar + Funnel Stage, with 3-pass compliance | [meta-ad-copy-agent/](meta-ad-copy-agent/) **(module)** | Autonomous |
| 3. Launch | Read copy-complete rows → create an AdManage **draft** to the right account → hand the operator the draft link. **Stops there.** | [skills/launch/SKILL.md](skills/launch/SKILL.md) **(new)** | **Human-gated** (operator publishes the draft in AdManage) |
| 4. Track | Pull successful launches from AdManage → stamp the launch date into the correct account column (never overwrites) | [ad-launch-tracker-agent/](ad-launch-tracker-agent/) **(module)** | Autonomous |
| 5. Upkeep | Report which ads are in which accounts; flag rows stuck (no asset / no copy / drafted-not-launched / launched-not-stamped) | [skills/analysis/SKILL.md](skills/analysis/SKILL.md) **(new)** | Autonomous |

## Why it is one agent with sub-modules

Adam's directive (2026-06-02): absorb the existing **Meta Ad Copy Agent** and **Ad Launch Tracker Agent** into this one agent, but keep each as a single self-contained folder so that when either is updated, all of its files are in one place. They live here as [meta-ad-copy-agent/](meta-ad-copy-agent/) and [ad-launch-tracker-agent/](ad-launch-tracker-agent/) - moved intact, nothing scattered. The two new skills (intake, launch) and the upkeep skill live under [skills/](skills/). The conductor (this README) defines the order and the hand-offs; each module/skill remains independently runnable.

## The Sheet (shared config)

- **Spreadsheet ID:** `1tFAR0ecVBZlMwyV18hfaoC4AAyN5TtyZBVw4r2IMcME` - "META - Ad Upload Sheet"
- **Four product tabs:** `IMAGES (Flower)`, `VIDEOS (Flower)`, `IMAGES (Sleep Gummies)`, `VIDEOS (Sleep Gummies)`
- Per-tab column maps live in [meta-ad-copy-agent/references/column-maps.md](meta-ad-copy-agent/references/column-maps.md) (the single source of truth for sheet columns - intake and launch both read it, never hardcode a second copy).
- Account → tracking-column map lives in [ad-launch-tracker-agent/SKILL.md](ad-launch-tracker-agent/SKILL.md).

## How it runs

- Stages 1, 2, 4, 5 run autonomously (scheduled or operator-triggered).
- Stage 3 (launch) prepares an AdManage draft and **waits** - the operator reviews and publishes in AdManage. The agent has no path to publish; `launch_draft` / `launch_ads` are not in its toolset for this stage.
- Schedule + runner wiring: see the cortextOS runner config (the local agent pulls these skills LIVE from this repo each run - it does not cache them, per the standing "read the brain live" rule).

## Compliance

Copy compliance is enforced inline by the copywriter module (3-pass stack); the separate [meta-compliance-agent](../meta-compliance-agent/) is the auditor. The launch stage only drafts rows whose copy cells are populated (i.e. already compliance-passed by Stage 2). Banned terms and offer strings are governed by `brand/compliance.md` and `brand/offers.md` (human-gated).

## Tools

- **ClickUp MCP** (intake): filter Ready-to-Post cards, read fields.
- **Composio Google Sheets MCP** (intake / launch / upkeep / copy): read + write cells.
- **AdManage MCP** (launch / track): `create_draft` (launch - draft only), `list_activity_log` / `get_activity_log_details` / `get_batch_status` (track). `launch_draft` and `launch_ads` are intentionally excluded from the launch stage.

## Skills & modules

- [skills/clickup-intake/SKILL.md](skills/clickup-intake/SKILL.md) - Stage 1 (new)
- [meta-ad-copy-agent/](meta-ad-copy-agent/) - Stage 2 (module)
- [skills/launch/SKILL.md](skills/launch/SKILL.md) - Stage 3, draft-only, human-gated (new)
- [skills/adset-batch/SKILL.md](skills/adset-batch/SKILL.md) - Stage 3B: group ~10 ads (one avatar, same LP, TOF/MOF/BOF, image+video) → one operator-pre-created broad ad set as a draft; draft-only, human-gated; eligibility = not-yet-in-the-target-account (new)
- [ad-launch-tracker-agent/](ad-launch-tracker-agent/) - Stage 4 (module)
- [skills/analysis/SKILL.md](skills/analysis/SKILL.md) - Stage 5 (new)
