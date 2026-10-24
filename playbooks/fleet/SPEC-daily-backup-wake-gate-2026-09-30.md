# SPEC: daily-backup wake-gate (skip-and-retry-on-wake, not fail-in-DarkWake)

Task: task_1790787117786 | Author: security-agent | 2026-09-30 (rev 2026-10-01: +single-flight lock, Goal-2) | Status: DRAFT (my lane, branch-level; surface before any plist/pmset change)

## Problem (root cause, evidence-grounded)
`~/Library/LaunchAgents/com.cortextos.daily-backup.plist` schedules via `StartCalendarInterval {Hour=2, Minute=0}` = 02:00 PT. macOS runs a missed StartCalendarInterval job **at the next wake** - including a **DarkWake** (maintenance/power-nap wake) that has NO network. So when the host sleeps across 02:00 PT (2026-09-30: deep-sleep 04:48-16:46Z), the job fires in a DarkWake window and both pushes ssh-fail (`connect port 22`, rc=128). The script's existing transient-retry (`RETRY_MAX_ATTEMPTS`, ~10min backoff tuned to outlast MagicDNS self-heal) CANNOT outlast a multi-hour sleep, so it exhausts and routes a FAILED alert + loses one agent-state increment until manual re-run. 3rd data point on this class (09-20 ssh-connect-starvation, 09-30 host-sleep).

Backblaze whole-disk DR is continuous, so this is a RELIABILITY/false-alarm problem, not data-loss. Fix goal: convert fire-in-DarkWake-and-fail-and-alert into skip-quietly-and-catch-up-on-real-wake.

**Concurrency evidence (2026-10-01, added to this spec):** the 09-30 deep-sleep deferred the 02:00 PT job to host-wake; on wake, launchd fired **TWO concurrent daily-backup.sh instances** (PIDs 44528 + 44627, same minute). The real backup self-healed and landed last-exit=0 (idempotent pushes), so it was harmless THAT time - but it exposes a race the wake-gate design below actively WIDENS. A `StartInterval` catch-up job (Layer 1 step 2) plus the missed-calendar wake-fire means two independent triggers can fire within the same wake window, and both run `backup-agent-state.sh` against the SAME shared staging repo (`~/.cortextos-agent-state-backup`). Two concurrent runs there race on: (a) that staging repo's git index (`index.lock` contention / interleaved commits / a push of a half-synced tree), (b) the `.backup-deferred` / success markers (one clears while the other is mid-run), (c) the `backup` remote push refs. So **single-flight is a hard requirement of this fix, not a nice-to-have** - without it, the catch-up layer converts a rare harmless double-fire into a routine one.

## Design (two layers; layer 1 is no-sudo/my-lane, layer 2 is belt-and-suspenders/Adam)

### Layer 1 (my lane, no approval): single-flight lock + reachability pre-gate + catch-up interval
0. **Single-flight lock (FIRST thing daily-backup.sh does, before the reachability probe).** Acquire an exclusive lock so only one backup runs at a time regardless of how many triggers fire (calendar wake-fire + catch-up interval + a manual kickstart can coincide on a wake). Mechanism, in order of preference:
   - `flock -n` on a dedicated fd against a lockfile in the state dir (`$CTX_ROOT/state/security-agent/.daily-backup.lock`), OR a portable atomic `mkdir` lock if `flock` is unavailable on the target macOS shell (verify which at build time - stock macOS bash 3.2 has no `flock` builtin; `/usr/bin/flock` is NOT present by default, so the `mkdir`-based lock is the likely implementation).
   - If the lock is already HELD: log `SKIPPED (another backup instance running)`, **exit 0** (NOT a failure, NO routed alert - a concurrent run is the normal case this guards, not an error), do NOT attempt pushes.
   - Release on exit via a `trap` (EXIT/INT/TERM) that removes the lock, so a crash does not wedge the lock permanently. Guard the trap against removing a lock this instance did not acquire.
   - **Staleness:** a `mkdir` lock needs a stale-lock reaper (store the holder PID + start-ts in the lockdir; if the PID is dead OR the lock is older than a bounded max-runtime, reclaim it) so a killed backup cannot permanently disable all future backups. This reaper is itself fail-SAFE: ambiguity about whether the holder is alive -> treat as HELD (skip this run) rather than steal the lock, except past the hard max-runtime ceiling.
1. **Reachability pre-gate** at daily-backup.sh start (AFTER the lock is held): probe github reachability (`git ls-remote backup` with a short timeout, or TCP :22 check). If UNREACHABLE:
   - Write a `.backup-deferred` marker (with UTC ts + reason=no-network-darkwake), log `DEFERRED (no network / likely DarkWake)`, and **exit 0** (NOT a failure, NO routed alert). This stops the false-alarm.
   - Do NOT attempt the pushes (they would just ssh-fail).
2. **Catch-up mechanism** - a lightweight second launchd job `com.cortextos.daily-backup-catchup` on `StartInterval` (e.g. 900s):
   - If a `.backup-deferred` marker exists (or last-success marker is >20h old) AND github is now reachable -> run daily-backup.sh, clear the marker on success.
   - This lands the backup when the host actually wakes WITH network, without waiting for the next 02:00. Idempotent via the success marker.
   - Keep it cheap: reachability probe first, only run the full backup if deferred+reachable.

### Layer 2 (needs Adam/sudo, optional belt-and-suspenders): scheduled wake
- `sudo pmset repeat wakeorpoweron MTWRFSU 01:58:00` so the host is guaranteed fully awake+networked at 02:00 when the calendar job fires. Eliminates the DarkWake-fire at the source. Persistent system power-setting change = Adam approval + rollback note (`sudo pmset repeat cancel`). Layer 1 makes this optional, not required.

## Positive-control / test plan (before close)
- Simulate no-network at job start (e.g. point `backup` remote at an unreachable host, or a wrapper that forces the reachability probe to fail): confirm daily-backup.sh writes `.backup-deferred` + exits 0 + sends NO routed FAILED alert.
- Restore network, fire the catch-up job: confirm it detects the marker, runs the backup, earned-green (remote tip==local staging + last-exit=0 + deletion-risk PASS), clears the marker.
  - NOTE (post-G1 2026-10-06): "deletion-risk PASS" here = rc0 OR rc3. deletion-risk-check now returns rc3 when a critical file is ACKNOWLEDGED pending-restore (deletion-risk-ack.txt) - that is an unrelated standing config-deletion signal, NOT a backup-integrity failure, so rc3 is acceptable for THIS catch-up earned-green. Only rc1 (NEW backup/deletion RISK) or rc2 (indeterminate) fails the wake-gate catch-up verify.
- Confirm a NORMAL awake 02:00 run is unchanged (reachable -> runs -> success -> no marker).
- Confirm the reachability probe itself has a bounded timeout (never hangs the job).
- **Single-flight (the 10-01 double-fire):** start two daily-backup.sh instances near-simultaneously (mimics the launchd wake double-fire). Confirm exactly ONE acquires the lock and runs to completion; the OTHER logs `SKIPPED (another instance running)` + exits 0 + sends NO alert + does NOT touch the staging repo. Verify no `index.lock` contention / no interleaved commit in `~/.cortextos-agent-state-backup`. Then confirm the first instance's run is itself earned-green.
- **Stale-lock reaper:** leave a lockfile whose holder PID is dead (and separately, one older than the max-runtime ceiling); confirm the next run reclaims it and proceeds (a killed backup must not permanently disable backups). Confirm a lock held by a LIVE instance under the ceiling is NOT stolen.

## Guardrails
- daily-backup.sh is a LIVE control: build+test on a scratchpad copy first (NEVER-PROBE-LIVE-CONTROL), deploy exact tested bytes, CHANGELOG with rollback.
- The reachability probe must fail-SAFE: if the probe itself errors ambiguously, prefer the current behavior (attempt+retry) over silently skipping - a skip must be a POSITIVE unreachable signal, never a probe failure (else a broken probe silently disables backups = worse than a false alarm).
- Marker files live OUTSIDE git + backup scope (state dir), leak-free (ts + reason only). The lockfile lives there too.
- **Lock fail-direction is the mirror of the probe's:** the reachability probe fails SAFE toward RUNNING (ambiguity -> attempt, never silently skip), but the single-flight lock fails SAFE toward SKIPPING (ambiguity about whether a peer holds it -> skip this run, never force-steal), bounded only by the hard max-runtime reaper so a dead holder cannot wedge backups forever. These two fail-directions are OPPOSITE on purpose: "is the network up?" unknown must not stop a backup; "is a peer already backing up?" unknown must not start a second one into the shared staging repo. Do not copy one fail-direction onto the other.
- Order matters: lock FIRST, then reachability probe, then the deferred-marker logic - so a skipped-for-concurrency instance never writes/clears the `.backup-deferred` marker out from under the running one.
