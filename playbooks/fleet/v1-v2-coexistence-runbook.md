# V1/V2 coexistence + agent-migration runbook

**Status:** Captured 2026-11-17 by the-sop-keeper from the 2026-11-15 migration arc. **n=1: one live
exercise.** Capture is faithful to the artifacts; edge cases that were NOT exercised (multi-agent
simultaneous moves, partial rollback) are marked UNTESTED, not settled. Authoritative instance
record = the artifacts linked at the bottom; this runbook is the distilled, reusable layer.

---

## 1. The coexistence reality (post 2026-11-15)

As of 2026-11-15 18:31Z the fleet runs as TWO instances, not one:

- **V1** (`~/.cortextos/default/...`) = **clean-green-marketing only**. The V1 orchestrator keeps
  running CGM and does NOT merge into V2. V1 stays live indefinitely (no CGM-V2 timeline as of this
  writing; a CGM move is Adam-gated).
- **V2** (`~/.cortextos/app/...`, default-org orchestrator "Drip") = the migrated orgs.

The 2026-11-15 migration was **owner-scoped** (Adam): only the **atwood** and **adam-personal** orgs
moved to V2 (5 agents: atwood-orchestrator, atwood-analyst, atwood-dev-agent, atwood-codex-agent,
the-tax-planning-agent). CGM stayed. So a "migration" here is a per-org, per-agent move between two
coexisting instances - not a cutover.

**What this means for CGM-served docs:** references to the moved agents/orgs are now either dated
history or still-valid cross-org examples (they remain separate orgs, now on V2); they are NOT a
stale roster to purge. Live fleet logic that keys on the ENABLED roster + an `out_of_org` tier
self-adjusts (the moved agents go `enabled=false`, dropping out). Verified 2026-11-16: no CGM-served
doc hard-coded a stale roster. Do not bake org/agent lists into docs; reference live.

---

## 2. Scoped-shutoff rule (the coexistence safety boundary)

When the owner approves V1 shutoff for the moved agents, the V1 orchestrator stops **ONLY the moved
V1 agents** - NEVER the clean-green-marketing org, the V1 daemon, or V1 infrastructure, which keep
running. Shutoff timing is owner-gated (2026-11-15: V1 stayed live until Monday launch day was over).

A bare process `stop` is only **half a shutoff**: `cortextos stop` writes a `.user-stop` marker and
sends a stop IPC (`src/cli/stop.ts`) - it sets NEITHER enabled flag, so the V1 daemon re-discovers
and re-starts the dir on its next cycle UNLESS a roster/config enabled flag is already false. A
durable de-enroll needs that persisted flag (see the de-enroll rule below).

**In the 2026-11-15 exercise this re-start risk did NOT materialize**, and the runbook sentence above
is the general rule, not what happened that day: the moved agents' instance-roster half was ALREADY
`enabled=false` after the 18:31Z scoped action (dev-measured ~20:05Z, 11-15), so no auto-restart was
possible even before any further de-enroll - the scoped shutoff stopped agents that were already
roster-disabled (disabled as part of the move), not bare-running ones. The half-a-shutoff rule
applies to a `stop` of a STILL-ENABLED agent; the move avoided it by having the roster flag false.

## 3. Durable de-enroll = both halves

Cross-link, not re-copied: **playbooks/fleet/standing-rules.md** → "Standing rule: durable agent
de-enroll is BOTH halves". Summary for this runbook's purposes: the daemon skips an agent if EITHER
per-agent `config.json enabled:false` OR instance `enabled-agents.json[name].enabled:false` is set
(`agent-manager.ts:128-136`); `cortextos disable` writes the roster half (and is daemon-respected
post-BUG-028); set `config.json enabled:false` too for durability across a roster rebuild/migration.
A scoped `stop` writes neither flag.

---

## 4. The `[v1-move]` signal protocol (as exercised 2026-11-15)

`[v1-move]` is the agreed signal convention between the V1 orchestrator and the V2 (default-org)
orchestrator for coordinating a moved agent's switch-on. It is a bus-message prefix the moved agent
watches for. Ground-truthed from the per-agent `local/v1-move.md` files.

**Quiet-park state (every moved agent holds this until signalled):** running in V2 but crons PAUSED,
Telegram OFF (`telegram_polling: false`, `connector: none`, never send Telegram), and the V1 `.env`
parked UNREAD as `.env.from-v1`. Each agent also carries a **switch-on list** (the exact crons to
re-enable - nothing else) and a **staged re-point** for any shared-dependency paths.

**Signal `[v1-move] V1 is shut off` (switch-on).** The moved agent, per its own `local/v1-move.md`:
1. `mv .env.from-v1 .env && chmod 600 .env` (a file move; never open it).
2. Remove `telegram_polling` / `connector` from `config.json` (Telegram was V1-only).
3. Re-enable ONLY the crons on its switch-on list (e.g. `cortextos bus update-cron <agent> <cron>
   --enabled true`); re-point any staged shared-dependency paths.
4. Reply to the orchestrator that it is switched on; the orchestrator restarts it so `.env` + Telegram load.
5. Tell the owner in its own chat that it is fully on.
6. First work action: the post-migration memory diff named in its handoff (catch anything the V1
   session logged after the handover snapshot).

**Signal `[v1-move] Back to V1` (rollback).** Reverse it: switch every cron OFF, `mv .env
.env.from-v1`, put `telegram_polling: false` + `connector: none` back, and reply.

**Critical ordering (bit the migration if missed):** any shared dependency a switch-on step re-points
to (e.g. a shared script at a V2 path) MUST exist at that path BEFORE any `[v1-move] V1 is shut off`
signal - several agents' staged re-point commands name exact paths. Place org/shared files first,
signal second.

**UNTESTED edge cases (n=1 - do NOT treat as settled):**
- Multi-agent SIMULTANEOUS switch-on (the 2026-11-15 exercise had agents signalled individually).
- PARTIAL rollback (some agents switched on, some rolled back mid-wave).
Exercise these deliberately or treat them as unknown; the protocol above is proven only for the
one-agent-at-a-time, full-direction case.

---

## 5. Migration-runbook learnings (2026-11-15 arc)

- **Scope is a cutover-vs-coexist decision, made by the owner.** This was coexist (CGM stays V1); the
  V1 orchestrator did not merge. State that scope explicitly before moving anything.
- **Each agent moves ITSELF** via its migrate-from-v1 / `v1-employee.md` protocol; the orchestrator
  handover carries ORG-LEVEL material only (knowledge.md, goals.json, context.json, brand-voice.md,
  secrets.env, shared scripts). 5/5 self-moves verified before handover.
- **Completeness mandate + a file-level sweep.** The owner wanted every knowledge/context file the V1
  agents used transferred so V2 picks up seamlessly; this was VERIFIED by a pre-handover file sweep
  (memory/ counts V2 >= V1, MEMORY.md, identity/soul, skills, references, plugins). Only exclusions
  were owner-approved leave-behinds + stock helper scripts V2 replaces.
- **The semantic index does NOT transfer as a database.** Each agent RE-INGESTS from its moved files
  at switch-on. Private folders that were never ingested stay never-ingested.
- **Secrets move as whole files, never opened, mode 600** (`secrets.env`, `.env.from-v1`). No secret
  content is ever read, logged, or echoed - the move is a `mv`/copy, full stop.
- **Docs must not lead the runtime across a migration.** A doc asserting a runtime behavior is true
  only when the DEPLOYED artifact does it (observed event / running `dist`), not when source merges.
  The 2026-11-15 arc hit this: a `task_created` auto-emit note was source-accurate but the live CLI
  ran a ~6-week-stale `dist`, so the note led the runtime until the rebuild landed. Rebuild/redeploy
  closes such a gap; name it as transitional until then.
- **A tracked-doc land needs a served-copy pull when the shared tree is parked off main.** Merging to
  the `main` ref leaves the working-tree (served) copy stale on a parked branch; materialize it with
  `git show main:<path> > <path>` (no staging), and VERIFY with a direct blob-vs-worktree content
  diff - `git diff main -- <path>` is misleading when the parked branch predates the file (it reads
  the path as untracked). Post-pull state is `M` (branch has an older copy) or `??` (branch predates
  the file); both are expected.
- **V1-only instruction-file patches carry limited runway once an org is V2-bound.** The owner
  dropped the atwood V1 double-log doc patch (0/16 applied) because atwood was moving to V2 and the
  patch only fixed V1 instruction files. Weight net-new heavy V1-plumbing work as limited-runway-risk;
  prefer content that survives a future migration over V1 plumbing. (CGM itself stays V1 indefinitely
  as of this writing - this weighting is a bias, not a freeze.)
- **Host-sleep produces a fleet-wide batched-heartbeat catch-up, not a per-seat fault.** After a host
  sleep, multiple agents' queued crons fire together on wake; do not read one agent's gap as a seat
  health issue (see standing-rules host-sleep / awake-host-flatline class).

---

## 6. Authoritative artifacts (instance record - this runbook is the distilled layer)

These live in the V2 instance and hold the per-agent / per-org specifics (task lists, re-point
commands, owner decisions) that are instance-bound and not reproduced here:

- Handover: `~/.cortextos/app/orgs/default/agents/orchestrator/local/from-v1/` → `plan.md`
  (org files, crons, open tasks, owner's verbatim decisions, completeness sweep), `handoff.md` (the
  V1→V2 orchestrator handoff + inherited threads), `READY`, `review.html`.
- Per-agent switch-on notes: each moved agent's `local/v1-move.md` (quiet-park state, switch-on list,
  the exact switch-on/rollback steps).

To reach the V1 orchestrator from V2: `cortextos bus send-message the-orchestrator ...` from the V1
side, or through Adam. The V1 orchestrator remains live indefinitely for clean-green-marketing.
