# Guardrails

Read this file on every session start. Full reference: `.claude/skills/guardrails-reference/SKILL.md`

---

## Red Flag Table

| Trigger | Red Flag Thought | Required Action |
|---------|-----------------|-----------------|
| Heartbeat cycle fires | "I'll skip this one, I just updated recently" | Always update heartbeat on schedule. No exceptions. The dashboard tracks staleness. |
| Starting work | "This is too small for a task entry" | Every significant piece of work gets a task. If it takes more than 10 minutes, it's significant. |
| Completing work | "I'll update memory later" | Write to memory now. Later means never. Context you don't write down is context the next session loses. |
| Inbox check | "I'll check messages after I finish this" | Process inbox now. Un-ACK'd messages redeliver and block other agents. |
| Bus script available | "I'll handle this directly instead of using the bus" | Use the bus script. Work that doesn't go through the bus is invisible to the system. |
| Running a recursive sweep that must see gitignored content (agent memory, env files) | "bare `grep -r` will just search everything" | Use `find -exec grep` or `command grep`, never bare `grep -r`. The shell's wrapped `grep` is gitignore-aware and silently undercounts (no error, wrong count). |
| Checking `$?` after piping a producer through grep/tail/awk | "the pipe ran clean, so the read worked" | An empty match and a failed read are different facts. Capture the producer command exit status before any pipe (grep/tail/awk turn a clean no-match into rc 1 under pipefail), branch on it, and print which one you saw. |

## Specialist Agent Patterns

| Trigger | Red Flag Thought | Required Action |
|---------|-----------------|-----------------|
| Task assigned to me | "I'll get to it later" | ACK and start within one heartbeat cycle. Stale tasks make you look broken. |
| Blocked on something | "I'll wait and see" | Create a blocker task or escalate to orchestrator immediately. Silent blockers are invisible. |
| Work finished | "Orchestrator will notice" | Complete the task and log the event now. Unlogged completions don't exist. |

For the complete red flag table (15 patterns), see `.claude/skills/guardrails-reference/SKILL.md`.

---

## How to Use

1. **On boot**: Read this table. Internalize the patterns.
2. **During work**: When you notice yourself thinking a red flag thought, stop and follow the required action.
3. **On heartbeat**: Self-check - did I hit any guardrails this cycle? If yes, log it:
   ```bash
   cortextos bus log-event action guardrail_triggered info --meta '{"guardrail":"<which one>","context":"<what happened>"}'
   ```
4. **When you discover a new pattern**: Add a new row to the table in `.claude/skills/guardrails-reference/SKILL.md`. The file improves over time.

---

## Fleet-wide standing rules (Adam, every agent - non-negotiable)

These are HARD standing rules for ALL agents. Codified here (structural), not memory-dependent.

- **No em dashes.** Never use the em dash (U+2014) in anything you create or send (chats, reports, code comments, copy, pages). Use a hyphen "-". Applies fleet-wide, every output.
- **Pacific Time for human-facing times.** All times shown to a human are in PT (e.g. "7:19 PM PT"), never lead with UTC/Z. Internal storage/logs/crons stay UTC; convert at the human boundary.

(Role-specific standing rules - e.g. never-free-hand ad copy for creative/ad agents, codex-first for dev agents - live in the relevant role-skill, not here, so generic agents do not inherit rules that do not apply to them.)

---

## Adding Guardrails

If you catch yourself almost skipping something important that isn't in the table, add it to the skill file. Format:

| Trigger | Red Flag Thought | Required Action |
|---------|-----------------|-----------------|
| [situation] | "[what you almost told yourself]" | [what you must do instead] |
