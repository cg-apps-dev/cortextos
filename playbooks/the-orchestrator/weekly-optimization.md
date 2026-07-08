---
type: playbook
agent: the-orchestrator
process: weekly-optimization
status: active
date: 2026-07-07
tags: [playbook, orchestrator, optimization, cost, tokens]
---

# Weekly Optimization

A weekly fleet audit to cut per-turn context (the cache-read cost driver, ~88% of spend at the 2026-06 root-cause) without losing high-signal info. Runs Sunday after the [weekly review](weekly-review.md). Derived from `.claude/skills/weekly-optimization/SKILL.md`.

> Note: the skill references its own cron, but no `weekly-optimization` cron is in the live set (only `weekly-review`) - in practice it runs Sunday right after the weekly review. Flagged for cadence accuracy.

## The four levers

- **A. Bash output compaction (RTK-AI)** - a one-time dev adoption, then a maintenance check that the rollout is still wired and winning. Code side = the dev pair.
- **B. Skill audit (per agent)** - detect unused skills and over-long frontmatter descriptions (loaded every session); trim each agent to its lean role set (heavy roles target ~12-15 skills, down from 24-29).
- **C. Cron audit (per agent)** - flag any agent with >5 crons or any cron firing more than hourly without need; cut/merge/space-out, lighten prompts, consolidate overlapping reviews.
- **D. Doc + memory audit (per agent)** - daily memory files >~30KB get archived to memory/archive/; dedupe MEMORY.md; trim CLAUDE/AGENTS. Each agent self-audits its OWN docs/memory on the same cron to spread load; the orchestrator verifies.

## Cadence + gating

- Run B/C/D every week; lever A is one-time-then-maintenance.
- Measurement ties to the daily cost-snapshot; record the week-over-week token delta in the report.
- Gating: Lever D on an agent's own files = zero-risk, no approval. Levers B + C fleet-wide = orchestrator applies (config-style), inform Adam. Lever A + any daemon code = dev task, build+validate only, no deploy without Adam's go.

## Hand-offs

Orchestrator runs B/C/D + writes the report; each agent self-audits its own Lever D; the dev pair handles code-side (Lever A) with review + Adam go.
