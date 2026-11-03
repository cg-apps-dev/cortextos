---
name: Task System
description: Create, manage, and complete tasks in cortextOS. Use when starting significant work, tracking progress, or completing deliverables.
---

# Task System

Every significant piece of work must have a corresponding task. Tasks enable coordination, accountability, and measurable progress.

## Task Types

- **Agent tasks** - Work executed autonomously by the assigned agent
- **Human tasks** - Requires human decision, input, or approval (assigned_to=human)

## Lifecycle

### 1. Create (BEFORE starting work)
```bash
cortextos bus create-task \
  "<title>" "<description>" [assignee] [priority] [project]
```

### 2. Mark in progress
```bash
cortextos bus update-task <task_id> in_progress
```

### 3. Execute the work

### 4. Complete
```bash
cortextos bus complete-task <task_id> "[output summary]"
```

### 5. Log KPI (if measurable)
```bash
cortextos bus log-event action task_completed info \
  '{"task_id":"ID","kpi_key":"metric_name","value":1}'
```

## The `needs_approval` Field

**true** - external actions: sending emails, merging PRs, deploying, public announcements
**false** - internal work: research, drafts, feature branches, testing

Tasks with `needs_approval: true` create an approval item that must be reviewed before executing external actions.

## Script Reference

| Action | Command |
|--------|---------|
| Create | `cortextos bus create-task "<title>" "<desc>" [assignee] [priority] [project]` |
| List | `cortextos bus list-tasks [--status S] [--agent A] [--priority P]` |
| Update | `cortextos bus update-task <id> <status> [note]` |
| Complete | `cortextos bus complete-task <id> "[summary]"` |
| Log event | `cortextos bus log-event <category> <event> <severity> '[json]'` |

**Statuses:** pending, in_progress, blocked, completed

**Priorities:** high, normal, low

## Where tasks are stored

Tasks live in the bus STORE, NOT in the repo: `${CTX_ROOT}/orgs/<org>/tasks/task_<id>_*.json` (one JSON per task), with per-task audit logs at `${CTX_ROOT}/orgs/<org>/tasks/audit/task_<id>_*.jsonl` (same data as `cortextos bus task-history <id>`). The store also holds `dod/` (definition-of-done) and `.claims/` (claim locks).

**The store is GITIGNORED - it is NOT in the git tree.** Do NOT search the repo or the per-agent `.claude/skills/` dirs for a task spec: a repo/tree search concludes "spec inaccessible" while the original is readable in the store all along (this cost 7 tasks a wrong triage bucket, 2026-11-03).

**Read a task by id:** prefer the bus commands - `cortextos bus list-tasks` (filter by `--agent`/`--status`) and `cortextos bus task-history <id>` (the audit log). For a full spec or a field the bus does not expose, read the store JSON directly: `cat "${CTX_ROOT}/orgs/<org>/tasks/task_<id>_*.json"`.

## Best Practices

- **Always create before starting** - ensures tracking and coordination
- **Be specific** - clear titles, descriptions with success criteria
- **Complete thoroughly** - include what was accomplished and where outputs are
- **Log KPIs** - when work advances a measurable goal
