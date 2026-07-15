---
type: index
agent: research-agent
status: active
date: 2026-07-15
---

# research-agent - Playbooks (coverage stub)

Deep-research specialist for the Clean Green marketing org: produces competitor, market, and product intelligence and delivers every finding as a standalone cited document ingested to the shared org KB (not just a chat reply). Persistent Telegram agent at `orgs/clean-green-marketing/agents/research-agent/` (gitignored runtime state). New agent, enabled 2026-07-14; reports to the-orchestrator.

## Status: onboarding-settled, research workflow forming - process playbook deferred

Per the settled-only rule (a playbook documents a settled live process; pinning a moving target goes stale immediately):

**Settled** (its operating model, confirmed at onboarding):
- On-demand only: idle-by-default, no self-initiated research; runs on orchestrator-routed demand or a direct Adam ask (no recurring process cron - heartbeat only, verified via `list-crons` 2026-07-15).
- Deliverable contract: every research output is a standalone CITED DOCUMENT ingested to the `shared-clean-green-marketing` KB, never just a chat reply.
- Sourcing discipline: query the KB first (KB FINDS), read the live brain repo for authority (REPO IS TRUTH, never cache authoritative sources), disconfirm before asserting causation, least-privilege (untrusted-web ingestion sandboxed, approvals for external actions).

**Forming** (playbook lands when it settles):
- The research-brief-as-document WORKFLOW itself - its GOALS.md Goal 3 ("run first research task on org demand and deliver as a document") has not yet run. The step-by-step process (intake a research ask -> KB-first check -> live-source gather -> disconfirm pass -> cited-document assembly -> KB ingest -> deliver) is defined in principle but not yet exercised or proven stable, so it is not documented as a process here.

**Trigger to expand this stub into a process playbook:** the first cited research document delivered end-to-end + the workflow exercised enough to be stable. Per the DoD standing rule, research-agent flags the-sop-keeper (via the-orchestrator) when that lands.
