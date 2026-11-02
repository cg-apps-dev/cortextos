# FINDINGS - codify FILE-ON-CITE + CLASS-CANDIDATE into guardrails-reference (2026-11-02)

**Task:** task_1793027135591_43529316 (G2, gate opened ~11-02 after ~1 week live use). Orch HELD-UP CONFIRMED (file-on-cite applied 3x unprompted this cycle: tasks 762428/767018/256578 filed at compose-time; 2nd-occurrence rule drove two; row text stable in orch GUARDRAILS.md since 10-26). Orch scope ruling = (B) characterize the guardrails-reference landscape FIRST, then codify per classification. One wave, fleet-doc-propagation discipline, review gate before land.

## The delta (verbatim, from orch GUARDRAILS.md - primary source)
The red-flag row: trigger "CITING a known open class/gap in any coordination artifact" -> **FILE-ON-CITE (theta 2026-10-26)**: a classed item enters a compose surface ONLY with a task id attached; if none exists, filing the task is PART of composing, same action block; the compose surface is the only chokepoint (a sweep cannot catch an absent record). Beneath it the **CLASS-CANDIDATE marker**: first occurrence may stay a memory note but MUST carry "CLASS-CANDIDATE, file on recurrence" (compaction resilience, analyst addendum: without it a session boundary resets 2nd-occurrence to 1st); SECOND occurrence = class = second-occurrence-files. Origin specimen: evening-review-lost-to-host-sleep (task_1792998403740). Row carries 0 em-dashes.

## Landscape (characterize-first, per scope B)
27 guardrails-reference/SKILL.md copies (6 tracked + 21 served), same variant shape as agent-management (per-agent + templates, no single community/skills canonical). EVERY copy has exactly ONE `## How to Use` section immediately after the Red Flag Table, and ZERO file-on-cite. So the insertion anchor is STRUCTURAL and UNIVERSAL: add the row as the last Red Flag Table row, contiguous, right before `## How to Use`. This makes the transform UNIFORM across all copies - byte-identical RESULT on the dominant canonical-class, surgical RESULT on each variant, SAME operation.

Blob groups (pre-codify):
- **Canonical-class `e6cb7862` (59L):** templates/agent, templates/orchestrator, community/agents/research-agent (tracked) + served tax-planning, claude-dev, cro, meta-media-buyer, research-agent, the-ad-strategist, the-axon, the-production-house, the-sop-keeper, vitalis + atwood-dev, atwood-orchestrator. Codify -> ONE new blob `daa574fd` (verified: the 3 tracked share it).
- **Variants (each its own new blob, surgical-result):** templates/analyst + atwood-analyst (`795ca2cd` 67L); templates/agent-codex + codex-dev + atwood-codex (`f6b2c8bf` 54L); community/agents/security (`64f0ea9d`); meta-ads (`76274add` 61L); meta-compliance (`324635ab` 113L); security-agent (`3a256bee`); the-analyst (`4e2a6a15` 68L); the-orchestrator (`70bf715a`); the-team-lead (`08ba1f1c` 66L).

classify-before-clobber: all copies ASSERT (no describe-as-wrong; file-on-cite absent everywhere), so the insert is additive-only, no inversion risk. The row inserts into whatever rows each variant already has, preserving them.

## Scope split
### TRACKED - staged in this branch (6)
templates/agent, templates/orchestrator, community/agents/research-agent (canonical-class -> `daa574fd`); templates/analyst, templates/agent-codex, community/agents/security (variants, surgical). Each: foc=1, anchor intact, em-dash delta +0 (row is hyphens-only).

### GITIGNORED served - apply-on-approval (17 CGM + adam-personal)
e6cb7862 class (10): tax-planning (adam-personal), claude-dev-agent, cro-agent, meta-media-buyer-agent, research-agent, the-ad-strategist, the-axon-agent, the-production-house, the-sop-keeper, vitalis. Variants (7): codex-dev-agent, meta-ads-agent, meta-compliance-agent, security-agent, the-analyst, the-orchestrator, the-team-lead. vitalis INCLUDED (fleet guardrail, same ruling as prior waves). Apply = same uniform insert; per-file verify foc=1, anchor=1, em-dash-unchanged, no `.onboarded`-style collateral.

### ROUTE atwood (4) -> atwood-orchestrator
atwood-dev-agent, atwood-orchestrator (e6cb7862); atwood-analyst (795ca2cd); atwood-codex-agent (f6b2c8bf). Same packet shape as the prior cross-org handoffs.

## Verify spec
Per copy: `grep -c FILE-ON-CITE == 1`, exactly one `## How to Use`, the row is contiguous with the table (no blank line between it and the prior row), em-dash count unchanged (+0). Canonical-class copies additionally hash == `daa574fd`.

## Execution (on orch approval)
Land tracked (6) on main (guarded-FF + dest-verify + gitleaks + backup push + ls-remote) + serve to disk (land-then-serve, parked-checkout). Apply the 17 served. Route the 4 atwood. Complete task_1793027135591.
