---
type: plugin
tags: [plugin, agent, copywriter, meta, facebook, ad-copy, automation]
status: active
department: Creative
date: 2026-05-19
---

# Meta Ad Copy Agent

Automated Meta ad copy generation for Clean Green's Google Sheets pipeline. Reads empty rows across four product-specific tabs (Images/Videos × Flower/Sleep Gummies), downloads each row's creative asset via Composio MCP, generates 5 headlines + 5 body variations per row, enforces compliance via the meta-compliance-agent (reads its rules, scans as a hard pre-write gate), and writes only the 10 approved copy cells back to the sheet.

> **MVP staging note (2026-05-12):** this folder is the pre-PR staging copy. Final location will be `agents/meta-ad-copy-agent/` in the [clean-green-marketing-brain](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain) repo. Relative links in these files assume the post-PR location.

## Overview

The agent writes Meta-bound ad copy at scale. It is **not** an auditor - it **defers all compliance to the [meta-compliance-agent](../../meta-compliance-agent/)**, which owns the canonical M-code rules. As of 2026-06-08 this pipeline keeps **no** compliance rules of its own: it reads the agent's [`rules.md`](../../meta-compliance-agent/references/rules.md) at generation time and runs the agent's scan as a hard pre-write gate (generate → scan → fix on FAIL → write on PASS). See [`references/compliance.md`](references/compliance.md).

The agent reads from Google Sheets, downloads images from Google Drive, and fetches video briefs from ClickUp - all via the Composio MCP server.

## Scope

The agent **only** processes rows in the four tabs of the configured spreadsheet:

| Tab name | `product_category` | Asset source |
|----------|--------------------|--------------|
| `IMAGES (Flower)` | `flower` | The image itself (Drive URL in column N) |
| `VIDEOS (Flower)` | `flower` | ClickUp brief (Card ID in column I) |
| `IMAGES (Sleep Gummies)` | `gummies:deep-sleep` | The image itself (Drive URL in column N) |
| `VIDEOS (Sleep Gummies)` | `gummies:deep-sleep` | ClickUp brief (Card ID in column I) |

**Out of scope** (the agent will skip or block):

- Any row where the 10 copy cells are already populated (unless explicitly asked to overwrite)
- Any row with no asset link (column N empty for images, column I empty for videos)
- Any row where the asset visibly contradicts the tab's declared product
- Anything outside the four named tabs

## How to invoke

| Mode | Trigger | Caller |
|---|---|---|
| Interactive (MVP) | Operator messages the agent in Claude Console | Operator |
| Dry-run | Operator includes `dry-run` in the kickoff message | Operator |
| Scheduled (future) | Cron via GitHub Actions, once weekly | Automated - not yet wired |

## MVP testing

The `Spreadsheet ID` constant at the top of [`SKILL.md`](SKILL.md) is set to the **MVP test sheet** `19DF4aGQzDNL3Xt_Au_7V537OeMu22JCB9Fj7rFfc1VY` - a duplicate of the production sheet. SKILL.md also contains a hard block: the agent refuses to call any Sheets tool against the production sheet ID during MVP.

Test flow:

1. **Confirm the test sheet has empty rows.** Clear the copy cells (Q:Z for image tabs, U:AD for video tabs) on a handful of rows so the agent has empty rows to fill.
2. **Push SKILL.md to the agent's `system` field.** Once the agent exists (created by the setup script we'll write next), the system prompt is the concatenation of SKILL.md + references. For first MVP run, the operator can paste the SKILL.md content into the Console agent definition manually or run a small `update_agent.py`.
3. **First run: include `dry-run` in the kickoff message.** The agent generates the 10 cells per row, runs the meta-compliance-agent scan, and pastes the output to chat instead of writing to the sheet. Operator inspects output, decides if it's good.
4. **Second run: remove `dry-run`.** Agent writes to the test sheet only. Operator verifies the cells.
5. **Progressive widening:** start with 1 row in `IMAGES (Flower)`, then 3 rows, then 1 row per tab. Only after all four tabs pass on the test sheet → operator swaps the Spreadsheet ID in SKILL.md to production, removes the HARD MVP BLOCK guard, and bumps the agent version. The production sheet ID is intentionally not stored anywhere in this agent's content during MVP.

## Reference Files

| File | Contains |
|---|---|
| [references/brand-voice.md](references/brand-voice.md) | Clean Green's tone, sentence rhythm, signature openers, per-product voice notes, DO/DON'T pairs, TRY20 promo phrasing. |
| [references/compliance.md](references/compliance.md) | How compliance is enforced - defines **no** rules; points at the meta-compliance-agent's `rules.md` and runs the agent's scan as a hard pre-write gate. |
| [references/copy-framework.md](references/copy-framework.md) | 5 headline hook types, 5 body angles, asset-to-copy alignment rules, per-product proof banks, §5.5 visual formatting contract. |
| [references/manual-copy-gen.md](references/manual-copy-gen.md) | 3-style framework (Long Form / Review Style / Short Form) for manual batches. |
| [references/column-maps.md](references/column-maps.md) | Exact column layout for the four tabs. Hard write boundary (Q:Z for images, U:AD for videos). |

## Dependencies

- **Composio MCP** - Google Sheets read+write, Google Drive download, ClickUp task fetch
  - `GOOGLESHEETS_BATCH_GET`, `GOOGLESHEETS_UPDATE_VALUES_BATCH`
  - `GOOGLEDRIVE_DOWNLOAD_FILE`
  - `CLICKUP_GET_TASK` (account alias: `clean-green`)
- **Agent toolset** - `read` (native vision for image OCR), `bash` (rarely used), `grep`, `glob`
- **Marketing Brain repo (mounted)** - the agent reads `references/*.md` from `/workspace/repo/agents/meta-ad-copy-agent/references/` at session start

## Pipeline Position

```
sheet rows → meta-ad-copy-agent → meta-compliance-agent scan (pre-write gate) → 10 cells per row → sheet
                       ↑
        Composio MCP (Sheets, Drive, ClickUp)
```

The agent runs end-to-end without a separate writing agent. Compliance is delegated to the meta-compliance-agent (its rules + its scan as a pre-write gate) - this pipeline holds no compliance rules of its own.

## Managed Agent infrastructure

| Resource | Name / ID | Notes |
|---|---|---|
| Agent | TBD - created during MVP setup | New agent, separate from Creative Performance Agent |
| Environment | `env_01SSKG9vvvbeUb3tzSa8PMTt` | Reused from Creative Performance Agent (networking: unrestricted) |
| Vault | **Clean Green Marketing** (existing) | Composio MCP credential lives here. Same vault the operator already uses for Composio access. |
| Test spreadsheet | `19DF4aGQzDNL3Xt_Au_7V537OeMu22JCB9Fj7rFfc1VY` | MVP test sheet, duplicated from production. Hardcoded in SKILL.md. The production sheet ID is intentionally not stored in this agent's content during MVP. |

## Related

- [`brand/compliance.md`](../../../brand/compliance.md) - universal banned-word list and visual-compliance rules (human-gated)
- [`agents/meta-compliance-agent/`](../../meta-compliance-agent/) - **the single source of truth for this agent's compliance.** The copy generator reads its `rules.md` and runs its scan as a hard pre-write gate (as of 2026-06-08; previously the rules were duplicated inline and drifted).
- [`agents/conventions.md`](../../conventions.md) - fleet governance (PR flow, scope boundaries, human-gated paths)
- Source plugin (pre-managed-agent): `Plugins Sandbox/Rodrigo - Meta Ad Copywriter/Meta Ad Copywriter - agent/compliance-rewrite-2026-05-02/plugin-v0.7.0-staging/`
