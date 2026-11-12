---
name: fleet-doc-propagation
description: Propagate a canonical fleet doc/skill to its copies via stage-review-verify discipline.
created: 2026-11-01
created_by: auto
trigger: "A canonical fleet doc or skill (e.g. a SKILL.md, a bootstrap doc, an amendment) must be propagated to its template + per-agent copies, or copies have drifted from canonical and need reconciling"
source_task_id: task_1793549441735_35973825
version: 1
status: active
---

## Purpose

Propagate a canonical fleet document (skill, bootstrap doc, amendment) to its template and per-agent copies safely and verifiably. Proven across 4 waves on 2026-11-01 (agent-auth amendment + cron-management clean/full-propagate/variants/canon-ack). Prevents the two failure classes this work keeps hitting: spreading a defect fleet-wide, and silently deviating from the agreed source.

## When to Use

- A canonical doc changed and its copies (templates + per-agent `.claude/skills/...` + community refs) must catch up.
- Copies have drifted and need reconciling to canonical.
- NOT for a single-file edit with no copies, and NOT for live-code changes (docs/skills only).

## Inputs Required

- `$CANON` - path to the canonical source file (the agreed source of truth).
- `$COPIES` - the set of copies to bring in line (tracked templates/refs + gitignored per-agent copies).
- `$TASK_ID` - the bus task tracking this propagation.

## Steps

1. **Inventory + characterize (byte-exact, never a `$`-bearing grep).** Enumerate every copy (`find ... -path "*/.claude/skills/<name>/SKILL.md"` for live; `git ls-tree -r main` for tracked). Classify each by BLOB HASH vs canonical (`git hash-object`), not by content grep. For a dead-string negative check, use a fixed-shape grep (`grep -F`, or a metachar-free shape) - a `$` in a pattern is a regex end-of-line anchor and silently never matches (banked lesson).
2. **Classify intent per copy:** byte-identical-class (full-replace candidate) vs intentional-variant (agent-behavioral content the canonical lacks). For a variant, build a section-by-section REDUNDANCY TABLE citing where each section already lives (AGENTS.md / canonical) or marking UNIQUE; unique bits get a proposed migration destination. Never blind-replace a variant. **Cross-org / privacy inclusion:** when the copy set spans ORG BOUNDARIES (e.g. adam-personal, atwood) or PRIVACY-ISOLATED agents (e.g. vitalis), FLAG those copies for an explicit orch inclusion ruling rather than assuming in-scope. Encode the ask, not the outcome: infra skills have historically been ruled in-scope for them, but the ask-first is the rule (today's vitalis precedent).
3. **Stage on a worktree off main** (`git worktree add -b <branch> <path> main`) - NEVER switch the shared checkout (it is usually on another agent's dirty branch). Make tracked edits there; apply surgical-amendment (preserve structure, change only the amendment + depth-adjust any relative links per copy depth) OR byte-identical full-replace as classified.
4. **Write a FINDINGS doc** in `playbooks/fleet/`: the full landscape, the exact change, a per-copy VERIFY SPEC (`git hash-object <copy> == <blob>` for replace; anchored checks for amendments), scope flags, and any canonical-level defects found (flag, do not silently fix outside scope). Scan it + every edited file for em-dashes (0) before commit.
5. **Two-party control - orch review gate.** Commit scoped (`git add <specific files>`, NEVER `git add -A` - the ecosystem.config.js and others must never be swept). Hand the branch to the orchestrator; they review (and eyeball any human-judgment items, e.g. em-dash substitutions). A post-greenlight or post-review change is a FRESH COMMIT, never an amend.
6. **Apply (on approval):** gitignored live copies get the canonical/amendment written in, hash-verify each == target blob, one pass. Tracked copies land via the branch.
7. **Guarded-FF land:** gate the `update-ref` on merge-base==main (true-FF) AND main-not-checked-out-in-any-worktree (`git worktree list | grep '[main]'`) AND use the CAS old-value form (`git update-ref refs/heads/main <new> <expected-old>`). Gate the dangerous op itself, never an `echo` beside it (safety-substitute lesson).
8. **Destination-verify on the REF** (`git show main:<path>` / `git rev-parse main:<path>`), not the working tree.
9. **Backup push:** from the MAIN checkout (not the worktree - the pre-push gitleaks config only resolves from main-repo cwd). Explicit `gitleaks git . --log-opts="<old>..<new>" -c scripts/hooks/gitleaks-backup.toml` (rc=0), then `git push backup main` (pre-push hook re-scans), then `git ls-remote backup refs/heads/main` == the new sha.
10. **Close out:** complete `$TASK_ID` with the verify results (auto-emits `task_completed`), remove the worktree.

## Output

Canonical propagated to all in-scope copies (byte-identical or surgically amended), landed on main + backup, with a FINDINGS doc recording the landscape, verify results, and any flagged out-of-scope follow-ups. The bus task is completed with the blob + land + push results.

## Approval Gate

- **Step 5 (orch review gate):** mandatory two-party control before any copy is touched / before landing. Hard authority rule: never unilaterally edit live agent files or the brain repo; propose via branch, orch (or Adam) approves, then execute.
- **Step 9 (backup push):** outward-facing; delegated explicitly by the orch per wave (do not assume).

## Notes / Edge Cases

- **One wave at a time (standing rule, all 4 passes):** concurrent propagation waves are PROHIBITED. Sequence them - wave N+1 stages only AFTER wave N has landed - so any defect found later is attributable to exactly one wave. Do not stage a dependent follow-up wave against an unlanded branch.
- **Grep false-negatives:** `$`-anchor (use `grep -F`/anchored shape); BRE `\|` alternation on macOS (use `-E`); `grep -c` counts lines not occurrences (use `-o | wc -l`); the shadowed `grep` wrapper respects `.gitignore` (use `git grep` for repo-wide "is it fixed everywhere"). The real gate is always a byte-exact hash, never a secondary grep alone.
- **Relative links in an amendment** need per-copy depth adjustment (e.g. 3-up canonical / 5-up template / 7-up `orgs/<org>/agents/<agent>/.claude/skills`); resolver-verify each resolves before write.
- **Canonical can itself be defective** (em-dashes; a stale/wrong instruction; a tool-contract claim that is false - verify a doc's asserted tool behavior against the tool, e.g. `update-cron-fire --interval` cannot take a cron expression). Clean canonical FIRST (owner-routed, audited), then propagate the cleaned source - never spread a defect, never deviate from byte-identical.
- **Paths are not uniformly nested:** verify a path against the live filesystem before "fixing" it even when a sibling path IS nested (`cron-state.json` is un-nested while `crons.json`/`cron-execution.log` are nested).
- **Intentional variants stay variants** (e.g. codex plugin copy) - record the divergence as intentional so a future sweep does not read it as drift; carry deferred harmonizations as a RIDER in the FINDINGS, not a floating intention.
