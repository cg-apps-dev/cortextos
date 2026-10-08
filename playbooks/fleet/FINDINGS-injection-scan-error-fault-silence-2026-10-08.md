# FINDINGS: injection_scan_error is a fault_silence control - silence is healthy, not a latch

**Date:** 2026-10-08
**Author:** security-agent (clean-green-marketing)
**Trigger:** the-analyst control-health-monitor.py flagged `injection_scan_error` as POSSIBLE LATCH (silent 9.3d vs ~3d typical active-day gap); the-orchestrator routed a premise-check.
**Verdict:** FALSE ALARM / HEALTHY-SILENT. Instrument-named, empirically confirmed.
**Class:** event-driven / fault-silence control (silence is the healthy state). Same family as `verdict_core_authority_failure` (failure_alarm) and `creative_gate_enforcement_check` (event_driven). Cross-link: the 2026-06-19 Dead-scan-smell rule (a control that only ever reads 0 is suspect - prove it FIRES, never infer health from silence).

---

## One-line

`injection_scan_error` fires ONLY when the injection scanner exits 2 (an internal scanner error) during a KB ingest. Its healthy emission rate is ZERO, so time-silence is NOT evidence of a latch. The independent liveness proof is the SIBLING `injection_scan_ok` positive beat, not fault-absence.

## Control registry entry

| Field | Value |
|---|---|
| Control | `injection_scan_error` |
| Type | **fault_silence** |
| Emitter | `scanBeforeIngestMonitor()` in `src/bus/knowledge-base.ts` (Phase-1 injection-scan monitor, fail-open) |
| Fires when | injection scanner exits 2 (internal scanner error) on a path being KB-ingested |
| Healthy pattern | **SILENT.** Zero emission = zero scanner faults = healthy. Do NOT latch-alarm on its silence. |
| Liveness discriminator | the sibling `injection_scan_ok` positive beat (same emitter). Recent ok-beat within KB-ingest cadence = monitor alive = error-silence is healthy. |
| True-latch condition | ALL FIVE `injection_scan_*` events (ok / finding / degraded / error / skipped) silent beyond KB-ingest cadence = monitor actually dead. Any one present = alive. |
| Out-of-band proof_of_fire | force the scanner to exit 2 on a seeded fixture -> `injection_scan_error` fires. Fold into the SPEC-control-type-registry ship-verify (one seeded exit-2 validates both the error channel and the typed self-adjudication end-to-end). |

## Why silence here is healthy (design)

`scanBeforeIngestMonitor()` emits EXACTLY ONE of five mutually-exclusive terminal events per scanned path:

- `injection_scan_ok` (info) - ran, parsed clean, 0 findings. The POSITIVE LIVENESS BEAT.
- `injection_scan_finding` (warning/error) - ran, parsed, count > 0.
- `injection_scan_degraded` (warning) - ran (status 0/1) but stdout unparseable.
- `injection_scan_error` (warning) - scanner exit 2 (internal error).
- `injection_scan_skipped` (warning) - timeout / spawn-failure / missing scanner.

The error channel cannot prove its own liveness: a quiet `injection_scan_error` means EITHER "scanner ran clean, no faults" (healthy) OR "the monitor never ran" (dead). The `injection_scan_ok` beat was added 2026-08-07 (task_1786077403648, the single-terminal-event invariant) precisely to resolve that ambiguity - a register can now distinguish healthy-quiet (ok beat present) from never-ran (no beat).

## Empirical evidence (2026-10-08T03:3xZ, live event store)

Event store: `~/.cortextos/<instance>/orgs/<org>/analytics/events/<agent>/<date>.jsonl` (the per-org analytics tree; the top-level `~/.cortextos/<instance>/analytics/events/` is stale).

| Event | Count | Last fired |
|---|---|---|
| `injection_scan_ok` | 7799 | **2026-10-08T03:32** (minutes before this verdict = scanner demonstrably live) |
| `injection_scan_finding` | 154 | 2026-10-02T03:21 (pipeline still processes real content) |
| `injection_scan_error` | 45 | **2026-09-28T20:24** (~9.5d = the analyst's "silent 9.3d") |
| `injection_scan_skipped` | 21 | 2026-10-06 (atwood org) |

The 9.3d error-silence = zero scanner internal-errors in 9.3d = HEALTHY. The ok-beat firing ~every KB ingest (n=7799) is the proof the monitor is alive.

Call chain (how the beat stays fed): `cortextos bus kb-ingest` -> `ingestKnowledgeBase()` -> `scanBeforeIngestMonitor()` per path (built into `dist/cli.js`). Every agent's heartbeat KB-ingest fires the beat, so the ok-channel is continuously exercised.

## Fix status (the self-adjudication)

The correct typed entry ALREADY EXISTS in the-analyst's `SPEC-control-type-registry-2026-09-26.md` (`injection_scan_error`: type=`fault_silence`, liveness rides the `injection_scan_ok` positive beat). The live `control-health-monitor.py` still flags it only because that SPEC is specced-but-not-yet-shipped (ship gate: codex build -> analyst line-review -> orch confirm-before-live). Landing that SPEC makes `injection_scan_error`, `verdict_core_authority_failure`, and `creative_gate_enforcement_check` all self-adjudicate by TYPE instead of by firing-rate.

## Durable rule

A fault/error channel cannot prove its own liveness. When a control-health scan flags an ERROR-only or event-driven control for time-silence, do NOT treat silence as a break: name the independent liveness instrument (a sibling positive beat, or a by-count of triggering events) and read THAT. Prove the control FIRES out-of-band; never infer health from the absence of its alarm.
