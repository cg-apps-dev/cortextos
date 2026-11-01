# FINDINGS - cron-management wave 4: Handling-a-Cron-Fire into CANON + one-shot de-stale + re-propagate (2026-11-01)

**Task:** task_1793551371674_96696455 (follow-up to wave 3). Orch ruling = option (a): `update-cron-fire` close-the-loop guidance belongs in canonical, because it is the EXACT ACK mechanism the S3 consumption watchdog consumes (approval_1793526814; evening-review already ACK-wired; per-cron `requiresConsumption` adoption spreading) - so all 19 fleet agents need it, not just codex. This wave CLOSES both canonical-level flags raised in the wave-3 FINDINGS.

**Prior CANON blob:** `1484335929532bbe1acecade2e5d583bad7fc038` (238 lines, wave-2 cleaned).
**AMENDED CANON blob (this wave, the new propagate target):** `d805fe6c3ef5bf4f9a9528d34b5c23dab5fdfd12` (254 lines, em-dash=0).

---

## CANON amendments (community/skills/cron-management/SKILL.md)

1. **Added `## Handling a cron fire` section** (inserted after "Listing your crons"). Adapted from the codex/research-agent variant content, no em-dashes, canonical voice: the `[CRON FIRED <iso>] <name>: <prompt>` inject shape; run to completion; then MANDATORY `cortextos bus update-cron-fire <cron-name> --interval <duration>` to close the loop for daemon gap-detection; one-shot self-removing crons are the exception. This is the wave-3 "unique" research-agent section, now living in CANON so it reaches ALL agents (and is load-bearing for the S3 watchdog rollout).
   - **Review-fix (orch-caught mechanism defect):** my first staging wrote `--interval <interval-or-cron-expr>` and "shorthand or the 5-field expression". VERIFIED WRONG (dev, S3 prompt-wire thread): `parseDurationMs` cannot parse a cron expression (returns NaN); `update-cron-fire` stores `--interval` as gap-loop metadata, so a raw 5-field expression stores NaN (this is why the orch's evening-review tail read 24h instead of its real `0 18 * * *`). Corrected to parseable-duration-ONLY: pass the closest duration (daily = `24h`), NEVER the raw 5-field expression. Fixed blob `d805fe6c`.

2. **Replaced the stale `## One-shot reminders (gap - not yet supported)` section.** The old section was not just stale - it actively recommended `CronCreate` with `recurring: false`, which is session-only and violates the fleet never-use-CronCreate rule. New section: `create-reminder` as the persistent one-shot (survives restarts, fires once), plus `list-reminders`/`ack-reminder`/`prune-reminders`, with the cron-expression pattern noted as the alternative and an explicit never-CronCreate/`/loop` line. Closes wave-3 flag #1.

Verify: em-dash=0, `Handling a cron fire`=1, `update-cron-fire`=1, `create-reminder`=1, `not yet supported`=0, dead-path=0, 10 sections.

---

## Re-propagate set (byte-identical to AMENDED CANON `d805fe6c`)

Wave-2 shape + skills/ (orch-confirmed the stranding catch: skills/ must track the amended CANON or wave 3 leaves it one revision behind).

| Copy set | count | status |
|---|---|---|
| live per-agent `orgs/<org>/agents/<agent>/.claude/skills/cron-management/SKILL.md` | 19 | applied on approval (gitignored); hash-verify each == `d805fe6c` |
| `templates/{agent,analyst,orchestrator}/.claude/skills/cron-management/SKILL.md` | 3 | replaced byte-identical in branch |
| `community/agents/security/.claude/skills/cron-management/SKILL.md` | 1 | replaced byte-identical in branch |
| `skills/cron-management/SKILL.md` (top-level) | 1 | replaced byte-identical in branch |
| **`community/agents/research-agent/.claude/skills/cron-management/SKILL.md`** | 1 | **wave-3 held replace, now DONE** - its unique update-cron-fire section now lives in CANON, so replacing with amended CANON loses nothing. Byte-identical in branch. |

All 6 tracked copies hash-verified == `d805fe6c`, em-dash=0.

**CODEX stays OUT** (orch-confirmed intentional, recorded in orch memory): `templates/agent-codex/.../cron-management/SKILL.md` keeps its deliberate codex-specific cron-fire phrasing (reconciled in wave 3). The fleet carries two phrasings of the cron-fire guidance (codex + canonical) by design - not drift.

---

## Per-copy verification spec

1. `git hash-object <copy>` == `d805fe6c3ef5bf4f9a9528d34b5c23dab5fdfd12` (byte-identical to amended CANON; subsumes content + em-dash=0 + path).
2. Negative: `grep -F '/state/' <copy> | grep crons.json | grep -v '.cortextOS/state/agents'` == empty (no dead path; fixed-shape grep, not a `$`-anchored pattern - see the wave-3 method-correction).

---

## Execution (on orch approval)

- Tracked (6 copies + amended CANON + this FINDINGS): in branch, under review.
- 19 live copies: copy amended CANON into each, hash-verify == `d805fe6c`, one pass.
- Land branch on main (guarded-FF + destination-verify + gitleaks + backup push + ls-remote).
- Complete task_1793551371674. Both wave-3 canonical flags closed by this wave.
- This is the 3rd+ pass of the propagation discipline (stage -> FINDINGS -> two-party -> hash-verify -> destination-verify); drafting an auto-skill candidate for it after this lands (per orch suggestion).

---

## Rider (deferred, orch-ruled) - codex explicit NEVER-raw-5-field line

`templates/agent-codex/plugins/cortextos-agent-skills/skills/cron-management/SKILL.md` (landed wave 3, main 872d25ed) documents `update-cron-fire --interval <interval>` as "the expected GAP between fires for a 5-field expression". That is the CORRECT CONCEPT (a gap duration, not the raw cron expression), so there is NO active defect to chase - codex is not telling agents to pass an unparseable value. Orch ruling: no codex touch now. **RIDER:** when codex's cron-management variant is next touched for any other reason, fold in the explicit "NEVER the raw 5-field expression / stores NaN" wording to mirror the canonical section (blob `d805fe6c`). Recorded here so it is findable, not a floating intention.
