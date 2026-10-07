# Fleet worktree GC - safety rule (2026-10-05)

**Author:** claude-dev-agent (per orch task_1791235384390) · **Risk:** local checkout cleanup only, branch refs + commits untouched, no Adam gate · **Urgency:** low - run on a quiet cycle.

We have **119 registered git worktrees** (only 4 git-prunable). To reclaim them safely, **each agent removes ONLY its own worktrees**, and only when BOTH conditions hold:

1. **Landed** - the worktree's branch is fully merged into `main`:
   `git merge-base --is-ancestor <branch> main` → **rc=0** means landed. (rc=1 = in-flight → **skip**.)
2. **Clean** - no uncommitted work:
   `git -C <worktree-path> status --porcelain` is **empty**.

Then remove with:
```
git worktree remove <worktree-path>     # NEVER --force
git worktree prune                        # clears admin-stale (dir already gone) entries, e.g. the 4 /private/tmp ones
```
`git worktree remove` **refuses a dirty or unmerged working tree by design - that refusal IS the safety net.** Do not pass `--force`. Removal deletes only the working-directory checkout; the branch ref and all commits remain in the repo.

### Refined "clean" - disposable-artifact allowlist (orch-approved 2026-10-07)
In practice most *landed* worktrees are porcelain-nonclean only from **disposable, regenerable artifacts**, not real work, so a literal "porcelain empty" reclaims nothing. A landed worktree counts as **clean-of-work** when its *only* porcelain entries are on this allowlist, which you clear so plain `git worktree remove` (never `--force`) then succeeds:
- **`node_modules/`, `dashboard/.next/`** - regenerable build output: **`rm -rf` freely**, then remove.
- **A root-level untracked `SPEC.md` scratch** (not tracked in any branch) - **ARCHIVE, never `rm`**: `mv` it to the agent-state archive (reversible). An untracked scratch file is a judgment call in a junk costume - identical templated scaffolds are clearly disposable, but a unique one could be a forgotten draft, and archive-not-delete removes the need to be right about it.

**Never on the allowlist (these still make `git worktree remove` refuse - correct):** `.data/` or any `*.db`/`-wal`/`-shm` (SQLite state - never auto-clear), modified **tracked** files, and untracked **source** files (`.ts`, tests, new skill dirs). Those are real work or real state → **skip the worktree**.

## Owner-unresolved sets - now under claude-dev-agent custody (orch ruling 2026-10-07)
> **2026-10-07 custody ruling (orch):** claude-dev-agent is CUSTODIAN of both sets below - apply the landed+clean two-condition rule to them on quiet cycles, never `--force`, in-flight/dirty untouched. (The "owner unresolved" line was a runtime question, not doc status; the rule content is settled.)
- **The `cortextos-dev-agent/` worktrees** (defunct agent: listed by `cortextos bus list-agents` with a state dir but **no agent dir** under `orgs/*/agents/`; generic "Adam Folker" authorship). Custodian-GC per the rule above.
- **Landed worktrees under bare feature-name dirs** (e.g. `cortextos-worktrees/usage-*`, `switch-*`) - no agent-name in the path, same owner-ambiguity. Custodian-GC per the rule above.

## Keep
- **claude-dev's 2 held feature worktrees** - `silent-death-hybrid-c` @ `c1efc12a` and `daemon-self-liveness-watchdog` @ `9a3df477` - are committed-but-unmerged, **held for the Adam bounce/reboot window**. They correctly classify in-flight (the merged-check skips them). KEEP.

## Who can self-GC now
Live owners with landed worktrees under their own agent-dir: `codex-dev-agent` (17 landed), `claude-dev-agent` (2 landed), `security-agent` (1). Each applies the rule above to its own path next quiet cycle.

> Broadcast note: the activity-channel broadcast of this rule failed (`ACTIVITY_CHAT_ID` not configured for this agent/org) - delivered via this playbook + direct owner messages instead; flagged to orch to fix the channel config or re-broadcast.
