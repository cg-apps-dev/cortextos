---
name: upstream-check
description: "Daily READ-ONLY detection of new upstream cortextOS commits, with a self-maintaining mine-vs-theirs classification, so a human can decide per-update whether to keep-local / take-upstream / merge-both. Detect + notify only — the actual merge runs the upstream-merge runbook AFTER explicit per-pull approval."
triggers: ["upstream check", "check upstream updates", "upstream daily", "new upstream commits", "daily upstream"]
---

# Upstream Update Check (daily detect + classify)

The early-warning half of the upstream workflow. It runs daily, **read-only**,
and answers: *did upstream change, and does any of it collide with our local
customizations?* It **notifies only** — it never merges. The merge itself is the
separate, approval-gated `upstream-merge` skill.

> Pairs with **`community/skills/upstream-merge/SKILL.md`** — this skill DETECTS
> + CLASSIFIES + ROUTES the decision; that skill EXECUTES an approved pull.

## The daily cron (PART 1)

- **Schedule:** ~7am Adam's time (PT), daily.
- **Runs:** `check-upstream.sh` (next to this file) → `git fetch upstream`
  (read-only) → count `main..upstream/main` → classify each new commit.
- **0 new commits:** log a quiet event, send NOTHING. No noise.
- **>0:** build the summary (below) and send it to **the orchestrator** as an
  agent message. **Never message Adam directly** — route through the orchestrator
  (single voice); they relay with the decision framing.

## The classifier (self-maintaining — no stale list)

`check-upstream.sh` derives "what's mine" from git every run, so it can never go
stale as both sides diverge. The protect surface is anchored to the divergence
from **upstream/main** (the canonical upstream tip), regardless of which ref is
being compared.

For each new upstream commit it emits:
```
COMMIT|<short-sha>|<FLAG>|<subject>|<overlapping local paths,csv>
```
with three tiers:
- **`MINE-VS-THEIRS`** — the commit touches a file LOCAL also modified since the
  divergence point → a **direct git conflict**, and a feature decision.
- **`AREA-OVERLAP`** — the commit touches a **customized area** (same directory as
  a local change, different file) → likely **functional parallelism**; review.
- **`safe-pull`** — neither; almost certainly a clean pull.

It also emits totals: `OVERLAP_COMMITS`, `AREA_COMMITS`, `SAFE_COMMITS`.

> **The classifier is necessary, not sufficient.** It finds *file-level* overlap.
> Upstream often builds a **parallel feature in NEW files** (e.g. a unified usage
> monitor, or a codex app-server) that won't show as a file conflict but is still
> a mine-vs-theirs FEATURE choice. The agent MUST read the overlapping +
> area-overlap commits and add the functional judgment (below).

## The notify summary (what the agent sends the orchestrator)

When `>0`, send a concise summary:
1. **Headline:** `N new upstream commits — X mine-vs-theirs, Y area-overlap, Z safe-pull.`
2. **One line per commit:** sha · subject · flag (· overlapping paths for the flagged ones).
3. **Per parallel-feature SPECIFICS** (the core value — be concrete, not generic):
   for each overlap, say **what each side actually implements** so Adam can choose
   THEIRS knowingly — e.g. *"upstream's `feat/unified-usage-monitor` tracks Claude
   + Codex usage in `src/…`; ours is the dashboard usage cards (D1/D2 + Claude-vs-
   Codex) in `dashboard/src/…`. They overlap functionally; only `config.json`
   conflicts at the file level."*
4. **A recommendation per overlap:** `keep-mine` / `take-theirs` / `merge-both`,
   with the one-line why.
5. **Explicit:** read-only detection done; nothing merged; awaiting Adam's
   per-update decision.

## Decision → execution (PART 2 flow)

```
daily detect (this skill)
  └─ >0 → classify → summarize to orchestrator
        └─ orchestrator relays to Adam with framing
              └─ Adam decides PER UPDATE: keep-mine / take-theirs / merge-both / defer
                    └─ on approval → run community/skills/upstream-merge/SKILL.md
                          ├─ keep-mine   → exclude/revert upstream's version of that feature in the merge
                          ├─ take-theirs → adopt upstream's; drop or retire our local version of that feature
                          └─ merge-both  → integrate both; reconcile the file-level conflicts preserving both
```

### keep-mine / take-theirs / merge-both — how each lands in the merge
- **keep-mine:** during conflict resolution, keep our version of the overlapping
  files; if upstream adds a *parallel* feature in new files, decide whether to
  also drop those new files (else two systems coexist).
- **take-theirs:** adopt upstream's version; remove our now-superseded local
  feature (and update the protect-list so we don't "protect" something we chose
  to retire). Smoke-test that nothing else depended on the local version.
- **merge-both:** integrate both, reconciling file conflicts so both features
  work. Highest effort; only when the two are genuinely complementary.

## Guarantees / guardrails

- **Read-only:** fetch only; never merge, push, or touch the working tree. The
  remote push URL is `no_push`.
- **Notify only:** detection sends a summary to the orchestrator; it does NOT act.
- **Approval-gated execution:** no merge runs until Adam approves *that specific
  pull*; then the `upstream-merge` runbook executes it (snapshot-first, on a
  branch, full functional verify before main moves).
- **Self-maintaining:** the protect surface is regenerated from git every run —
  no hardcoded list to fall out of date.
