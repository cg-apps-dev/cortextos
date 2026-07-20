---
type: index
agent: meta-ads-agent
status: active
date: 2026-07-05
---

# Meta Ads Agent - Playbooks

Plain-English SOPs for the Meta ads upload-to-launch pipeline, one per process. Each distills the matching SKILL.md (linked inside) - the skill stays the technical spec agents execute; the playbook is the readable how-and-why. File numbers are browse order; the `pipeline_stage` frontmatter maps each back to the conductor stage table in [brain: agents/meta-ads-agent/README.md](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/README.md).

| # | Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|---|
| 01 | [01-clickup-intake.md](01-clickup-intake.md) | Ready-to-Post ClickUp cards: pull, classify, flag, card lifecycle | launchd ready-check watcher (15 min) + daily 6am PT sweep | Autonomous |
| 02 | [02-sheet-posting.md](02-sheet-posting.md) | Writing rows to the upload sheet: formula rows, previews, sharing, validation | With every intake (01) | Autonomous |
| 03 | [03-ad-copy.md](03-ad-copy.md) | Copy block + avatar + funnel + Ad Description per row, inline 3-pass compliance | Right after intake, every new row + Sun 7am PT full absence-proof (`meta-weekly-copy-scan`) | Autonomous |
| 04 | [04-launch-draft.md](04-launch-draft.md) | Launch-ready rows -> AdManage DRAFT; Adam publishes | Manual trigger only | Human-gated (exec: meta-media-buyer-agent) |
| 05 | [05-adset-batch.md](05-adset-batch.md) | ~10-ad bundle -> one broad ad set as a draft | Manual trigger only | Human-gated (exec: meta-media-buyer-agent) |
| 06 | [06-launch-tracking.md](06-launch-tracking.md) | AdManage activity log -> launch stamps; rejection alerts | launchd launch-tracker-watch (15 min) + daily 8am PT safety-net sweep | Autonomous |
| 07 | [07-upkeep-analysis.md](07-upkeep-analysis.md) | Coverage report + stuck-row and hygiene flags | On demand / periodic | Autonomous |
| 08 | [08-compliance-scan.md](08-compliance-scan.md) | Creative + copy compliance sweep -> col-B verdict stamps | Auto after every intake; on-demand sweeps | Autonomous (stamps only; Adam gates posting) |
| 09 | [09-draft-adset-assembly.md](09-draft-adset-assembly.md) | Curated ad groupings -> Draft Ad Sets tabs (Adam-template clone: chips, blocks, fills); Adam picks LP/Ad Type + posts | On Adam's request | Human-gated (Adam fills chips + posts) |
