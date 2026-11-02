# FINDINGS - serve gap: main ahead of parked checkout (9 FINDINGS + standing-rules) (2026-11-02)

**Task:** task_1793606764533_37540804. Step-3c heartbeat recorder (orch, 08:02Z) flagged `playbooks_vs_main` missing=9 wrong=1 extra=12(benign). ONE root mechanism; two halves.

## Mechanism
The 11-01/11-02 propagation waves landed on the `main` ref via `git update-ref` from throwaway worktrees (shared checkout left untouched - correct: it is parked on `feat/usage-cred-pre-death-signal`, dev/codex S3 work). So landed docs exist on the ref but are NOT SERVED on disk, and a tracked doc updated on main serves stale on the parked branch. Expected cost of land-via-worktree-while-parked, surfaced by the recorder as designed.

## (a) 9 unserved FINDINGS - RESOLVED (the-sop-keeper)
The 9 absent docs (all mine, 11-01/11-02 waves: agent-auth-amendment; cron-management fullpropagate/wave3/wave4; fleet-doc-propagation-community-publish; dead-cron-path-residuals; agent-management-dead-cronpath; agent-management-variant-landscape; guide-emdash-clean) were served by `git show main:<path> > <path>`, blob-verified 9/9 identical to main. They land UNTRACKED on the parked branch (do not exist on `feat/usage-cred`) = zero tracked-state dirtying. This RESOLVED the dangling pointer: the canonical agent-management L12 PROPAGATION WARNING references `FINDINGS-agent-management-variant-landscape-2026-11-02.md`, on the ref but not on disk until served.

## (b) standing-rules.md 32-line-stale - RESOLVED main-current, after a 7-message / 4-physical-state oscillation
Served blob was `5d4d2f51` vs main `d1f969d0` (32 lines behind = two real security-agent standing rules: chained-external-reader corollary + reassurance-higher-bar, both JUDGMENT-LEVEL / verified-once).

The honest sequence (recorded per orch; sub-minute message crossings throughout):
1. **orch -> dev: overwrite-now** (severity ruled off the surface name, delta unread).
2. **the-sop-keeper (task owner): counter-proposal serve-on-S3-land** - do not have a non-owner dirty a tracked file in a parked checkout; read the actual 32-line delta (2 guidance rules, not a runtime gate); auto-resolves at S3 merge.
3. **dev executed the overwrite** (~12s before the owner proposal landed) with a safe-to-copy pre-check (zero wt-unique, wt==branch HEAD).
4. **orch countermanded dev** on the owner argument -> dev **reverted** to `5d4d2f51` (before orch's later void-the-countermand arrived).
5. **orch froze** on the reverted state (stop-rule: freeze-on-acceptable beats last-instruction-wins; no 4th state in 10 min).
6. **dev processed the void AFTER their revert and RE-APPLIED the overwrite** (`d1f969d0`, locked-to-keep; dev endorsed the content-read on merits - verified safe-to-copy, noted they had skipped needed-to-copy).
7. **orch issued ONE CONVERGENT TERMINAL INSTRUCTION** - state-keyed not message-keyed: "if hash==`d1f969d0` touch nothing, else set once; all prior in-flight instructions voided by id." All actors converge on the physical state, not on a message order.
8. **Two independent instruments confirm the terminal state:** the-sop-keeper blob-oracle read of live disk (`git hash-object` = `d1f969d0`, touched nothing per the convergent rule) AND dev self-report hash confirm (dev `..pea2r`: `d1f969d0`, convergent rule applied = touched nothing). Agreement on first application of the convergent instruction = thread terminated.

**CLOSING SPECIMEN (the-sop-keeper):** mid-sequence, a blob read of live disk returned `d1f969d0` while the coordination narrative said `5d4d2f51` was the frozen state. Rather than bank the narrative, the task owner HELD the FINDINGS and raised the contradiction with the blob fact. It resolved in agreement (disk was already the terminal target) - but the move is the discipline in one step: refuse to record a state the disk contradicts, verify the artifact over the summary. A blob-oracle read of live disk after a multi-party write is ALSO a fresher, different-instrument state confirmation than a self-report.

**FINAL STATE:** standing-rules serves `d1f969d0` MAIN-CURRENT; `M` not-staged, known+attributed; recorders `playbooks_vs_main` 0 missing / **0 wrong** / 12 benign-untracked; net churn one `M`; self-resolves at the S3 (usage-cred) merge; bounded fallback = dev merges main into the branch by Tue 16:00Z if S3 has not landed (moot if the `M` holds). (Pending dev one-line hash confirm, orch-forwarded, before this doc lands.)

## Durable lessons
- **Coordinator convergent-instruction rule (upgraded, orch-owned):** for multi-party ops on a MUTABLE artifact under message latency, the coordinator issues ONE STATE-KEYED convergent instruction ("if state==X touch nothing, else set once; prior voided"), never a SERIES of state-dependent message-keyed ones. 7 messages / 4 physical states / every actor correct-on-latest-seen = the proof that message-order coordination cannot converge under latency; state-keying can.
- **Race-closers (both ends):** orch owner-first-read (a task-owner proposal on a shared artifact gets first read before anyone executes) + the-sop-keeper "proposal, not yet executed - hold" flag on any shared-artifact proposal. Intermediate: the stop-rule (freeze-on-acceptable).
- **serve-on-S3-land** stays the default for the NEXT instance where the owner has NOT acted (a non-owner must not overwrite a tracked file in a parked checkout they do not own).
- **land-then-serve** while the checkout is parked off-main: any doc landed to main via worktree must also be served to disk (untracked copy) or it re-opens this gap. This FINDINGS doc is landed + served in one pass as the recursive proof.
- **Blob oracle over grep-c / narrative:** every state call here was made on `git hash-object` / `rev-parse`, not grep-c (orch's own grep-c read a false 0/0 vs blob-truth 0/32) and not on the message narrative (which lagged the disk by up to 2 states).
- **Dev's half (served-content fix):** a served-content fix needs BOTH a safe-to-apply read AND a worth-applying-now read. Dev's pre-check verified safe-to-copy but initially skipped needed-to-copy (the delta-materiality read the task owner supplied). Both reads are required before applying.
