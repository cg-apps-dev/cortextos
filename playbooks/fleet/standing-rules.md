---
type: standing-rules
scope: fleet
status: active
date: 2026-07-08
tags: [fleet, standing-rules, governance]
---

# Fleet Standing Rules

The canonical home for cross-agent STANDING RULES - hard rules every agent follows, distinct from the per-agent playbooks (which document a single agent's process). A playbook says "here is how this process runs"; a standing rule says "here is a constraint that holds across the fleet, regardless of process." Rules live here, beside the processes they govern.

Each rule is titled, dated, and states the rule + why it exists. New rules land here as they are ratified. The fleet-wide non-negotiables that are structural to every agent (no em dashes; Pacific Time for human-facing times) live in each agent's `GUARDRAILS.md`; this file is for cross-agent operating rules that are not per-agent guardrails.

## Standing rule: playbook maintenance is part of Definition of Done

**Rule.** Updating the affected playbook is part of the definition of done for any workflow, cron, or skill change. A change is not "done" until the playbook that documents it is current - the code/config change and the playbook update land together, not as a follow-up.

**Why.** The playbook tree is only trustworthy if it is continuously current. A workflow that changes without its playbook updating silently turns the SOP into a stale claim - the exact failure mode the playbook system exists to prevent. Treating the doc update as optional or deferrable is how documentation rots; treating it as part of "done" is how it stays load-bearing. The-sop-keeper maintains the tree, but the trigger is any agent's change: flag the-sop-keeper (via the-orchestrator) on any workflow/cron/skill change so the playbook is updated via a reviewed branch, never a silent live edit.

**Applies to.** Every agent, every workflow/cron/skill change. See the fleet playbook index at [../README.md](../README.md).

## Standing rule: every caught error becomes a codified gate (error-class registry)

Ratified 2026-07-08 PT (Adam accuracy directive, orchestrator-approved plan WS-A3).

**Rule.** Every fleet error caught by Adam or any agent gets encoded within ONE DAY of being caught: always as a playbook gate (a terse DONE-WHEN post-condition in the owning playbook), and additionally as a scripted machine check where one is feasible. The error class is registered below so the same class is never re-solved from scratch. Route: the catching/owning agent root-causes its own lane; the-sop-keeper codifies via reviewed branch; the-orchestrator merges.

**Why.** The col-A previews case proved that a documented rule an agent is trusted to remember is necessary but not sufficient - accuracy comes from enforcement. Machine-checkable gates fail loudly when a step's output is wrong; prose does not. Registering the class (not just the instance) is what turns one mistake into fleet-wide immunity.

**Gate placement boundary.** Verify-gates live in PLAYBOOKS (on-demand reads) and scripts, never in boot files - hardening adds zero boot weight. Gates are one terse DONE-WHEN line per step; gate-bloat is its own accuracy risk (agents skim long checklists).

### Registry (seed entries, 2026-07-08 PT)

| Error class | Origin case | The gate |
|---|---|---|
| Stale verdict trusted on a rebuilt/re-superseded asset | col-B IMG_376 (stale FAIL wrongly gated 2 clean variants) | Re-scan-on-touch, file-id-anchored freshness check - authoritative rule in [../meta-compliance-agent/scan-and-verdict.md](../meta-compliance-agent/scan-and-verdict.md), pointers in consuming lanes |
| Impossibility asserted without verification (premise drift) | Axon lane: "no API draft path" meant unwired-for-us, not impossible - the Campaign Management API existed all along | Before recording "X is impossible / has no API / cannot be done", verify against the primary source; record "unwired for us" when that is what is actually known |
| Template mirrored from a live artifact propagates its defects | col-A previews: manual intake mirrored an already-incomplete row as its column template | Derive column-sets/templates from the SPEC list (skill/playbook), never by copying a live row/file; a live artifact is not a spec |
| Migration silently drops a side path | col-A previews: bearer migration took the engine (which built previews correctly) out of the loop; the manual fallback lacked its gates. Recurring class: bearer kills the connector bridge; python sync leaving stale bytecode | ANY runtime/auth/tooling migration gets a POST-MIGRATION FUNCTIONAL SWEEP of every lane it touches - not just boot-clean. Any manual fallback carries the SAME machine-checkable gates as the path it replaces. Scripted-check candidate |
| Live credentials aggregated at rest in synced storage | 2026-07-08 PT: an agent-key copy in owner cloud storage led to discovery of a live-credential aggregation there; owner confirmed never-shared, accepted the risk, retained it as his private store (no rotation required); outside automated scan scope (resolved handling per security-agent; deliberately path-free) | Fleet side unchanged: keys go straight to `.env` (0600), never into .rtf/synced/exportable files, shred delivery files after apply. When a cred-at-rest IS found: scope the WHOLE container before disposition (single-file tunnel vision misses aggregation); owner-personal stores are the owner's decision; registry/doc entries stay path-free - a pointer to a leaked location is itself a leak-amplifier |
| Two authoritative rules with opposite defaults meeting at an undistinguished boundary case | Intake dedup: the Card-ID-authoritative rule (ignore file-id MISSING lists - guards re-EXPORT, origin: a 20-duplicate-row incident) vs the re-EDIT rule (new creatives on an old card MUST be intaken). Applied naively, the second recreates the first's incident: zero file-id overlap misread as "all new". Both rules were correct for their own case; the boundary between the cases was never written down | When two hard rules collide, the fix is a DISTINGUISHER for the boundary case, never picking one rule to win: encode the test that selects which rule applies (here: re-EDIT vs re-EXPORT decided by variant-identity + newer-finished-subfolder, not file-id), cross-reference it at BOTH rule sites so they stop contradicting, and default-to-FLAG-for-human on the ambiguous middle. Refinement (mc): the human flag holds only the ROW disposition - a compliance verdict never waits on it (immediate re-scan, or a SUPERSEDED/do-not-trust stamp). Encoded at meta-ads clickup-intake STEP 5 + the meta-intake Card-ID rule cross-ref |
| Cross-method fingerprint mismatch (same secret, different hashes) | Security cred-reconciliation near-miss 2026-07-08 PT: `echo "$s" \| shasum` hashes the value PLUS a trailing newline, while python `hashlib.sha256` and JS `createHash().update()` hash the bare value - comparing fingerprints computed by different methods raised a false "different credential / rotated" alarm for the same secret (nearly caused a wrong abort). Verified reproducible by the-sop-keeper before encoding | Standardize on BARE-VALUE hashing (`printf '%s'` / `echo -n` / hashlib / createHash) and state the METHOD alongside every reported fingerprint. The cortextOS system fingerprint is bare (JS createHash sha256, first 8 hex - `fingerprint()` in `src/bus/usage-accounts.ts`), so every manual comparison against a system fingerprint must use the bare method. A fingerprint without its method is not comparable evidence |
