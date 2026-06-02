---
name: upstream-merge
description: "Runbook for safely pulling upstream cortextOS updates (grandamenium/cortextos) into a customized LOCAL copy without losing local changes or data. Snapshot-first, integrate on a branch (never main directly), preserve local customizations, build+test+functional-verify before main moves, and a total rollback path. PLAN/EXECUTE only with explicit human approval of a specific pull."
triggers: ["upstream merge", "pull upstream", "sync upstream", "merge cortextos updates", "update from upstream"]
---

# Upstream Merge Runbook

Pull future upstream cortextOS updates into a heavily-customized local copy
**without losing a single local change or any data**. The danger isn't the merge
command — it's (1) clobbering local work, (2) silently dropping a local feature
in conflict resolution, and (3) advancing `main` before you've verified nothing
broke. This runbook closes all three.

> **Gate:** a merge is an approval-gated action. Do the read-only prep + the
> inventory freely; do NOT run the actual merge until a human approves *this
> specific pull*.

## 0. Pre-flight (every time)

```bash
git remote -v                         # upstream fetch = grandamenium/cortextos; push should be no_push
git fetch upstream                    # read-only
git rev-list --count main..upstream/main   # >0 means upstream has new commits to consider
git rev-list --count $(git merge-base upstream/main main)..main   # local commits AHEAD (your protect-list size)
```

If `main..upstream/main` is 0, **there is nothing to merge** — stop.

Set the remote read-only once (no-push constraint): `git remote set-url --push upstream no_push`.

## 1. Regenerate the protect-list (do NOT trust an old one)

Every pull, rebuild the list of local commits + files so nothing is forgotten:

```bash
MB=$(git merge-base upstream/main main)
git log --oneline "$MB"..main                 # every local commit (the protect-list)
git diff --name-status "$MB"..main            # A=added (low conflict) / M=modified (real risk)
```

Write down what each local feature is and how you'll smoke-test it post-merge
(the functional checklist in §5). **This list is load-bearing — a feature not on
it is a feature you can silently lose.**

## 2. Map the risk BEFORE merging

```bash
git branch -r | grep upstream          # which upstream branches/PRs touch your areas?
git diff --stat main..upstream/main    # what upstream changed
```

Cross-reference: where do **upstream's changes overlap your MODIFIED files**?
Those are your conflicts. Watch especially for:
- **Renames** (upstream moving files you edited → rename/delete conflicts).
- **Parallel features** (upstream building its own version of something you
  built locally → the merge may *supersede* your local work; decide keep-mine vs
  adopt-theirs vs both, per feature).

## 3. SNAPSHOT first (the safety net)

Before touching anything — a double rollback anchor:

```bash
git tag    "pre-upstream-merge-$(date -u +%F)" main
git branch "backup/pre-upstream-$(date -u +%F)" main
```

(Off-machine backup e.g. Backblaze complements this for the gitignored agent
workspaces that git doesn't track.)

## 4. Integrate on a BRANCH — never on `main` directly

```bash
git switch -c "merge/upstream-$(date -u +%F)" main
git merge upstream/main          # MERGE, not rebase — preserves local commits + provenance
```

Resolve conflicts **preserving local**:
- Keep BOTH local feature + upstream change when compatible.
- For overlap/parallel features: decide per-feature (keep local's working
  version, OR adopt upstream's and re-apply local customizations, OR keep both).
- For local doc-fixes on files upstream also changed: re-apply the *intent* of
  the fix onto upstream's new version (don't blindly take either side).

## 5. Verify BEFORE advancing main

```bash
npm install && npm run build && npm test     # must compile clean + all tests pass
```

Then **functionally smoke-test every protect-list feature** on the running
system (dashboard on :3000 + CLI) — not just "it builds". Confirm each local
feature still renders/runs. If anything is missing or broken, fix it on the
integration branch (or roll back, §7) — `main` has not moved yet.

## 6. Advance main + redeploy (only when green)

```bash
git switch main
git merge --no-ff "merge/upstream-$(date -u +%F)"
npm run build                                # npm-linked -> deploys to the live binary
# restart affected agents if framework/daemon code changed
```

## 7. Rollback (if anything went wrong)

Because `main` was never touched until verified, rollback is clean and total:

```bash
git switch main
git reset --hard "pre-upstream-merge-$(date -u +%F)"   # main back to exactly pre-merge
git branch -D "merge/upstream-$(date -u +%F)"           # discard the integration branch
```

Keep the `pre-upstream-merge-*` tag for several days after a successful merge
(until it's confirmed good in real use) before deleting it.

## Definition of done

Upstream's new commits are in `main`, **every protect-list feature is verified
present + working**, `npm run build`/`npm test` pass, and the pre-merge snapshot
exists as a rollback anchor. If any local feature can't be confirmed, it is NOT
done — say so and either fix it or roll back.

## Notes

- **Merge, not rebase** — rebase rewrites local commits (incl. merge commits) and
  loses provenance; merge preserves the local history and brings upstream in cleanly.
- **Selective beats full when divergence is heavy** — for a small upstream change
  you want, a `git cherry-pick` onto an integration branch can be safer than a
  full merge.
- **Reduce future conflicts**: keep customizations in *separate* files/modules
  where feasible (new files rarely conflict); and where a local change is a
  genuinely-general fix to an upstream file, consider upstreaming it as a PR so it
  stops being perpetual local divergence (needs push access).
