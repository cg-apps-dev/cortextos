# FINDINGS - dead cron-path residuals (CRONS_MIGRATION_GUIDE.md + .crons-migrated sweep) (2026-11-02)

**Task:** task_1793600316582_35106922 (follow-up to COMPLETED task_1788838796618_71481567, whose substring set was `crons.json` + `cron-execution.log` ONLY - so `.crons-migrated` citations + the standalone guide survived uncovered). Surfaced by a sop-keeper night G3 currency scan, orch-verified. Process: fleet-doc-propagation discipline, orch review gate before land. Doc-only, zero runtime = case-1, no Adam gate.

**Ground-truth (find on `$CTX_ROOT`, 2026-11-02):** `crons.json` AND `.crons-migrated` both live NESTED at `${CTX_ROOT}/.cortextOS/state/agents/<agent>/`. `cron-state.json` is the lone un-nested one (`${CTX_ROOT}/state/<agent>/`). `.onboarded` is also un-nested (`${CTX_ROOT}/state/<agent>/`) - do NOT touch it.

**Fix = path only:** `${CTX_ROOT}/state/<agent-or-{agent}-or-${CTX_AGENT_NAME}>/{crons.json|.crons-migrated}` -> `${CTX_ROOT}/.cortextOS/state/agents/.../{...}`. No content/prose change.

---

## IN-SCOPE fix set

### TRACKED (staged in this branch, under review)
| File | spots fixed | notes |
|---|---|---|
| `CRONS_MIGRATION_GUIDE.md` | 5 (L10 prose, L33 ls, L36 cat, L141 verify, L147 rollback-delete) | both crons.json + .crons-migrated; was fully uncovered (not in old scope). L147 rollback would have deleted a non-existent path. |
| `templates/agent/AGENTS.md` | 2 (.crons-migrated prose L460 + ls L497) | crons.json already nested-correct (old sweep) |
| `templates/analyst/AGENTS.md` | 2 (.crons-migrated prose + ls) | same |
| `templates/orchestrator/AGENTS.md` | 2 (.crons-migrated prose + ls) | same |
| `templates/agent-codex/AGENTS.md` | 1 (.crons-migrated ls) | same |

Verify: each diff changes ONLY the path substring; guide em-dash count unchanged 19->19 (none introduced - see flag below); no `.onboarded` touched; no prose inversion.

### GITIGNORED served copies (apply-on-approval, same .crons-migrated path fix) - 22 files
Per-agent served `AGENTS.md` carrying dead `.crons-migrated` (crons.json already nested from old sweep; `.crons-migrated` residue): the-sop-keeper, the-orchestrator, the-analyst, the-ad-strategist, the-axon-agent, the-production-house, the-team-lead, cro-agent, meta-ads-agent, meta-compliance-agent, meta-media-buyer-agent, research-agent, security-agent, claude-dev-agent, vitalis (clean-green-marketing); the-tax-planning-agent (adam-personal); atwood-analyst, atwood-dev-agent, atwood-orchestrator, atwood-codex-agent (atwood); codex-dev-agent (AGENTS.md). Apply-time substitution identical to the template fix; re-enumerate + per-file verify (path-fixed, em-dash unchanged, no `.onboarded` touched) at execution. Cross-org (adam-personal, atwood) + privacy-isolated (vitalis) copies included per the skill's cross-org inclusion rule - **flagging for explicit orch inclusion ruling** (infra bootstrap doc, historically in-scope, but encode the ask).

---

## EXCLUDE - classify-before-clobber (describe-the-old-path-AS-wrong; a substring-replace would INVERT the correction)

| File | why exclude |
|---|---|
| `the-team-lead/CLAUDE.md` | L27 "the old `state/<agent>/crons.json` does not exist", L118-126 PATH NOTE explaining the old path is wrong + the split trap, L239-242 table. Entirely a correction doc. Orch-named member. A naive dead-count flags it "1 dead" - that is the trap. |
| `the-orchestrator/CLAUDE.md` | L38-39 PATH NOTE ("`crons.json` is NOT in it ... daemon keeps cron config under `.cortextOS/...`"). Orch-named member. |
| `the-analyst/memory/2026-07-28.md`, `the-sop-keeper/MEMORY.md`, analyst workspace REFERENCE doc | memory/reference files describing the old path as nonexistent; not propagation targets AND describe-as-wrong. |

---

## FLAGS (out of this task's scope - orch to route)

1. **NEW ADJACENT SURFACE - `agent-management/SKILL.md` crons.json dead path.** Separate skill, `crons.json` (not `.crons-migrated`), so outside this task's `.crons-migrated` scope AND missed by the completed crons.json sweep (these are served/gitignored copies + workspace backups, not in the old 29-file tracked scope). Extent: 2 tracked on main + 13 served live (+ several `the-orchestrator/workspace/skill-trim-backup-2026-06-07/*` historical backups - leave backups). Canonical `community/skills/agent-management/SKILL.md` = 0 (clean), so the copies drifted from a correct canonical. Recommend a SEPARATE wave (full-propagate the clean canonical, or surgical path-fix) - orch's call on filing.
2. **`CRONS_MIGRATION_GUIDE.md` carries 19 pre-existing em-dashes** (unchanged by this path fix). Out of scope here; recommend an owner-routed em-dash clean (same class as the cron-management canonical clean).

---

## Execution (on orch approval)
- Tracked (guide + 4 templates): land this branch (guarded-FF + destination-verify + gitleaks + backup push + ls-remote).
- 22 served AGENTS.md: apply the `.crons-migrated` path fix, per-file verify, one pass (on the cross-org/vitalis inclusion ruling).
- Complete task_1793600316582. Flags (1) agent-management surface + (2) guide em-dashes routed per orch.
