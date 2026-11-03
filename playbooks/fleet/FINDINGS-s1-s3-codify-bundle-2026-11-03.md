# FINDINGS - S1-S3 codify bundle (2026-11-03)

**Task:** task_1793721854008_54339103 (11-02 evening-review proposals, routed 11-03 morning). One bundle branch, one FINDINGS, single orch review gate. Additive-only, same wave method as the store-location land. 4 items (S1 split into S1a/S1b per orch's asymmetric placement ruling).

## S1a - convergent-instruction FULL row -> guardrails-reference skill (fleet-wide)
New red-flag row (trigger: coordinating a change to a shared MUTABLE artifact across agents under message latency; action: ONE state-keyed convergent instruction, never serial message-keyed ones; verify physical state over narrative; task-owner-proposal-first-read). Inserted before the universal `## How to Use` anchor, same proven method as file-on-cite. 2nd occurrence of the class (1st = the 2026-11-03 serve-gap 8-message/4-state oscillation). STAGED 6 tracked (templates/{agent,orchestrator,analyst,agent-codex} + community/agents/{research-agent,security}); 17 served + 4 atwood on approval (same set as the file-on-cite wave).

## S1b - ONE-LINE row -> ORCHESTRATOR-scoped GUARDRAILS.md ONLY (asymmetric, orch ruling)
Condensed one-line version of the same rule, into orchestrator-scoped GUARDRAILS.md ONLY - NOT the 14 specialist bootstraps. **Reason (orch 2026-11-03):** the trap is coordinator-specific (multi-party rulings on a mutable shared artifact under latency); a specialist never issues serial rulings, so a fleet-wide bootstrap row is noise for 14 of 16 agents. Full row lives in guardrails-reference (S1a); the bootstrap carries only the one-liner + a pointer. STAGED: templates/orchestrator/GUARDRAILS.md (tracked, row before the "complete red flag table" pointer). On approval: the-orchestrator served GUARDRAILS.md + atwood-orchestrator route. NO other agent GUARDRAILS.md.

## S2 - output-contract addendum -> bus-reference skill (fleet-wide)
New `## Output-contract sharp edges` section (4 specimens, output-contract / sharp-edge-12 class): (1) `read-all-heartbeats` is TEXT not JSON, NO age_hours field; (2) `list-tasks` ids embed epoch-ms, use `--format json`; (3) the default text view TRUNCATES rows (19-vs-109 specimen) - use `--format json` for an accurate count; (4) `create-task --priority` rejects `medium` (valid: urgent/high/normal/low). Inserted before the universal `## Quick Reference` anchor (present once in all bus-reference copies). STAGED 6 tracked; served + atwood on approval.

## S3 - post-midnight rollover line -> HEARTBEAT.md Step-10 (PARTIAL + flag)
Rollover note: the FIRST cycle after local midnight also re-ingests YESTERDAY's memory file (it may have gained chunks after its last pre-midnight ingest; proven 2026-11-03, 7 chunks recovered). STAGED 3 templates (agent, orchestrator, agent-codex) via EOF-append (Step 10 is the last section there).
**FLAG (S3 variance, orch decision):** templates/analyst + templates/hermes HEARTBEAT.md have a DIFFERENT structure - no `## Step 10` header, re-ingest not the last section (hermes reorders to Step 7/8 after; analyst's ingest is a mid-doc block). EOF-append does not fit them; S3 placement there needs a per-template anchor (after their re-ingest block). Held for the orch's call - handle per-template at served-apply, or rule hermes out-of-scope (not in the active CGM roster).
**SEPARATE FLAG (out of scope):** HEARTBEAT.md Step-10 is itself a currency variant landscape - the TEMPLATES use the OLD raw `cortextos bus kb-ingest ./MEMORY.md ...` form (x2, with the zero-branch guard), while SERVED copies use the newer `./scripts/kb-ingest-verified.sh` script. A separate currency wave, not this bundle.

## Verify / scope
- Tracked staged (16): S1a 6 guardrails-ref + S1b 1 orch-GUARDRAILS + S2 6 bus-reference + S3 3 HEARTBEAT. Each: token present once, anchor intact, em-dash delta +0 (all 4 blocks hyphens-only).
- Served apply-on-approval: S1a 17 (file-on-cite set, incl vitalis) + S1b 1 (the-orchestrator) + S2 served set + S3 served-with-Step-10. Atwood routes: S1a 4, S1b atwood-orchestrator, S2 4, S3 per-structure.
- classify-before-clobber: all additive, tokens absent everywhere, no inversion.

## Execution (on orch approval)
Land tracked (guarded-FF + dest-verify + gitleaks + backup push + ls-remote) + serve FINDINGS. Apply served per item. Route atwood. Resolve the S3 analyst/hermes placement per orch ruling. Complete task_1793721854008.
