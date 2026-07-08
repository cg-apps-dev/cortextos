---
type: index
agent: claude-dev-agent
status: active
date: 2026-07-07
---

# Claude Dev Agent - Playbooks

The planning + review half of the dev pair. Plans all work, writes the specs, reviews every line of the code Codex writes, and runs the final gates before anything ships. Under the standing Codex-first rule, machine code is always reviewed (non-negotiable).

| Playbook | Process | Cadence / trigger | Autonomy |
|---|---|---|---|
| [dev-pairing-contract.md](dev-pairing-contract.md) | The plan -> argue -> execute -> review -> ship contract with codex-dev-agent | Per coding ticket | Low (Adam approves every PR) |
| [upstream-check.md](upstream-check.md) | Daily read-only upstream-update check, notify-only | Cron: daily 7am PT | Autonomous (never applies) |

Live crons verified 2026-07-07 via `cortextos bus list-crons claude-dev-agent`. The dev-pairing contract is shared with [codex-dev-agent](../codex-dev-agent/README.md), which executes the implementation half.
