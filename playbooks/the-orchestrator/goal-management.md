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
4. Set each active agent's goals: determine 2-5 role-appropriate goals from its IDENTITY.md role. **Dedup: if an agent's goals.json `updated_at` already carries today's date, skip - don't overwrite.**
5. Set the orchestrator's own goals.
6. Confirm task plans - check for overlap (two agents doing the same thing), missing coverage (focus items nobody picked up), and misaligned tasks (work unrelated to today's focus).

Then `cortextos goals generate-md --agent <agent> --org <org>` and message each agent to check GOALS.md and create tasks.

## New-agent bootstrap

When a new agent comes online with an empty goals.json it messages the orchestrator for goals: check its role from IDENTITY.md, write goals.json, regenerate GOALS.md, reply.

## Evening update

Carry forward unfinished goals to tomorrow's morning discussion; update each agent's `bottleneck` field if new blockers appeared.

## Re-stamping carried goals (content-check gate)

When an agent is gated-idle, its goals are carried forward and re-stamped rather than rewritten: the agent `goals.json` `updated_at` is bumped while `last_content_change_at` is preserved (the re-stamp is a date refresh, not a content change). The re-stamp keeps the prior focus and goal text, so a stale dated reference can ride forward unreviewed if the re-stamp is blind.

MECHANICAL STEP - run before any re-stamp, including a "nothing changed" one:

1. Regex the carried focus and goal lines for dated references: ISO dates (`\b20\d{2}-\d{2}-\d{2}\b`) plus named-event / `day N` anchors that resolve to a date.
2. For each hit, compute its age against today. If any dated ref is older than 14 days, the re-stamp is BLOCKED pending a content review of that line: is the reference still live, superseded, or should it be re-anchored or dropped? Resolve it, then re-stamp.
3. No dated-ref hit, or every hit within 14 days: clear to re-stamp.

The 14-day window is a REVIEW TRIGGER, not an expiry - a still-valid older reference survives the review and re-stamps unchanged, it just cannot pass un-looked-at. Origin: 2026-11-03 evening-review self-eval, where a carried focus was re-stamped with a >14d-stale dated ref left intact.

## North star drift

The north star lives in `orgs/<org>/goals.json`, set by Adam, rarely changing. If the daily focus drifts from it, flag it to Adam ("Today's focus on X differs from our north star of Y - intentional?").
