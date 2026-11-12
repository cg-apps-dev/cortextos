# FINDINGS - redundant manual `task_completed` log in fleet boot docs (double-log, docs side)

- **Task:** task_1794448912179_88331162 (docs side) | code side: task_1794442884613 (dev, task_created auto-emit carve-out)
- **Owner lane:** the-sop-keeper (fleet doc propagation), orch-reviewed
- **Date:** 2026-11-11 PT
- **Status:** PHASE 1 PILOT (templates/agent completed-half) - staged for orch review before fan-out

## Root cause (ground-truthed at the artifact, not off a grep)

`completeTask` (`src/bus/task.ts:490`) auto-emits a `task/task_completed` event at `:538`:
`logEvent(eventPaths, assignee, taskOrg, 'task', 'task_completed', 'info', { task_id, ...(result?{result}:{}) })`,
best-effort (try/catch, never blocks completion). The fleet boot docs ALSO instruct a manual
`cortextos bus log-event task task_completed` after every `complete-task` = ~1.9x double-logging
(6,229 events vs 3,309 completed tasks, measured fleet-wide).

**Emit gate (the nuance a surface grep misses):** the emit is wrapped in `if (assignee)`. BUT
`createTask` defaults `assignee = agentName` (`src/bus/task.ts:20`), and dev confirmed 0 of 3,310
completed tasks in full fleet history carry a blank `assigned_to`. So the auto-emit fires for every
real completion; the manual step is pure redundancy. **Known-safe-now limitation:** a task created
with an explicitly-blank `--assignee` then completed WOULD skip the auto-emit (gate false), and only
the manual step (which uses the COMPLETER's agent, not the task's assignee) would cover it. At 0/3310
this is theoretical. **Revisit trigger:** if the fleet ever intentionally creates unassigned tasks,
re-add coverage (or dev adds a completer-fallback emit to `completeTask`).

## The fix (surgical, per-category - NOT a blind delete)

Three occurrence categories across the footprint:

- **A - redundant workflow instruction (REMOVE):** "after `complete-task`, also run
  `log-event task task_completed`" in AGENTS.md/CLAUDE.md task-workflows, tasks/SKILL.md ("Log KPI"
  step), nighttime-mode/SKILL.md. This is the actual double-log cause.
- **B - prescriptive event tables + "how to log task_completed" how-to (REVISE, not delete):** the
  `| Task completed | task | task_completed |` row in "log these events every time" tables, and the
  event-logging SKILL "### Task completed" section. Replace with the auto-emit note so the taxonomy
  stays visible but nobody logs it manually.
- **C - pure command references/examples (KEEP):** bus-reference SKILL listing `task_completed` as a
  valid event name, or a generic `log-event` syntax example. Harmless reference; leave (optionally
  swap a syntax example to a non-auto-emitted event, low priority).

**Canonical wording (dev-approved):**
> Phase 1 (completed-half): `task_completed` is auto-emitted by `complete-task` (for any assigned task) - do not log it manually.
> Phase 2 (combined, after the createTask-emit landed as f160da28): `task_completed` and `task_created` are auto-emitted by `complete-task` / `create-task` (for any assigned task) as of f160da28 - do not log them manually.

## task_created is the INVERTED case - held, not fixed here

`createTask` currently emits NOTHING (task_created, ~89% gap). That is a CODE fix (dev carve-out
task_1794442884613, one `logEvent` mirroring `completeTask:538`), unscheduled but near-term. **No
doc asserts `task_created` is auto-emitted until that code is merged+live** (documenting-before-code
is the inverse bug). Sentence 2 ("`task_created` is auto-emitted by `create-task` as of <sha>") is
added only on dev's SHA. task_created rows/steps are LEFT UNTOUCHED in this pass.

**RESOLVED 2026-11-12:** dev's carve-out landed on main as `f160da28` (createTask emits `task_created` at `src/bus/task.ts:126`, best-effort, gated `if(assignee)`, assignee-defaulted, mirrors completeTask - ground-truthed). There were NO manual `log-event task_created` commands anywhere (the ~89% gap was under-following the event-table row, not a documented step), so Phase 2a gave the `| Task created |` table row the same remove + combined-auto-emit-note treatment as task_completed - leaving it would have started a symmetric task_created double-log now that createTask fires. Correctness constraint satisfied: the auto-emit clause entered the docs only after the code merged.

## Phasing (orch-ruled 2026-11-11)

- **Phase 1 (now):** templates + event-logging SKILL, completed-half only (remove A, revise B, leave
  C). Future agents stop inheriting the bug. **This doc = the Phase-1 PILOT on `templates/agent/`.**
- **Phase 2 (after dev SHA):** templates get the task_created revision (2nd touch); the ~38 live
  gitignored per-agent docs get touched ONCE with BOTH halves (cost-halving - the live-doc surface is
  where review cost concentrates).
- **Decouple trigger:** if dev's carve-out is not merged by **2026-11-18**, propagate the
  completed-half alone to the live docs rather than hold indefinitely; task_created half follows code.
- **Cross-org:** atwood templates + live docs coordinated with atwood-orchestrator as owner (not
  unilateral). community/ copies touch other orgs - owner-routed.

## Full footprint (inventory on committed main, ~78 files, TWO surfaces)

- **~40 TRACKED source files:** `templates/{agent,agent-codex,analyst,orchestrator}` (AGENTS.md,
  CLAUDE.md, .claude/skills/{tasks,event-logging,bus-reference,nighttime-mode}), `community/{agents,skills}`,
  root `skills/`, `playbooks/research-agent/`.
- **~38 LIVE gitignored per-agent docs:** `orgs/*/agents/*/AGENTS.md` + `CLAUDE.md` across all orgs
  (clean-green-marketing, atwood, adam-personal), carrying the manual step.

## This pilot - files changed (templates/agent, Phase 1 completed-half)

| File | Change | Category |
|------|--------|----------|
| `templates/agent/AGENTS.md` | removed `# Log completion` manual step from workflow; removed `task_completed` row from the log-these table + added auto-emit note | A + B |
| `templates/agent/CLAUDE.md` | removed manual "Log KPI" step 4 (folded note into step 3 Complete); removed `task_completed` line from the event block + added note | A + B |
| `templates/agent/.claude/skills/tasks/SKILL.md` | removed the redundant "### 5. Log KPI" task_completed step; folded auto-emit note + a metric-event redirect into section 4 | A |
| `templates/agent/.claude/skills/event-logging/SKILL.md` | "### Task completed" how-to replaced with the auto-emit note | B |

## VERIFY SPEC (this pilot)

- `grep -n "log-event task task_completed\|log-event action task_completed"` in the 4 files == 0.
- `task_created` still present/untouched (correctness lock): AGENTS.md log-these table still has the
  `| Task created | task | task_created | info |` row.
- bus-reference SKILL (Category C) untouched in this pilot.
- 0 em-dashes in added lines.
- No doc asserts task_created is auto-emitted (sentence 2 absent).

## Fan-out (after pilot clean) - remaining tracked template sets, completed-half only

`templates/agent-codex/`, `templates/analyst/`, `templates/orchestrator/`, `community/agents/*`,
`community/skills/{tasks,event-logging,nighttime-mode}`, root `skills/tasks`,
`playbooks/research-agent/research-brief-as-document.md`. Same A/B/C discipline + canonical wording.
One wave at a time; each batch owner-reviewed, orch-merged. Intentional variants (codex plugin copy)
recorded as variants, not drift.
