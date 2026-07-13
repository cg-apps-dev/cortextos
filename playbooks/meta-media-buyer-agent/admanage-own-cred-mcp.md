---
type: playbook
agent: meta-media-buyer-agent
status: active
date: 2026-07-13
---

# AdManage Own-Credential MCP

AdManage runs as a local stdio MCP server so mmb can use the AdManage REST API without the claude.ai connector. Auth comes from `ADMANAGE_API_KEY` in org `secrets.env`; do not put the key in `.claude.json` or MCP args.

Registration shape:

```json
{
  "mcpServers": {
    "admanage": {
      "type": "stdio",
      "command": "node",
      "args": ["<repo-root>/dist/mcp/admanage.js"],
      "env": {}
    }
  }
}
```

`<repo-root>` is the absolute path to the framework checkout (on this instance it resolves under `$CTX_FRAMEWORK_ROOT`); the live `.claude.json` registration uses the real absolute path, since stdio `args` are literal and not env-expanded.

The server exposes read-only tools in this build:

- `admanage_list_ad_accounts`
- `admanage_list_ads`
- `admanage_list_drafts`
- `admanage_get_report_fields`
- `admanage_query_reports`
- `admanage_daily_spend`
- `admanage_list_changes`
- `admanage_get_batch_status`

The base URL is hardcoded to `https://api.admanage.ai/v1/`. Do not point this at `admanage.ai/api/` or the web-session login API.
