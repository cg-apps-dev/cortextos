# FINDINGS - cron-management SKILL.md full-propagate (2026-11-01)

**Task:** task_1793549441735_35973825 (refile of obsolete task_1785180764235 at true scope; surfaced by the Sun 11-01 untracked-block sweep + sop-keeper inventory). Orchestrator ruling: option (i) FULL PROPAGATE the 238-line canonical rewrite; separate branch from agent-auth; sequenced AFTER the agent-auth wave landed (which it did - main 4014dbc0). Review gate on orch before any copy is touched.

**Why full-replace, not the old sed:** the old driver assumed "same sed to the nested `.cortextOS/state/agents/<agent>/crons.json` path." That is dead: the canonical `community/skills/cron-management/SKILL.md` is a 238-line rewrite that REMOVED the explicit filesystem path entirely (states only "crons.json is the source of truth"). So the stale copies are not a one-line path edit away from canonical - they are a different, shorter skill (117 lines). Wholesale replace with canonical is both correct and mechanically safest here because the stale set is byte-identical (one source content, no per-copy merges). Canonical carries NO relative links, so per-copy verify = **byte-identical-to-canonical** (no depth adjustment, unlike the agent-auth wave).

Canonical blob (pre-clean, was on main): `14da44b0e128c1872a5f03f5428ec763e582a74b` (238 lines, carried 19 em-dashes).
**CLEANED canonical blob (this branch, the propagate target): `1484335929532bbe1acecade2e5d583bad7fc038` (238 lines, em-dash=0).**
Old-117 blob: `0278fa24272e5aab6bb5ae3fba46cb3e44b59322` (117 lines, cites dead `${CTX_ROOT}/state/$CTX_AGENT_NAME/crons.json`).

---

## Full tracked + live landscape (characterized, not assumed)

### IN SCOPE - full replace with canonical (byte-identical)
| Copy set | count | current state | action |
|---|---|---|---|
| live per-agent `orgs/<org>/agents/<agent>/.claude/skills/cron-management/SKILL.md` | **19** | ALL byte-identical OLD-117 | replace -> canonical (gitignored; applied on approval) |
| `templates/agent/.claude/skills/cron-management/SKILL.md` | 1 | OLD-117 | replaced in this branch (tracked) |
| `templates/analyst/.claude/skills/cron-management/SKILL.md` | 1 | OLD-117 | replaced in this branch (tracked) |
| `templates/orchestrator/.claude/skills/cron-management/SKILL.md` | 1 | OLD-117 | replaced in this branch (tracked) |

The 19 live copies (verified all == OLD-117 blob): the-sop-keeper, the-orchestrator, the-analyst, the-ad-strategist, the-axon-agent, the-production-house, the-team-lead, cro-agent, meta-ads-agent, meta-compliance-agent, meta-media-buyer-agent, research-agent, security-agent, claude-dev-agent, vitalis (all clean-green-marketing); the-tax-planning-agent (adam-personal); atwood-analyst, atwood-dev-agent, atwood-orchestrator (atwood). (Re-enumerate at execution with `find orgs -path "*/agents/*/.claude/skills/cron-management/SKILL.md"`.)

### FLAGGED - NOT touched, orch to rule (scope / fit decisions)
| Copy | state | why flagged |
|---|---|---|
| `templates/agent-codex/plugins/cortextos-agent-skills/skills/cron-management/SKILL.md` | 176-line DIFFERENT variant (plugin layout) | the orch "4 templates" list named agent-codex, but this is NOT OLD-117 - it is a distinct 176-line codex-plugin variant. A wholesale canonical replace may not fit the codex plugin's structure/conventions. Needs a fit decision, not a blind replace. |
| `community/agents/research-agent/.claude/skills/cron-management/SKILL.md` | 132-line variant, stale | tracked copy OUTSIDE the stated "19 live + 4 templates" scope. Stale but a different variant. Fold in or leave? |
| `skills/cron-management/SKILL.md` (top-level) | 121-line variant, stale | tracked copy outside stated scope; different variant. Fold in or leave? |

### ALREADY CANONICAL - no action
- `community/skills/cron-management/SKILL.md` = the canonical source (238).
- `community/agents/security/.claude/skills/cron-management/SKILL.md` = already == canonical (238).

### EM-DASH CLEAN - RESOLVED in this branch (orch ruling: clean at canonical, same branch, audit all 19)

The pre-clean canonical carried **19 em-dashes (U+2014)**. Orch ruling: clean them AT canonical in this branch (tracked, doc-canon lane, zero runtime), list all 19 substitutions with before/after for the human-eye range-dash check, orch eyeballs all 19 at review = two-party control on the clean. Then propagate the CLEANED canonical.

Applied: a single uniform substitution ` <U+2014> ` -> ` - ` (all 19 were the spaced prose form; NONE are range dashes - every one separates a clause or a glossary definition). Post-clean: em-dash count 19 -> 0, line count 238 -> 238 (no structural change). Cleaned blob `1484335929532bbe1acecade2e5d583bad7fc038`.

**All 19 substitutions (for orch eyeball):**

| # | line | before (…context…) | after (…context…) |
|---|------|---------------------|--------------------|
| 1 | L3 | ...r persistent recurring work [EMDASH] those are session-only and ... | ...r persistent recurring work - those are session-only and ... |
| 2 | L10 | ...son` is the source of truth [EMDASH] use these bus commands for ... | ...son` is the source of truth - use these bus commands for ... |
| 3 | L40 | ...**Interval form** [EMDASH] use for simple repeated int... | ...**Interval form** - use for simple repeated int... |
| 4 | L47 | ...**Cron expression form** [EMDASH] use for calendar-anchored s... | ...**Cron expression form** - use for calendar-anchored s... |
| 5 | L53 | ...prompt argument is variadic [EMDASH] all remaining words are joi... | ...prompt argument is variadic - all remaining words are joi... |
| 6 | L58 | ...omatically after `add-cron` [EMDASH] no agent restart needed. Co... | ...omatically after `add-cron` - no agent restart needed. Co... |
| 7 | L146 | ...- `ts` [EMDASH] ISO timestamp of the execut... | ...- `ts` - ISO timestamp of the execut... |
| 8 | L147 | ...- `cron` [EMDASH] cron name... | ...- `cron` - cron name... |
| 9 | L148 | ...- `status` [EMDASH] `fired` \| `retried` \| `fail... | ...- `status` - `fired` \| `retried` \| `fail... |
| 10 | L149 | ...- `attempt` [EMDASH] attempt number (1 = first t... | ...- `attempt` - attempt number (1 = first t... |
| 11 | L150 | ...- `duration_ms` [EMDASH] execution duration in milli... | ...- `duration_ms` - execution duration in milli... |
| 12 | L151 | ...- `error` [EMDASH] error message if status is ... | ...- `error` - error message if status is ... |
| 13 | L155 | ...## One-shot reminders (gap [EMDASH] not yet supported)... | ...## One-shot reminders (gap - not yet supported)... |
| 14 | L161 | ...CronCreate [EMDASH] name: "remind-user-3pm", pr... | ...CronCreate - name: "remind-user-3pm", pr... |
| 15 | L171 | ...1. Check `list-crons` [EMDASH] confirm `next_fire_at` is i... | ...1. Check `list-crons` - confirm `next_fire_at` is i... |
| 16 | L172 | ...ron-log` for recent entries [EMDASH] `status: failed` entries sh... | ...ron-log` for recent entries - `status: failed` entries sh... |
| 17 | L176 | ...log $CTX_AGENT_NAME <name>` [EMDASH] look for `status: failed` a... | ...log $CTX_AGENT_NAME <name>` - look for `status: failed` a... |
| 18 | L189 | ...ically falls back to `.bak` [EMDASH] no operator intervention ne... | ...ically falls back to `.bak` - no operator intervention ne... |
| 19 | L220 | ...# Watch agent PTY [EMDASH] the prompt should inject im... | ...# Watch agent PTY - the prompt should inject im... |

### Driver-record correction
The old driver task_1785180764235 recorded "FIXED: the 4 templates (agent, analyst, orchestrator, agent-codex) - 0 wrong/1 correct, verified." Current truth: agent/analyst/orchestrator are OLD-117 (stale), agent-codex is a 176-line variant. None were canonical. (Orch already noted the correction when closing-obsolete the old driver.)

---

## Per-copy verification spec (run after each replace)

For every IN-SCOPE copy (19 live + 3 templates):
1. `git hash-object <copy>` == `1484335929532bbe1acecade2e5d583bad7fc038` (byte-identical to the CLEANED canonical). This single check subsumes content, path-removal, AND em-dash=0.
2. Negative: `grep -c 'state/$CTX_AGENT_NAME/crons.json' <copy>` == 0 (dead path gone).

Templates in this branch already pass check 1 against the cleaned blob (verified at re-stage time). Live copies verified at apply time. Source for the live apply is this branch's cleaned canonical (lands with this wave), not the pre-clean main copy.

---

## Execution (on orch approval)

- This branch already contains: the canonical em-dash clean + the 3 templates re-staged byte-identical to the cleaned canonical + this doc (tracked diff under review).
- 19 live copies (on approval): copy this branch's cleaned canonical into each, then run the per-copy hash verify against `1484335929532bbe1acecade2e5d583bad7fc038`, one pass. Two-party control = orch approval + sop-keeper execution.
- Then land the branch on main (guarded-FF + destination-verify + gitleaks + backup push + ls-remote verify, same as the agent-auth wave).
- Close task_1793549441735; log task_completed.

**OUT of this wave -> wave 3 (task_1793550266452_57378590), orch ruling:** `templates/agent-codex/.../cron-management/SKILL.md` (176-line plugin variant, fit-decision), `community/agents/research-agent/.../cron-management/SKILL.md` (132, stale variant), `skills/cron-management/SKILL.md` (121, stale variant). Wave 3 = characterize-then-decide per copy (intentional-variant vs plain-drift -> fold/replace/amend; the agent-auth surgical-amendment pattern is the likely shape for codex). Sequenced after wave 2 lands. `community/agents/security/.../cron-management` is already canonical content (note: it is the PRE-clean 238 blob `14da44b0`, so after this wave lands it will carry the 19 em-dashes until re-synced - minor, flag for the same owner-routed sync).
