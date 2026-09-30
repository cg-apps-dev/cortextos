---
type: findings
scope: fleet
status: RESOLVED (2026-09-30) - fix LANDED on main via b8f367db (bundle 4/11 c7a37529, task_1788798061911); list-crons now single-sources the daemon advance logic so an interval cron next_fire advances to the real future slot after downtime, no frozen-past. Mechanism + lesson below retained as the incident record.
date: 2026-09-07
author: the-sop-keeper
source-refs:
  - dev verdict relayed via the-orchestrator 2026-09-07 (mechanism ruling)
  - fixes task_1788798061911 (Adam-gated normal merge path)
  - live example: the-sop-keeper heartbeat cron (interval 4h) post-reboot
tags: [fleet, cron, list-crons, display-artifact, liveness, false-code-red, reboot]
related:
  - heartbeat-staleness-watchdog.md (independent daemon-side liveness signal; dead-pid/frozen-log false-code-red family)
  - standing-rules.md (the distilled discriminator - "a displayed next_fire is not a fire")
---

# A frozen `next_fire` on an interval cron is a DISPLAY artifact, not a dead scheduler

> **✅ RESOLVED 2026-09-30.** The display artifact below was FIXED on main via `b8f367db` (bundle 4/11 `c7a37529`, `task_1788798061911`): `list-crons` now single-sources the daemon's own advance logic (`computeDisplayNextFireMs` -> `advanceNextFireAtToFuture`), so an interval cron's rendered `next_fire` advances to the real future slot after downtime instead of showing `last_fired + interval` frozen-past. It was a CLI-render fix (the daemon scheduler was always correct). The mechanism + incident record below are retained as history; the standing-rules lesson it distills ("a displayed `next_fire` is not a fire") is unaffected and permanent.

**One line:** after daemon downtime, `cortextos bus list-crons` shows a **past** `next_fire` for
INTERVAL crons because it renders `next_fire = last_fired + interval` (a frozen projection), while
5-field EXPRESSION crons compute `next_fire` from *now*. The scheduler is healthy either way. A
past `next_fire` on an interval cron after downtime tells you nothing about liveness - it is the
render path, not the schedule.

## What happened (2026-09-07)

The machine was off **2026-09-01 19:51Z -> 2026-09-07 15:52Z** (ungraceful power-off; PM2 clean
resurrect on boot). On the fleet-wide restart, `list-crons` showed interval crons with a `next_fire`
back on 2026-09-01 - e.g. the-sop-keeper's own heartbeat (interval `4h`) read:

```
last_fire 2026-09-01 19:32 UTC   next_fire 2026-09-01 23:32 UTC   (19:32 + 4h)
```

A `next_fire` ~6 days in the past *looks* like a scheduler that stopped arming. For roughly **40
minutes** this morning that stale display was read fleet-wide as a possible liveness outage before
dev ruled on the mechanism. It was never an outage: the scheduler came up healthy with the daemon.

## The confirmed mechanism (dev, 2026-09-07)

- **INTERVAL crons** (`4h`, `6h`, `15m`, ...): `list-crons` renders `next_fire` as
  **`last_fired + interval`**. After downtime, `last_fired` is frozen at the last pre-downtime fire,
  so the rendered `next_fire` is a **frozen past timestamp**. It is a stale *projection*, not the
  scheduler's actual next arm time.
- **EXPRESSION crons** (5-field calendar, e.g. `"0 9 * * 1-5"`): `next_fire` is **computed from
  now**, so it renders a correct future timestamp after downtime.
- **The scheduler was healthy the entire time.** Nothing needed re-arming; the display was the only
  thing wrong.

**The discriminator = the render path: EXPRESSION (computes from now, trustworthy) vs INTERVAL
(last_fired + interval, frozen-past after downtime).** Same displayed field, two different meanings
depending on which kind of cron produced it.

## The durable instrument lesson

**A displayed `next_fire` is not a fire.** It is a computed projection, and for interval crons a
*stale* one after any downtime. Reading a projected/next-scheduled field as evidence of past or
future execution is the same class as the dead-pid and frozen-log false-code-reds this fleet's own
discipline already warns about (see `heartbeat-staleness-watchdog.md`: a dead historical pid is
expected across bounces; `ps lstart` local-time read as UTC made an 11-min daemon look 7h stale).
The frozen next_fire is one more member of that family: **a frozen display misread as a liveness
failure.**

### How to actually verify a cron is live (do this instead of trusting `next_fire`)

1. **Real fire records** - `cortextos bus get-cron-log <agent>` (the reliable path - it resolves the
   log location internally) shows ACTUAL fires with real timestamps. The raw file, if you read it
   directly, is nested at `${CTX_ROOT}/.cortextOS/state/agents/<agent>/cron-execution.log` - NOT the
   `${CTX_ROOT}/state/<agent>/` that some bootstrap docs still cite (that path does not exist and
   reads empty; same `.cortextOS/state/agents/` nesting as `crons.json`). A recent real fire is a
   fire; a projected `next_fire` is not.
2. **The independent liveness signal** - the daemon-side heartbeat-staleness watchdog
   (`heartbeat-staleness-watchdog.md`) is the fleet's out-of-band liveness check and does not route
   through any agent's own `list-crons` render. If it is quiet, no agent is stale past 2x cadence,
   regardless of what a `next_fire` field displays.
3. **Wait one interval and re-read** - if the concern is an interval cron, let one interval elapse
   from boot and check `get-cron-log` for the fresh fire; do not conclude from the pre-fire display.

## The one REAL gap (fixes PENDING - task_1788798061911, Adam-gated)

Separate from the display artifact, dev confirmed one genuine defect:

- **An ungraceful power-off leaves no `.daemon-stop` marker.** The catch-up logic that would replay
  missed beats keys off that marker, so with no marker written there is **zero missed-beat catch-up**
  on reboot. Consequence: the **first heartbeat (and any interval cron) is delayed up to one full
  interval** after an ungraceful reboot - a 4h-cadence agent can sit up to ~4h before its first
  post-reboot beat.
- So after an ungraceful reboot, an up-to-one-interval initial silence is **expected**, not
  staleness. Do not read that first-gap as a dead agent either. (The heartbeat-staleness watchdog's
  own threshold is 2x cadence + 0.5h grace, so a single delayed first beat stays under its alarm.)

**Fixes are tasked under `task_1788798061911`** and merge via the normal Adam-gated path. This
document reflects the mechanism as confirmed; update the status header and strike this pending note
when the fixes land.

## Responding checklist

- **See a past `next_fire` after downtime?** Check the cron KIND first. Interval -> almost certainly
  the frozen-projection artifact; verify with `get-cron-log`, not the display. Expression -> a past
  `next_fire` would be more surprising and worth a real look.
- **Whole fleet's interval crons show stale `next_fire` at once after a reboot?** That is the
  expected post-downtime render for every interval cron simultaneously - suspect the display, not a
  fleet-wide scheduler death. (Mirrors the watchdog's `fleet-not-started` collapse logic: all-stale-
  at-once points at the shared parent, here the shared render path + the shared downtime.)
- **First beat missing right after an ungraceful reboot?** Expected up to one interval, per the
  `.daemon-stop`-marker gap above. Re-check after one cadence before escalating.

## Enforcement labels

- **The display artifact** is **MECHANISED-by-understanding, not by a guard**: the fix is knowing
  the render path (this doc + the standing-rules discriminator), plus the existing `get-cron-log` /
  watchdog signals that already give ground truth. No new check is required to make the *artifact*
  harmless - only to stop misreading it.
- **The `.daemon-stop`-marker catch-up gap** is **MECHANISED-PENDING**: dev has a concrete fix under
  task_1788798061911; until it merges, the first-beat-delay-after-ungraceful-reboot is a known,
  documented expected state, not a defect to re-investigate each reboot.
- **Deciding whether a specific stale display is the artifact or a real fault** stays
  **JUDGMENT-LEVEL** at read time - the discriminator (cron kind) plus `get-cron-log` make it a fast
  judgment, not a guess.
