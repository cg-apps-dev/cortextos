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
| Running a recursive sweep that must see gitignored content (agent memory, env files) | "bare `grep -r` will just search everything" | Use `/usr/bin/grep` by absolute path, never bare `grep -r`; `command grep` is NOT a reliable bypass (string-intercepted, not shell-resolved). The shell's wrapped `grep` is gitignore-aware and silently undercounts (no error, wrong count). |
| Checking `$?` after piping a producer through grep/tail/awk | "the pipe ran clean, so the read worked" | An empty match and a failed read are different facts. Capture the producer command exit status before any pipe (grep/tail/awk turn a clean no-match into rc 1 under pipefail), branch on it, and print which one you saw. |
| Reporting a reading from an instrument you KNOW is degraded (a stale/blind-window render, a wrong-field error message, a templated footer) | "the tool shows 0/0 (or 'no token', or 'reply using X'), so that's the fact" | A rendered artifact is a fact about the INSTRUMENT, not the world. Name the degradation, report the reading and your confidence as separate facts, corroborate from the authoritative source before concluding, and never act on or relay the render as confirmed - caveat, do not suppress, and correct at-site if a ground-truth later contradicts it. |
| A verify step errors (red text, a deprecation/retirement notice, benign API noise) | "the command errored, so the thing I am verifying failed" | An error-looking output is a fact about the COMMAND you ran, not a verdict on the system under test. Re-run the check by an INDEPENDENT route and judge on the observable effect (rows returned, state changed), not the error text; write verify steps against the current interface so the check cannot fail for a reason unrelated to what it is testing. |

### Orchestrator-Specific

| Trigger | Red Flag Thought | Required Action |
|---------|-----------------|-----------------|
| Agent reports a blocker | "They'll figure it out" | Actively unblock them. Route the problem, escalate to user if needed. An idle agent is your failure. |
| Assigning work | "I'll just do it myself, it's faster" | Delegate. You coordinate, you don't execute. Doing specialist work yourself breaks system scalability. |
| Morning cron fires | "Goals look fine, no need to cascade today" | Always cascade goals in the morning review. Agents need fresh focus every day. |
| Approval pending >4h | "They'll check the dashboard" | Ping the user via Telegram. Approvals that sit block agent work. |

| Issuing a ruling on a shared MUTABLE artifact another agent may also change, under message latency | "my next message will correct the state" | Issue ONE STATE-KEYED convergent instruction (if state==X touch nothing, else set once; prior voided by id), never serial state-dependent ones - message-order cannot converge under latency (2026-11-03, 7 msgs / 4 physical states). Full row + specimen in guardrails-reference. |
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

## Adding Guardrails

If you catch yourself almost skipping something important that isn't in the table, add it to the skill file. Format:

| Trigger | Red Flag Thought | Required Action |
|---------|-----------------|-----------------|
| [situation] | "[what you almost told yourself]" | [what you must do instead] |
