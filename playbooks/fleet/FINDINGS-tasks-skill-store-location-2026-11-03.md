# FINDINGS - document bus task STORE location in tasks skill (2026-11-03)

**Task:** task_1793697755448_95023203. claude-dev doc-gap (routed by orch): tasks/SKILL.md had ZERO mention of where tasks live or how to read one by id (0 hits across all 8 tracked copies). Cost: 7 tasks a wrong triage bucket - subagents searched the repo + per-agent `.claude/skills/` dirs for re-filed task specs, concluded "spec inaccessible", when the originals were readable in the bus store all along.

## Ground-truth (verified on disk)
- Store: `${CTX_ROOT}/orgs/<org>/tasks/task_<id>_*.json` (one JSON per task).
- Audit: `${CTX_ROOT}/orgs/<org>/tasks/audit/task_<id>_*.jsonl` (per-task append-only, = `cortextos bus task-history <id>`).
- Also: `dod/` (definition-of-done) + `.claims/` (claim locks) subdirs.
- **CRUX: the store is GITIGNORED - NOT in the git tree.** That is what turned a readable store into a wrong-triage bucket: a repo/tree search finds nothing and concludes inaccessible.

## The fix (uniform additive, same method as the file-on-cite codify)
Add a `## Where tasks are stored` section covering (a) the store + audit paths, (b) GITIGNORED / do-NOT-search-the-git-tree, (c) read-by-id = prefer `cortextos bus list-tasks`/`task-history`, raw store JSON as fallback. Inserted before the UNIVERSAL `## Best Practices` anchor (present exactly once in all 29 copies). Byte-identical-result within each blob-group, surgical-result across variants, same operation. Section carries 0 em-dashes; additive-only (no inversion risk; store-location absent everywhere).

## Landscape (tasks skill = variant landscape, but HAS a canonical)
Canonical `community/skills/tasks` (a1f337d5 -> cleaned `49c366be`). Blob groups: dominant served class aabf6c11 (66L, ~14 agents); templates/agent+orchestrator 0480611b (68L); templates/agent-codex d9012e5f (67L); templates/analyst 9a2aacf7 (71L); the-analyst+atwood-analyst 84c4e9db (69L); skills/ top-level de04c38; codex-dev 1df16a55 (65L); community refs aabf6c11.

## Scope
### TRACKED - staged in this branch (8)
community/skills/tasks (canonical), skills/tasks (top-level), community/agents/{research-agent,security}, templates/{agent,orchestrator,analyst,agent-codex}. Each: store-section=1, `## Best Practices` intact, em-dash unchanged.

### GITIGNORED served - apply-on-approval (17 CGM + adam-personal)
aabf6c11 class (14): claude-dev-agent, cro-agent, meta-ads-agent, meta-compliance-agent, meta-media-buyer-agent, research-agent, security-agent, the-ad-strategist, the-axon-agent, the-orchestrator, the-production-house, the-sop-keeper, the-team-lead, vitalis. Plus the-tax-planning-agent (adam-personal, 0480611b), the-analyst (84c4e9db), codex-dev-agent (1df16a55). vitalis INCLUDED. Apply = same uniform insert + per-file verify (store-section=1, one `## Best Practices`, em-dash unchanged).

### ROUTE atwood (4) -> atwood-orchestrator
atwood-orchestrator, atwood-dev-agent, atwood-codex-agent, atwood-analyst. Byte-exact-section pointer (pull from the landed canonical to avoid transcription drift).

## Execution (on orch approval)
Land tracked (guarded-FF + dest-verify + gitleaks + backup push + ls-remote) + serve the FINDINGS doc to disk (land-then-serve; tracked skill copies NOT served - dirty-parked avoidance, reach live agents via served-apply). Apply 17 served. Route 4 atwood. Complete task_1793697755448. claude-dev confirms against the 7-task incident on land.
