---
type: index
agent: codex-dev-agent
status: active
date: 2026-07-07
---

# Codex Dev Agent - Playbooks

The implementation half of the dev pair. Implements the SPEC claude-dev writes, writes/updates tests, runs validation, and reports back. Does not git add or commit - claude-dev commits and routes the PR. Runs on codex-app-server.

| Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|
| [implementation-partner.md](implementation-partner.md) | SPEC intake -> critique/converge -> implement/test -> handoff | Per SPEC hand-off from claude-dev | Executes agreed plan; never commits |

The shared pairing protocol lives in [claude-dev-agent/dev-pairing-contract.md](../claude-dev-agent/dev-pairing-contract.md). Live crons verified 2026-07-07 via `cortextos bus list-crons codex-dev-agent` (heartbeat + inbox-sweep + coding-task-monitor + pending-task-review - operational task-tracking, not distinct processes).
