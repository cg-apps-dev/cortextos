# Meta Ad Copy Agent

Before editing anything in this directory, load:
- [`agents/conventions.md`](../../conventions.md) — the fleet rulebook (PR flow, scope boundaries, human-gated paths)
- [`playbooks/engineering/principles.md`](../../../playbooks/engineering/principles.md)
- [`playbooks/engineering/agents.md`](../../../playbooks/engineering/agents.md)

> **MVP staging note (2026-05-12):** these files were drafted in `Plugins Sandbox/Patrick - Analytics Analyst/meta ads copywriter agent/` for review before being PR'd into the marketing-brain repo at `agents/meta-ad-copy-agent/`. The relative links above assume the post-PR location.

## Scope rule (read before invoking)

This agent generates Meta ad copy by reading rows from a Google Sheet, downloading each row's creative asset (image via Composio Drive, video brief via Composio ClickUp), running the **meta-compliance-agent scan as a hard pre-write gate** (compliance is single-sourced from the [meta-compliance-agent](../../meta-compliance-agent/) — this pipeline defines no rules of its own), and writing 10 cells per row back to the sheet. It writes only the 10 copy columns — never status, cache, or any other helper field.

**For MVP testing, the `Spreadsheet ID` constant in `SKILL.md` is set to `19DF4aGQzDNL3Xt_Au_7V537OeMu22JCB9Fj7rFfc1VY` (the MVP test sheet, duplicated from production). SKILL.md contains a HARD MVP BLOCK: the agent refuses any Sheets call with a `spreadsheet_id` other than this one. The production sheet ID is intentionally not documented anywhere in the agent's content. Production cutover requires editing the constant + removing the block + bumping the agent version, and is performed by the operator outside the agent.**
