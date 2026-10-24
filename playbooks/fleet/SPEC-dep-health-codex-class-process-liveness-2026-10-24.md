# SPEC: dep-health codex-class — key off process-liveness, not log-mtime

> **STATUS: LANDED + VALIDATED 2026-10-24** in `bus/check-dependency-health.sh` (probe
> `codex_runtime_auth`, frozen-log gate). Root fix shipped; **layer-1 dedup turned out
> UNNECESSARY** — keying the frozen-log case off the watchdog beat removes the OK↔DEGRADED
> oscillation at source (idle-alive → SILENT), so there is no flap left to dedup (simpler = better).
> Validated by `tests/monitors/dep-health-codex-liveness-test.sh` (tracked, repo-relative) — 5/5 cases: idle-alive→SILENT (the fix),
> not-started→DEGRADED, revoked-running→CODE RED (unchanged), transient→OK (unchanged),
> frozen+unreadable-beat→DEGRADED (safe default). Live codex probe returns OK, no alert.
> pid-lineage discriminator (below) documented — it is a SEPARATE signal from this gate's activity
> beat (pid-lineage answers "did the process die"; the beat answers "can the agent complete a turn"),
> NOT "applied as" it. Reviewed + signed ship-safe by claude-dev 2026-10-24 (code stands; wording
> tightened per their landed-text read).


**Filed:** 2026-10-24 (the-analyst) · **Task:** task_1792813266854_95190608
**Trigger:** atwood-codex fired 2 identical "healthy-idle" dep-health oranges within ~2h
(2026-10-24 ~01:0xZ and ~03:1xZ), both orch-verified healthy in one command (same pid 71515,
uptime 5h53m→7h46m, watchdog fresh). This is a **flapping control**, not two events.

## Problem

The dep-health codex-class check treats a **frozen stdout tail (stale log mtime)** as a liveness
signal. An **idle codex agent** freezes its log on every ~1h quiet stretch — this is EXPECTED, not a
fault (established in `FINDINGS-frozen-log-tail-false-codered-2026-07-29.md`). So the control:

1. sees frozen log mtime → fires orange
2. agent ticks (next watchdog beat / activity) → goes green
3. ~1h later, quiet again → repeat

Each cycle costs a triage that resolves to "healthy-idle." The alert text **already states log-mtime is
weak evidence for this class** — yet the control still fires on it. The signal is wrong at the source.

## Fix (two layers)

### 1. ROOT (the real correction) — AS SHIPPED
For **codex-class** agents, derive liveness from the **AGENT-ACTIVITY beat**, not log mtime.
⚠️ **NOT a pid / process-liveness check** (claude-dev review 2026-10-24 corrected the original wording of
this line, which read "ALIVE iff pid present AND watchdog fresh"). A pid check attests only "process
exists," which a **revoked-but-running** agent satisfies — so a pid check would *mask* a revoked-idle
agent. The activity beat is strictly **stronger**: `last_heartbeat` is refreshed by `update-heartbeat` +
`log-event` (`src/bus/heartbeat.ts` + `event.ts`), which **for the agent itself requires successful
inference** — a revoked/dead-for-inference agent cannot refresh it.
- **ALIVE iff** the activity beat is fresh (`age ≤ CODEX_AUTH_STALE_THRESHOLD`, default 5400s/90m).
- **log mtime → context-only**: supporting detail in the alert body, never the firing condition. A frozen
  tail on a beat-fresh codex agent is the documented idle shape and must NOT fire.
- Fire only when the beat is **stale or unreadable** (frozen log + stale beat → DEGRADED). The CODE RED
  revoked-**running** path (fresh log + signature + stale beat) is untouched.
- **Do NOT harden this toward a pid/process check** — that reintroduces the revoked-idle mask.

**Why the beat ≠ daemon process-liveness:** there is no independent periodic daemon writer of
`last_heartbeat`. The only non-agent writers are two narrow, conditional, self-alerting daemon
fast-checker `log-event`s (`fast-checker.ts:1920` fleet_health_silent_death, `:1269`
ctx_handoff_suppressed) — see KNOWN RESIDUAL below.

### 1b. KNOWN RESIDUAL (bounded, self-announcing — claude-dev review)
The two daemon fast-checker `log-event` paths above bump an agent's `last_heartbeat` **without** that
agent inferring anything, so in principle a daemon-side bump could refresh a dead/revoked agent's beat and
**mask** the DEGRADED. This is bounded and acceptable because: (a) neither path is periodic (both fire on
specific conditions, not a timer), so neither can *routinely* refresh a dead/idle beat; (b) the
silent-death path **`notify-agent`s the orchestrator at the same moment it bumps** — so it can mask the
DEGRADED but **never silently**: the condition is always surfaced through the silent-death channel. A
truly not-started agent (process down) generates no inference and its down-state is itself the
silent-death trigger. Net: a self-announcing residual, not a silent hole.

### 1c. THRESHOLD KNOB (claude-dev review)
`CODEX_AUTH_STALE_THRESHOLD`=5400s (90m) but the heartbeat cron is 4h — so flap-kill relies on codex
agents emitting *some* beat-refreshing activity within 90m, not the 4h cron. Empirically both live codex
agents hold it (atwood-codex ~21m, codex-dev ~10m beat age). If idle-flap ever recurs, **this threshold is
the knob**. It fails toward DEGRADED (loud), never toward a missed CODE RED.

### 2. INTERIM STOPGAP (until #1 ships)
Suppress repeat-oranges while the **discriminator state holds**: once a codex orange is verified
healthy-idle (pid running + watchdog fresh), that verdict **stands** and the control does NOT re-fire
until **pid or watchdog state changes**. Emit as **visible-not-page** (the `security` cg-seat
`exit3` ack-dedup shape) so it stays auditable without paging.

## Validation plan (DAYLIGHT — not mid-incident, not overnight)
- Validation-first on the codex-class agents (atwood-codex, codex-dev-agent).
- Prove: (a) an idle-but-alive codex agent produces ZERO oranges across ≥2 quiet-stretch cycles;
  (b) a genuinely dead codex agent (pid gone OR watchdog stale) STILL fires on the first cycle
  (no false suppression of a real death — the stopgap keys off discriminator state, which a real death
  changes).
- Regression-guard: non-codex-class dep-health alerts unchanged.

## Generalization: pid-lineage is the crash-notice discriminator (added 2026-10-24)

The same "trust process/pid state, not the emitter stamp" principle extends beyond the codex-class
log-mtime case to **crash/death notices**. Incident 2026-10-24: a crash notice fired for atwood-dev at
02:23Z; the first responder (me) verified only that the agent's **heartbeat was fresh** and concluded
"crashed + auto-recovered." That is unsound — **current-liveness cannot distinguish died-and-restarted
from never-died.** Orch's pid check found pid 73799 continuous from 22:49Z (spanning the stamp and still
live 15h later) = **no rotation = no death = SessionEnd false-crash phantom** (task_1789499194630 set).
The notice's "restart attempted: yes" was a deduped no-op (process already alive), not evidence of a real
restart.

⇒ **Standing discriminator for any crash/death notice:** check **pid lineage across the stamp**
(`ps -p <pid> -o pid=,lstart=` — did the pid rotate?), NOT just current heartbeat freshness. A pid that
predates the notice and survives it = phantom, reclassify out of any crash count.

⚠️ **Sharpened (claude-dev review 2026-10-24) — pid-lineage and the activity beat are DIFFERENT signals
for DIFFERENT questions; do not conflate them:**
- **pid-lineage** answers *"did the process die?"* — the right signal for a **crash/death notice**
  (died-and-restarted vs never-died).
- **the activity beat** answers *"can the agent complete a turn?"* — the right signal for **auth-death**.
  For auth-death, **pid-liveness is explicitly INSUFFICIENT**: a revoked agent has a live, non-rotated
  pid, so "process exists" says nothing about whether it can infer. That is why this gate keys off the
  activity beat, not pid.
The shared principle is only *"the emitter stamp is weak evidence; verify against real state"* — but
*which* real state differs by question (pid for death, activity beat for inference-capability).

## Cross-refs
- `FINDINGS-frozen-log-tail-false-codered-2026-07-29.md` (the class: frozen tail = stale-signature,
  not live-401; single running+fresh-watchdog agent refutes PM2 unload)
- `security` cg-seat ack-dedup (exit3 visible-not-page) — same dedup shape
- Orch flagged the flapping 2026-10-24; interim human handling = ack silently, re-verify only on
  pid/watchdog change (= manually pre-implementing fix #2's gate).
