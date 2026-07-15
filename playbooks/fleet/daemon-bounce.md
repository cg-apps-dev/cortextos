---
type: playbook
agent: fleet (control-plane; deploy/bounce procedure)
process: daemon-bounce
status: active
date: 2026-07-15
---

# Daemon Bounce (from outside the daemon process tree)

How to bounce the cortextos-daemon (a stop/restart, usually to ship a dist) WITHOUT taking the fleet down with it. Mechanics supplied by claude-dev-agent (owns the scripts); this doc is the readable procedure. The enforcement scripts (`scripts/bounce-guard.mjs`, `scripts/daemon-bounce.sh`) are live on main.

## Rule: a daemon bounce runs from OUTSIDE the daemon process tree

A daemon bounce (stop/restart of cortextos-daemon) MUST be executed by an actor OUTSIDE the process tree the daemon hosts - a human, PM2/launchd, or an out-of-fleet process. A daemon-hosted agent NEVER self-executes the stop of the daemon that runs it: the stop kills the agent (and its shell) mid-sequence, so the restart half never runs (origin: the 2026-07-15 outage, ~2h fleet down, when a bounce ran as `pm2 stop; sleep; start` from inside a hosted agent).

## The two halves

**HOSTED-AGENT half (agent-safe):**
1. Stage the new dist (`npm run build`).
2. VERIFY the fix markers are present in the BUILT `dist/daemon.js` (grep the marker - a green merge/build is NOT the same as the runtime having it).
3. REQUEST the bounce from OUTSIDE (route to the orchestrator, who has it executed externally). Do NOT run the stop yourself.

**EXTERNAL-ACTOR half (human / PM2 / launchd / out-of-fleet):** run the guard-protected wrapper `scripts/daemon-bounce.sh` (preferred - self-protecting), or `pm2 restart cortextos-daemon` directly.

## The guard (enforcement)

`scripts/bounce-guard.mjs` REFUSES when the caller is inside the cortextos-daemon process tree (it resolves the daemon PID, walks the caller ancestry; daemon-is-ancestor -> REFUSE). It PASSes when the caller is outside the tree, or the daemon is positively STOPPED (a stopped daemon hosts no process tree, so there is nothing to tear down). Fail-safe on every info step: any unresolvable/partial/unconfirmed state REFUSEs, never PASS-on-partial. Symlink-robust (realpath both sides). It emits a positive `BOUNCE-GUARD-VERDICT: PASS` token only on a genuine PASS; the wrapper proceeds to `pm2 restart` ONLY on that exact token (a silent no-op / wrong / empty verdict ABORTS - a bare exit-0 is not trusted). Run from an in-fleet shell, it REFUSEs by design.

## pm2-restart-atomic (documented FALLBACK only)

A dummy experiment (never the live daemon) showed a single atomic `pm2 restart` SURVIVES the issuing shell's death (the PM2 god-daemon is external), unlike `stop; sleep; start` which dies with the shell. This is a viable FALLBACK, but the PRIMARY path stays request-from-outside via a truly external actor.

## Deploy-discipline invariant: reconcile the four-link chain in BOTH directions

The from-outside rule above governs WHO may bounce; this governs WHAT must be true for a deploy to STICK. A change is durable only when SOURCE -> DIST -> RUNNING -> COMMITTED all agree. Two failure directions, both real (2026-07-15 hit both):

- **FORWARD (merge != deployed):** a source change merged to main is NOT live until dist is rebuilt AND the daemon bounced - the daemon runs `dist/`, not source. Verify the fix markers in the BUILT dist before and after the bounce.
- **REVERSE (deployed != committed):** a hotfix live in dist whose SOURCE is uncommitted is ephemeral - a clean build from HEAD rebuilds dist WITHOUT it and reverts the running behavior. Commit exactly what you deployed.

Deploy DONE-WHEN: walk all four links and confirm they agree - source == committed, dist built from that source, running == dist.

## Threat-model scope

This guards ACCIDENTAL self-teardown (a hosted agent, or a symlinked invocation path, running the bounce from inside the tree). A same-host-COMPROMISED adversary spoofing the daemon cmdline to defeat identity-confirmation is OUT of scope - a different threat class, handled by host-compromise controls.

## Bounce DONE-WHEN (the gate)

"Bounce executed from outside the daemon process tree, verified." Verified = the daemon create-time is fresh AND the new dist markers are live in the running artifact AND the agents re-bootstrapped.

## Cross-reference

Standing-rules registry ([standing-rules.md](standing-rules.md)): the control-plane self-teardown row (the incident this procedure prevents) and the refuse-on-partial companion rule (the fail-safe discipline the guard exemplifies).
