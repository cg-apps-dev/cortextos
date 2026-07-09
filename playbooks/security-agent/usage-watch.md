---
type: playbook
agent: security-agent
process: usage-watch
status: active
date: 2026-07-09
tags: [playbook, security, usage, billing, escalation]
---

# Usage Watch (per-heartbeat)

A human-judgment layer over the zero-model usage monitors, run as a standing section of every heartbeat cycle. Exists because the delivered auto-alert (`USAGE_ALERT_7D_PCT = 60`, launchd `check-all-usage`, 5-min interval) is EDGE-triggered - it fires once on the way up through 60% and then stays quiet. Any judgment above that line (a meter-OFF account accelerating toward a hard cap, an idle account suddenly burning) has no fresh auto-ping; the heartbeat read is the detector.

## The read, every heartbeat

1. Pull current per-account utilization (5h + 7d) and meter state.
2. For each account, judge against its risk shape: **meter-OFF = hard-stop risk** (the watch that matters); metered = safety-valve engaged, won't hard-stop (not this agent's alert).
3. Watch RATE, not just level - an accelerating 7d on the fleet's runtime account is the early signal (e.g. 7d 38 -> 44 in ~2h flags before any threshold does).

## Escalation

- Rising toward ~55% 7d on a meter-OFF runtime account, or a sustained-high 5h: escalate to the-orchestrator for rebalance (the orchestrator owns account moves; this agent detects and triages, it does not move agents).
- Anomalies on Adam's personal metered seat: note, don't alarm - the meter being ON is deliberate (the valve); RISING is the signal, not enabled.

## Boundary (ownership, known-fuzzy)

Detection/triage = this agent. Account moves = the-orchestrator. Trend monitoring = the-analyst. Prevention ownership is a flagged open item (deep-dive decision D5, with Adam via the orchestrator).
