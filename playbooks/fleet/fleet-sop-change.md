---
type: playbook
scope: fleet
process: fleet-sop-change
status: active
date: 2026-08-28
tags: [playbook, fleet, sop-change, migration, propagation, two-touch, deployment-coupling]
---

# Fleet-Wide SOP / Infra Change

How to change a process, template, or piece of infrastructure that EVERY agent runs, without a race window, a self-certified fleet edit, or a half-migrated fleet. The reference execution is the 2026-08-28 memory-file-local-day arc (retired the daily-memory-file `date -u` fragmentation class fleet-wide in ~1h from finding to fix, 7h ahead of deadline). Orch designated it the reference and asked the SHAPE be banked. This is that shape.

## The load-bearing asymmetry: TAUGHT-BUT-ABSENT is the only dangerous direction

Read this first - every sequencing call in this playbook is DERIVABLE from it, not a matter of taste.

When a change couples a TEACHING surface (docs, a boot file, a skill, a cron prompt) to a DEPENDENCY it calls (a helper script, a new flag, a new file, a renamed path), there are two possible transient states while the change rolls out:

- **TAUGHT-BUT-ABSENT** - a surface tells an agent to call something that is not there yet. This BREAKS: first heartbeat hits a file-not-found, a bad flag, a missing path. DANGEROUS.
- **PRESENT-BUT-UNTAUGHT** - the dependency exists everywhere but nothing calls it yet. This is INERT: unused code sitting harmless until the teaching lands. SAFE.

So the ordering is forced, never debated: **propagate the dependency EVERYWHERE first, land the teaching second.** "Helper-first, not atomic." An atomic land is not required and not even better - it just narrows a window that helper-first ELIMINATES. The only direction you must never be caught in is taught-but-absent. Every step below is this asymmetry applied.

## The arc (six phases)

### 1. Defect found -> interim protection the SAME hour

The moment you find the defect, ship a cheap interim guard (a footgun warning in `knowledge.md`, a one-line caveat at the call site) BEFORE building the real fix. This DECOUPLES the deadline from the build: nothing is time-pressured while the real fix is authored and reviewed, because the interim guard already caps the downside. A fix built under a countdown is a fix that skips its second look.

### 2. Build the fix + adversarial TWO-TOUCH

Author the fix, then route it to a second and (for anything security- or safety-adjacent) third independent reviewer - orch as land gate, dev/security on content. The review is not a formality; it is the value. On the reference arc the second look caught two things the author was blind to: a date-basis SCOPING gap and the deployment-COUPLING gate itself. **An author cannot certify their own fleet change** - the change touches every agent, and the blind spots are exactly what a fresh reviewer sees.

### 3. Deployment coupling -> helper-first sequencing

If the new docs will CALL a dependency, propagate the dependency EVERYWHERE before the docs land (the asymmetry above). "Everywhere" includes BOTH:

- the **template source** (`templates/*/scripts/`, `templates/*/.claude/...`) so NEW agents seed the dependency by construction, and
- every **existing live agent** dir.

A template with no `scripts/` dir means a newly-spawned agent seeds no helper and file-not-founds on first heartbeat - the template gap is as real as the 15 live agents. Seed the template FIRST of all (it is the correct-by-construction backstop), then the live dirs, then the teaching.

### 4. Canonicalize the homeless dependency + owner-execute + independent-verify

Elevate "where does this dependency canonically live?" to a GATING PREREQUISITE, executed by the dependency's OWNER (dev for a script), and independently verified by a NON-author, NON-propagator (security, plus a spot-check from analyst/orch). Separation of duties on the fan-out: the person who wrote it is not the person who certifies it landed correctly in 16 places. Give the owner a canonical source + its sha256 as the fingerprint baseline so every propagated copy is byte-verifiable against one origin.

### 5. Land: rebase onto CURRENT main -> re-QA the LANDING tip -> guarded ff-only -> seal

1. **Rebase onto current main first.** A stale base shows phantom deletions of dependencies that landed meanwhile (a sibling commit moved main past your base - see the cross-agent-dependency staleness class). Rebase resolves it.
2. **Re-run the FULL self-QA on the REBASED tip.** The QA must certify the tree that ACTUALLY lands, not the one you authored an hour ago. A QA of the pre-rebase tip proves nothing about what merges.
3. **Guarded ff-only from the main checkout.** Guards: on-main, HEAD == the branch base, target files not dirty, exactly 1 commit ahead. Gate the merge ITSELF on the guards - never print a warning beside an unconditional merge (that is a safety-substitute; see standing-rules).
4. **Seal the backup.** gitleaks + shape-guard from the MAIN checkout cwd (not the worktree - the pre-push config only resolves from main-repo cwd), push, report landed sha + seal.

### 6. Fleet propagation: classify before you clobber

Never blind-overwrite live agent files - they carry hard-won per-agent customization. CLASSIFY every target into buckets FIRST:

- **clean / old-template** (byte-matches the pre-change template) -> safe mechanical replace.
- **synced / new** (already carries the change) -> skip.
- **diverged** (customized at or near the change site) -> **targeted delta edit, NOT overwrite**; owner-diff-first for deep customization. Diverged is LARGE by design for live boot files - that is customization, not drift.
- **missing** -> seed fresh.

When divergence is DEEP (older base + customization AT the hunk sites, so hunks reject), **scope-split**: do the deadline-critical MECHANICAL part fleet-wide now (on the reference arc: the date-basis `.md`-suffix substring swap, context-free and safe on any divergence) and DEFER the divergence-sensitive part (the helper-call swap) to a per-file owner-reviewed fast-follow. This mirrors the review-SKILL ruling one level down: land the safe mechanical change on time, review the risky surgical change per-file.

Execution discipline for the mechanical fan-out: **dry-run -> reconcile the applied count to a pre-computed expected count EXACTLY (e.g. 204 == 204) -> snapshot each file -> literal edit -> per-file post-write re-read verify -> restore-on-fail -> INDEPENDENT grep re-verify across all files -> per-file definitional-reset marker -> FILE the deferral task BEFORE finishing.**

**The string can be context-free while the MEANING is not - scan for DESCRIPTIVE occurrences before the swap.** A substring safe on any divergence can still CORRUPT a doc that DESCRIBES the old value: a line documenting the wrong value AS wrong inverts into asserting the CORRECT value is wrong. So classify-before-clobber applies even to a context-free substring - the string is context-free, the meaning is not. Before the fan-out, scan targets for the old string in a describing (not instructing) context - markers `no such file` / `does not exist` / `the old` / `corrected` / `there is no` - and EXCLUDE or hand-handle those; a normalize-BOTH-sides collateral check (erase every insert from snapshot AND result, then they must be identical) catches the ones a one-sided check misses. Worked example (2026-09-08 cron-path served sweep): 29 of 30 boot files were prescriptive boilerplate and swapped clean; `the-team-lead/CLAUDE.md` had fixed the same path earlier and cited the old path as a "does not exist" example, so the blind swap inverted it (started calling the correct nested path nonexistent) - caught by the collateral check + a fleet-wide descriptive-marker scan, restored byte-identical, excluded. Carry the same descriptive-scan into any transform you ROUTE to another owner, so their copies get the protection, not just the substitution.

### 6b. Reverse sync-back (live -> tracked source) and the proof-by-normalized-diff

The arc also runs BACKWARDS: a live copy hand-edited during incidents drifts AHEAD of its tracked template, and the template must be brought current without (a) reverting the template's own legitimate lead (an edit the live copy lacks, e.g. a helper-swap) or (b) importing the live copy's violations into a governed source (e.g. em-dashes into a no-em-dash source). Rebuild the template FROM live, re-apply the template's known-ahead edits, and normalize the governed dimension in the template ONLY.

PROVE it substance-preserving with a **normalized diff**: normalize the same dimension (punctuation) in a TEMP copy of the source, then `diff temp vs your-result`. The only remaining hunks must be your intended substantive deltas (the preserved edits) - nothing else. That isolates "substance == source + normalization-only" from real content drift, the reverse-direction analogue of classify-before-clobber. Two records make the result legible later: mark the normalization explicitly (a punctuation definitional-reset: "em-dash -> hyphen, N sites, live NOT touched") so the resulting source-vs-live punctuation gap reads as intended, and name the tracked source as the CONVERGENCE REFERENCE so the eventual live cleanup converges TO it rather than re-diverging.

## Cross-cutting principles

- **Never trust a scripted bulk edit by its exit code or match counts.** Two silent-corruption hazards bit this same arc: perl `$(` in a replacement interpolates as the real GID variable (corrupted all files at once), and difflib/opcode block-replace fragment-corrupts non-byte-identical targets (left a mismatched heredoc). Diff the ACTUAL output, snapshot + verify each file, reconcile to the dry-run. For load-bearing multi-file edits the literal per-file Edit tool (fails closed on no-match) beats a clever one-shot script; when scripting, python `str.replace` (literal) beats perl/sed (metachar + var-interpolation traps).
- **Decouple the deadline from footgun-elimination.** The deadline is met by the MECHANICAL / coherence part (interim-covered, no time-coupling). The footgun elimination (routing writes through the helper) has interim coverage and no time pressure - defer it cleanly. This split recurred at three levels on the reference arc (review SKILLs, then live files).
- **Disclose scope calls; do not assume them.** Including vitalis in the MECHANICAL infra sweep (no content access) was a scope decision - flag it to orch, do not silently include or exclude a boundary agent.
- **The QA certifies the tree that lands.** Rebase, THEN re-QA. Every completeness scan runs against committed main (`git ls-tree` / `git show main:<file>`), never the shared checkout's working tree (routinely parked on another agent's dirty branch).

## Roles (who does what)

| Phase | Owner | Independent check |
|---|---|---|
| Interim guard | author (SOP-keeper) | - |
| Fix authoring | author | orch (gate) + dev/security (content) |
| Dependency canonicalization + fan-out | dependency owner (dev) | security + analyst/orch spot-check |
| Land + seal | author or orch (per delegation) | guards gate the op |
| Live propagation | author | independent grep re-verify + owner-diff on diverged |

Reviewed-branch workflow throughout: author on a branch off main, orchestrator reviews and merges. The author never self-certifies the fleet change.

## Origin

Reference arc: 2026-08-28 memory-file-local-day date-basis switch. Landed main `36b5f0aa` (docs) on dev's helper `0fe04560`; fleet propagation 204 date-basis switches + 112 unquoted-timestamp bug-repairs across 51 live files / 16 agents, 0 fails. Full detail: MEMORY.md ("The reference fleet-SOP-change arc") + daily `memory/2026-08-28.md`; tasks task_1787899425520 / task_1787933268752 / task_1787930511505.
