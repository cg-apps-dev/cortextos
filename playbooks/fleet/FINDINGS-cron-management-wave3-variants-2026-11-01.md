# FINDINGS - cron-management wave 3: the 3 variant copies (2026-11-01)

**Task:** task_1793550266452_57378590 (follow-up to wave 2 full-propagate). Orch per-copy ruling: CODEX = (A) surgical reconcile; RESEARCH-AGENT + SKILLS/ = (C) with a section-by-section redundancy table (cite where each behavioral section already lives, or mark UNIQUE; migrate unique bits with a proposed destination; then replace with canonical). All three staged in one branch, orch review gate.

**Citations key:** CANON = `community/skills/cron-management/SKILL.md` (cleaned 238-line, blob `1484335929532bbe1acecade2e5d583bad7fc038`). AGENTS = `templates/agent/AGENTS.md` (mainline bootstrap).

**Method-correction banked (MEMORY.md):** the initial "variants dead-path=0" reading was a grep false-negative (a `$` in the pattern = regex EOL anchor). Re-verified with a fixed-shape grep: all 3 variants DO cite the dead `${CTX_ROOT}/state/.../crons.json` path. Wave-2 correctness unaffected (its gate was byte-exact hash, re-confirmed 0 dead-path there).

---

## CODEX - (A) surgical reconcile (DONE in branch)

`templates/agent-codex/plugins/cortextos-agent-skills/skills/cron-management/SKILL.md` is a deliberate, codex-specific variant (exact cron-fire inject shape, mandatory `update-cron-fire` with gap-detection rationale, config.json hot-reload caveat, one-shot pattern). Preserved structure (9 ## sections intact); surgical fixes only:
1. **Dead path fixed** (intro): `${CTX_ROOT}/state/$CTX_AGENT_NAME/crons.json` -> `${CTX_ROOT}/.cortextOS/state/agents/$CTX_AGENT_NAME/crons.json` (nested, matches AGENTS L417).
2. **cron-state.json path PRESERVED** (L43 `state/<agent>/cron-state.json`): VERIFIED correct on disk (`${CTX_ROOT}/state/<agent>/cron-state.json`, NON-nested) - it is NOT a sibling of crons.json/cron-execution.log (those are nested under `.cortextOS/state/agents/`). Did NOT "fix" a correct path. (Fleet fact: cron-state.json lives in the un-nested tree; crons.json + cron-execution.log in the nested tree. Banking separately.)
3. **10 em-dashes cleaned** -> 0 (9 spaced-prose via uniform swap + 1 line-final "Then [emdash]" targeted).
4. **Added `test-cron-fire` CLI** to the Testing section (was dashboard-only).
5. **Added `create-reminder`** as the preferred one-shot + de-staled the "there is no daemon-side fire_at (yet)" claim (create-reminder exists and is the cleaner persistent one-shot; the cron-expression pattern kept as the alternative).

Verify: em-dash=0, dead-path=0, nested path present, cron-state.json preserved, test-cron-fire=1, create-reminder=1, 9 sections intact.

---

## SKILLS/ (top-level) - (C) -> (B), ZERO unique (REPLACED in branch)

`skills/cron-management/SKILL.md` (121-line variant). Redundancy table:

| Section | Verdict | Lives where |
|---|---|---|
| Intro (daemon-managed, dead `{agent}` path, survive restarts, no-recreate) | REDUNDANT (+ stale path) | AGENTS L33/L417/L443-444; CANON intro |
| On Session Start (check list-crons, add if missing) | REDUNDANT | AGENTS L33 (step 6) |
| Adding a New Cron | REDUNDANT | CANON "Adding a recurring cron" |
| Removing a Cron | REDUNDANT | CANON "Removing a cron" |
| Updating a Cron (stale `--schedule` flag) | REDUNDANT (+ stale syntax; CANON uses `--interval`) | CANON "Updating a cron" |
| `manualFireDisabled` note | REDUNDANT | CANON (present) |
| Checking Execution History (stale `--cron` flag) | REDUNDANT (+ stale syntax; real cmd is positional `[name]`) | CANON "Inspecting execution history" |
| Cron Expiry ("no 3-day /loop expiry") | REDUNDANT (low-value; dispels a /loop myth) | AGENTS L450-456 (/loop vs persistent) |
| Troubleshooting (incl stale `[CRON: <name>]` inject format) | REDUNDANT (+ stale format; real is `[CRON FIRED <iso>] <name>:`) | CANON "Troubleshooting" |
| Migration from config.json (legacy) | REDUNDANT | AGENTS L458-462 |

**Zero UNIQUE content** - table IS the proof that (C) degenerates to (B). Replaced byte-identical to CANON (hash == `1484335929532bbe1acecade2e5d583bad7fc038`, em-dash=0). It also carried stale command syntax (`--schedule`, `--cron`) and a stale inject format, so the replace is a strict correctness gain.

---

## RESEARCH-AGENT - (C), ONE unique section -> migration proposal, REPLACEMENT HELD

`community/agents/research-agent/.claude/skills/cron-management/SKILL.md` (132-line variant; the LIVE research-agent copy was already canonicalized in wave 2 - this is the community REFERENCE copy). Redundancy table:

| Section | Verdict | Lives where |
|---|---|---|
| Intro (daemon-managed, dead path, survive restarts, no-recreate) | REDUNDANT (+ stale path) | AGENTS L33/L417/L443-444; CANON intro |
| Never /loop or CronCreate | REDUNDANT | AGENTS L33/L424 |
| On Session Start | REDUNDANT | AGENTS L33 (step 6) |
| **Handling a Cron Fire (`update-cron-fire`)** | **UNIQUE** | NOT in CANON (0), NOT in mainline AGENTS (0). Only codex's stack + this copy document it. |
| Adding / Updating / Removing / Testing (dashboard + manualFireDisabled) | REDUNDANT | CANON |
| Checking Execution History | REDUNDANT | CANON |
| Troubleshooting (migrate-crons --force, lastGoodSchedule) | REDUNDANT | CANON "Troubleshooting" |

**One UNIQUE section: "Handling a Cron Fire" (`update-cron-fire`).** `update-cron-fire` is a REAL command ("Record that a named cron just fired - enables daemon gap detection for dead zones"). It is documented for codex (AGENTS + skill + bus-reference) and this research-agent copy, but is ABSENT from CANON and mainline template AGENTS - so the 19 fleet agents now on CANON have NO guidance to close the cron-fire loop. That is a real fleet documentation gap, not just a research-agent detail.

**PROPOSED MIGRATION DESTINATION: CANON** (add a "Handling a Cron Fire" section to the canonical cron-management skill). Rationale: it is cron-skill content, and putting it in CANON gives ALL agents the close-the-loop guidance, not just codex/research-agent. **Downstream implication (flagged, orch call):** adding it to CANON means a re-propagate of CANON to the 19 live + templates to actually deliver it (a wave-2-shape follow-up). **Therefore research-agent's replacement is HELD** until the orch rules: (a) add `update-cron-fire` guidance to CANON (then re-propagate, then research-agent replaces with the updated CANON - nothing lost), or (b) decide cron-fire-handling is codex-only and drop it from the research-agent reference (then research-agent replaces with CANON as-is). Not replacing research-agent in this branch either way - awaiting the ruling.

---

## Canonical-level flags surfaced (out of wave-3 scope, owner-routed)

1. **CANON's "One-shot reminders (gap - not yet supported)" section is STALE** - `create-reminder` exists and is the proper persistent one-shot (AGENTS L426). Replacing variants with CANON propagates this stale "not yet supported" claim. Recommend an owner-routed CANON fix (then the next CANON re-propagate carries it). Same class as the em-dash clean.
2. **`update-cron-fire` gap** (see research-agent above): the mandatory cron-fire close-loop is not in CANON/mainline AGENTS, so most fleet agents lack it.

---

## Execution / status

- CODEX: reconciled in branch (tracked diff under review).
- SKILLS/: replaced byte-identical to CANON in branch (tracked diff under review).
- RESEARCH-AGENT: NOT changed in branch - held for the orch ruling on the `update-cron-fire` migration (above).
- On approval of codex + skills/: land the branch on main (guarded-FF + destination-verify + gitleaks + backup push + ls-remote), complete task_1793550266452.
- The 2 canonical-level flags + the research-agent unique-bit decision are follow-ups the orch routes.
