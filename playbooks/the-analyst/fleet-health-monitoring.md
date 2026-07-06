---
type: playbook
agent: the-analyst
process: fleet-health-monitoring
status: active
date: 2026-07-05
tags: [playbook, analyst, fleet-health, heartbeat, monitoring]
---

# Fleet Health Monitoring (every heartbeat)

Runs inside the analyst's 2-hour heartbeat cycle (note: 2h, tighter than the fleet-default 4h, because this agent is a watcher). Source: the agent's `HEARTBEAT.md` steps 3/3a.

## The checks

1. **Fleet down/silent scan**: `read-all-heartbeats` - flag any agent silent for more than ~5 hours; escalate to the orchestrator at ~8 hours (`agent_unresponsive` event + message). Cross-check in-progress tasks for agents that look active but aren't moving.
2. **Temporary canaries**: time-boxed extra checks for known-fragile spots ride along here (current example: a light meta-media-buyer exposure check while it awaits its own bearer token - only escalates if the agent is down or genuinely dark, cross-checked against the live usage monitor before alerting). Each canary names its removal condition; delete it when the underlying fix lands.
3. **Own hygiene**: stale-task detection, KB ingest verification (check the Errors line BEFORE the chunk count - a silent embed failure with "Ingested 0" is commonly the Gemini free-tier daily embed quota exhausting fleet-wide until the ~midnight-PT reset; flag the orchestrator, don't trust a bare zero as success).

## Escalation discipline

Silent agents may be hung on a TTY prompt or an API rate limit rather than crashed - diagnosis starts at the agent's stdout log, and blast radius gets scoped before any outage call to Adam. The zero-model launchd monitors ([../fleet/zero-model-monitors.md](../fleet/zero-model-monitors.md)) are the primary watch on usage/dependency failures; this heartbeat layer is the fleet-liveness complement.
