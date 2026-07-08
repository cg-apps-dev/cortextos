---
type: playbook
agent: the-orchestrator
process: goal-management
status: active
date: 2026-07-07
tags: [playbook, orchestrator, goals, cascade]
---

# Goal Management

The daily goal lifecycle the orchestrator owns: Adam's daily focus flows down into per-agent goals and tasks. Invoked by the [morning review](morning-review.md) (Phase 1 cascade) and the [evening review](evening-review.md) (Phase 5 update). Derived from `.claude/skills/goal-management/SKILL.md`.

## The hierarchy

```
North Star (org-level, rarely changes - set by Adam)
  -> Daily Focus (what Adam wants done TODAY - set each morning)
    -> Agent goals.json (orchestrator writes role-specific goals per agent)
      -> GOALS.md (auto-generated from goals.json - agents read on boot)
        -> Tasks (agents create from their goals)
```

## Morning cascade

1. Read current org goals (north_star + yesterday's state).
2. Consult Adam for today's focus.
3. Write today's focus to org goals.json (`daily_focus`, `daily_focus_set_at`).
4. Set each active agent's goals: determine 2-5 role-appropriate goals from its IDENTITY.md role. **Dedup: if an agent's goals.json already has today's `daily_focus_set_at`, skip - don't overwrite.**
5. Set the orchestrator's own goals.
6. Confirm task plans - check for overlap (two agents doing the same thing), missing coverage (focus items nobody picked up), and misaligned tasks (work unrelated to today's focus).

Then `cortextos goals generate-md --agent <agent> --org <org>` and message each agent to check GOALS.md and create tasks.

## New-agent bootstrap

When a new agent comes online with an empty goals.json it messages the orchestrator for goals: check its role from IDENTITY.md, write goals.json, regenerate GOALS.md, reply.

## Evening update

Carry forward unfinished goals to tomorrow's morning discussion; update each agent's `bottleneck` field if new blockers appeared.

## North star drift

The north star lives in `orgs/<org>/goals.json`, set by Adam, rarely changing. If the daily focus drifts from it, flag it to Adam ("Today's focus on X differs from our north star of Y - intentional?").
