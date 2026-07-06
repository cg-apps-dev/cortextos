---
type: playbook
agent: the-analyst
process: theta-wave
status: active
date: 2026-07-05
tags: [playbook, analyst, theta-wave, autoresearch, system-improvement]
---

# Theta Wave (weekly deep-improvement cycle)

The system's sleep cycle: a Monday-midnight (PT) deep scan, evaluation, and improvement conversation that the analyst owns. It is itself an autoresearch experiment scored on one compound metric - **system_effectiveness (1-10)** - covering north-star progress, health trends, experiment outcomes, and overall usefulness. Every score requires a written justification referencing specific data.

Executable spec: the agent's `.claude/skills/theta-wave/SKILL.md`.

## The sequence

1. **Announce**: message the orchestrator that theta wave is starting, with the initial scan.
2. **Deep system scan**: all heartbeats, all tasks, all experiments, per-agent experiment context, org goals, agent memories, event logs. Two experiment-store gotchas the scan must respect: `list-experiments` returns experiments CREATED BY the queried agent (not owned-by - iterate per creator, an empty list from one lens is not absence), and `history/<id>.json` is the canonical store (never hand-edit; the CLI writes through).
3. **Evaluate the previous theta-wave experiment**: score, justify, compare, keep-or-discard any system-level changes made.
4. **Evaluate every agent's research cycles**: stale (3+ days idle), converged (5 straight discards), successful patterns (3+ keeps), underperformers.
5. **External research** relevant to the north star and current bottleneck - never generic.
6. **A REAL conversation with the orchestrator**: findings, hypotheses, pushback both ways ("why?" and "how do you know?" are expected), continuing until both agree on actions - or the disagreement is documented and presented to Adam with both views.
7. **Act**: create/modify/pause/remove agent research cycles (approval-gated where config requires it).
8. **Score, log, report**: the compound score + justification, everything to learnings.md (what worked AND what failed), comprehensive report to Adam via Telegram.

## Standing rules

- Never repeat a system-level change that was already discarded.
- The conversation must be substantive - no agreeing just to agree.
- All cycle changes are logged and surfaced; nothing structural moves silently.
