---
type: playbook
agent: the-orchestrator
process: merge-and-backup
status: active
date: 2026-07-09
tags: [playbook, orchestrator, git, review, backup]
---

# Merge Review + Backup Push

How agent-authored branches land on local `main` and reach the off-machine backup. The fleet's doc/code agents never self-merge or push; this is the single exit lane (live-proven daily; the pre-push guard blocked a real leak-shape on 2026-07-09).

## The lane

1. **An agent hands a branch** (worktree off local `main`), stating its review lane:
   - **Descriptive-of-live-state** (ground-truthed against live crons/scripts/launchd): orchestrator diff-reviews + merges, then cc's the process owner POST-merge.
   - **Verbatim owner rule text** (e.g. a compliance rule block): the owning agent drift-checks the committed tip PRE-merge (byte-identical standard) before the orchestrator merges.
2. **Review + merge to local `main`** (ff or merge commit; the orchestrator may carry small factual addenda in the merge commit message rather than costing the author an amend cycle).
3. **Push `main` to the private GitHub backup** (Adam's web-browsable copy). The push runs through the **pre-push guards**: leak-scan (gitleaks) + shape-guard (blocks instance-specific values - absolute home paths, machine names - in committed files). A guard block = revert or rework the offending commit; the guard is the control, not an obstacle.
4. **Completion**: the author's task completes on merge; the author cleans its worktree/branch.

## Standing rules

- Agents never push to the backup remote; only the orchestrator does, post-review.
- Amends that strengthen a deliverable go in BEFORE owner sign-off; after sign-off they void the attestation.
- No-patch verification outcomes are deliverables too - recorded in the handoff, not silently dropped.
