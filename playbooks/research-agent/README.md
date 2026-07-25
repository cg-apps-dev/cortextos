---
type: index
agent: research-agent
status: active
date: 2026-07-25
---

# research-agent - Playbooks

Deep-research specialist for the Clean Green marketing org: turns a research ask (Adam-direct or orchestrator-routed) into a single standalone, cited markdown document ingested to the org knowledge base - never just a chat reply. Persistent Telegram agent at `orgs/clean-green-marketing/agents/research-agent/`; on-demand only, no self-initiated research, no recurring process cron (heartbeat only).

| Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|
| [research-brief-as-document.md](research-brief-as-document.md) | Intake a research ask, fan out parallel sub-research, synthesize into a cited brief, ingest to KB, deliver | On-demand: orchestrator-routed or direct Adam ask | Autonomous for the research + document itself; scope-classification (private vs shared) and any external/paid action route through the standing disciplines below |

Expanded from a coverage stub 2026-07-25 once the workflow proved stable (5+ clean end-to-end runs past the stability bar, per the DoD standing rule - research-agent flagged the-sop-keeper via the-orchestrator).
