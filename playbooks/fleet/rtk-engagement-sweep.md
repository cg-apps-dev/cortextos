---
type: playbook
agent: fleet (cross-agent; daemon auto-heal owned by claude-dev-agent / codex-dev-agent)
process: rtk-engagement-sweep
status: active
date: 2026-07-08
tags: [playbook, fleet, rtk, hooks, post-bounce, verification]
---

# RTK Post-Bounce Engagement Sweep

RTK (the token-saver) works via a PreToolUse hook that fires on every command. After a deploy or a `--continue` bounce, an agent's RTK hook can silently **decay** - stop firing - so the agent keeps running but loses the RTK savings. The engagement sweep verifies each agent's hook actually re-bound after a bounce.

There are two layers. Know which one you are in:

- **Daemon auto-heal (code, automatic).** `src/daemon/rtk-continue-decay-autoheal.ts` detects a decayed hook after a bounce and arms a `.force-fresh` re-bind. Its own probe is already correct - do not hand-run it. Owned by claude-dev-agent (PLAN/review) + codex-dev-agent (impl).
- **Manual sweep (this SOP).** A human or an agent spot-checking "did agent X's hook re-bind?" after a bounce. The 4 rules below exist because manual sweeps step on artifacts the daemon code already handles.

## Canonical proof of engagement

A clean, bare `ls` marker appears in the RTK `history.db` (read non-immutable), with a timestamp **after** the agent's restart.

The mechanism: the RTK PreToolUse hook logs every command it fires on to `~/Library/Application Support/rtk/history.db` (table `commands`, column `original_cmd`, attributed by `project_path` - cwd only, there is no agent/env column). So a probe command IS the test: ask the agent to run a marker `ls`; if the hook is engaged it logs that `ls` on fire. You read the fire-effect from `history.db`, not from the agent's stdout.

## The 4 method rules (a manual sweep gets these wrong at its peril)

Each rule below caused a real **false-decay near-miss** during the 2026-07-08 RTK auto-heal deploy sweep (probe read `0` twice before the true positive).

1. **Probe with a BARE, single-line `ls`.** Do NOT bury the marker in a `cd … && …` or a multiline block. RTK logs the OUTER command of a compound (the `cd …`), so an inner `ls` never registers as its own row -> false "not logged" -> false decay.
2. **Do NOT pipe or comment the probe line.** Same reason - the logged `original_cmd` is the whole pipeline, not the `ls` inside it.
3. **For a JUST-WRITTEN probe row, read `history.db` with a NORMAL (non-immutable) handle, and allow ~2s flush time before reading.** `history.db` is WAL-mode; a `?immutable=1` handle cannot see WAL-pending rows, so an immutable read seconds after the write returns a stale `0`. Use a fresh non-immutable connection, or wait for a checkpoint.
   - **Nuance (do not over-correct):** `immutable=1` is NOT wrong in general - it is the CORRECT choice for reading OLD / historical rows, and the daemon deliberately keeps it for its 24h passive read. The non-immutable rule applies specifically to a row you just wrote (a fresh probe, seconds old) - that is when WAL-blindness bites. Read: *for a just-written probe row, non-immutable; for historical lookups, immutable is fine.*
4. **Match on a unique per-run token** (e.g. `RTK_HEAL_PROBE_<agent>_<ts>`), and confirm the matched row's timestamp is **post-restart** - not a leftover from a prior sweep.

## The sweep, end to end

1. Ask the target agent to run exactly one bare Bash command: `ls -la /etc/hosts /tmp/<unique-token>` (the `/tmp` path is expected missing - that is fine; the point is the logged `ls`).
2. Wait ~2s for the WAL flush.
3. Read `history.db` with a non-immutable handle; match the row on `<unique-token>`.
4. Row present with a post-restart timestamp = hook engaged, done. Absent after a clean bare-`ls` probe = confirmed decay. **IMMEDIATE remediation**: the agent self-hard-restarts (`cortextos bus hard-restart`) - a fresh spawn re-binds the hook (proven 2026-07-08; hooks bind at spawn, and a hard-restart is a fresh non-`--continue` session). The daemon auto-heal is the automatic BACKSTOP and will independently arm `.force-fresh` on its own next detection cycle - it does NOT fire off this manual finding, so do not wait on it. Escalate to claude-dev-agent if a hook stays decayed across a re-bind.

## Design source

Full root-cause + the daemon-side fixes (Stage-A restart-floor, WAL-aware read, token match) are in claude-dev-agent's `staging/specs/SPEC-rtk-autoheal-stagea-precision.md` section 5. FLAG: that SPEC lives in claude-dev-agent's untracked agent workspace (`orgs/` is gitignored), so it is not linkable from this tracked tree - named here on purpose, read it in place. This playbook documents the settled manual-sweep method; the daemon code fixes (findings 1-3) are branch-only and land separately.

## Related

- [README.md](README.md) - fleet playbook index
- [zero-model-monitors.md](zero-model-monitors.md) - the other fleet-wide operational layer
