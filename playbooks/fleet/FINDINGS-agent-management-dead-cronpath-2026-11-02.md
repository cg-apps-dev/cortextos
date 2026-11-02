# FINDINGS - agent-management SKILL.md dead crons.json path (2026-11-02)

**Task:** task_1793600762428_85914629 (adjacent surface found during task_1793600316582 characterization; sequenced after that wave landed = main 6ba629fb). Process: fleet-doc-propagation discipline, orch review gate before land.

**Approach = SURGICAL PATH-FIX (NOT full-replace).** The agent-management copies are genuine CONTENT VARIANTS (line counts 428/438/419 vs canonical 436, all distinct blobs), so a byte-identical full-replace would clobber per-agent variant content. The canonical `community/skills/agent-management/SKILL.md` (436 lines, blob `32bffffa...`) is already clean of the dead path, so the fix is the single dead line only:

`${CTX_ROOT}/state/<agent>/crons.json` -> `${CTX_ROOT}/.cortextOS/state/agents/<agent>/crons.json`

(ground-truth same as the prior wave: crons.json is nested; cron-state.json + .onboarded are the un-nested exceptions, untouched). **classify-before-clobber:** all copies ASSERT the path ("Crons are daemon-managed and persisted to ..."); none describe it as wrong, so surgical-fix is safe. No `.onboarded` on these lines.

**Count re-verified at wave start:** the task's "13 served" is the TOTAL agent-management served copies; the DEAD-BEARING subset is 10 (1 dead spot each). Split below.

---

## IN-SCOPE fix set (surgical path-fix)

### TRACKED (staged in this branch, under review)
| File | result |
|---|---|
| `community/agents/research-agent/.claude/skills/agent-management/SKILL.md` | dead 1->0, nested=1, em-dash unchanged (8) |
| `community/agents/security/.claude/skills/agent-management/SKILL.md` | dead 1->0, nested=1, em-dash unchanged (9) |

### GITIGNORED served (apply-on-approval) - 8 CGM agents
claude-dev-agent, codex-dev-agent, meta-compliance-agent, the-axon-agent, the-production-house, the-sop-keeper, vitalis, the-orchestrator. Each: 1 dead spot; apply-time per-file verify (dead=0, nested>=1, em-dash unchanged, `.onboarded` untouched). vitalis INCLUDED (infra skill, same ruling as the AGENTS.md wave) - dispositioned explicitly.

---

## ROUTE (atwood lane) - 2
`atwood-analyst` + `atwood-orchestrator` agent-management/SKILL.md (1 dead each) -> hand to atwood-orchestrator, same protected-transform + classify-before-clobber packet as the AGENTS.md route. (atwood-codex + atwood-dev have 0 dead = not in extent.)

## NOT-IN-EXTENT - 3 (0 dead, no change)
the-tax-planning-agent, atwood-codex-agent, atwood-dev-agent.

---

## FLAG (out of this path-fix scope)
The agent-management copies DIVERGE from the canonical in content beyond the path (variant landscape: 428/438/419 vs 436 lines, distinct blobs). Whether to UNIFY them to canonical is a separate content-reconcile decision - NOT part of this dead-path fix. Also several copies carry pre-existing em-dashes (research-agent 8, security 9, etc.) - a separate owner-routed clean if desired. Flagging, not fixing here.

---

## Execution (on orch approval)
- Tracked (2 community refs): land this branch (guarded-FF + destination-verify + gitleaks + backup push + ls-remote).
- 8 CGM served: apply surgical path-fix, per-file verify, one pass.
- Route the 2 atwood copies.
- Complete task_1793600762428. Then task_1793600767018 (guide em-dash clean) is next in the queue.
