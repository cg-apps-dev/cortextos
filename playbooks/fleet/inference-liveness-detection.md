# Fleet runbook: inference-liveness detection (the session-rollover wedge)

What catches an agent that is process-alive but inference-dead, which instrument covers which
failure shape, and who gets paged. This is a COVERAGE MAP, not a guarantee - read the map before
trusting any single detector. Ratified 2026-09-19 PT (the-sop-keeper, from the 2026-09-16/17 wedge;
detector evidence: the-analyst; root cause + mechanism: claude-dev-agent).

## The wedge class (what we are detecting)

A fleet-wide session-time-cap rollover re-spawns an agent's session (`--continue`); the fresh
session dies on a silent FIRST TURN (a transient 429/overload aborts the woken turn) and sits
**process-alive / inference-dead** for hours - the 2026-09-16 case ran ~18-20h on 2 of 8 rolled
agents. It is **inference-death, not delivery-death**: every cron kept firing on time
(`status=fired error=null`) the whole time - the daemon delivered, the turn did not process. It went
undetected because the fast-checker watchdog mark-alive (`[watchdog] <agent> alive`) kept
`last_heartbeat` fresh, so the heartbeat-staleness watchdog never saw staleness. Full root cause,
facts, and hypotheses: the claude-dev FINDINGS `FINDINGS-fleet-session-rollover-wedge-2026-09-17.md`
(authored, but NOT yet on main as of 2026-09-19 - named not linked until it lands in the tracked tree).

## Coverage map - which instrument catches which shape (READ FIRST)

| Wedge shape | Caught by | Status |
|---|---|---|
| BOUNDED intra-day gap (silent >= threshold, THEN resumes the same UTC day) | gap-liveness (`scripts/gap-liveness-shadow.py --active`) | ARMED (COARSE paging) |
| HARD-HANG / statusline stops writing (`written_at` stale past 2 cron intervals post-prompt) | fast-checker written_at-staleness detector | LIVE |
| ONGOING / overnight / cross-day wedge (0 authored events, never resumes same day - the 09-16 shape) | fast-checker IF `written_at` goes stale; gap-liveness SKIPS it (no trailing-now bound) | PARTIAL (hard-hang only) |
| COUNTER-FREEZE (statusLine STILL ticking / `written_at` advancing, but turns do not process) | NEITHER today | **OPEN** (claude-dev verifying, owns any fast-checker fix) |

**IN BUILD, do NOT rely on it yet:** the-analyst's separate post-roll boot-liveness instrument, keyed
on AUTHORED-EVENTS (alive-pre-roll AND 0 post-roll, independent of `written_at`), which will cover
boot-fail + cross-day + counter-freeze. Update this row to LIVE only when the-analyst confirms it
landed and validated.

## gap-liveness - the armed COARSE instrument

- **Deployed:** `scripts/gap-liveness-shadow.py --active`, daily 03:40Z cron.
- **Fires on:** the largest gap BETWEEN consecutive agent-AUTHORED events, against a DATA-DERIVED
  dual-term threshold - absolute gap `>=` p95 of the 7-day training pool (~6.0h) AND ratio `>=` 2.0x
  that agent's own median cadence. The ratio term normalises per-agent cadence; the 6h absolute floor
  kills the high-cadence confound.
- **BOUNDED-GAP only:** it measures a gap between two events and has NO trailing-now bound, so an
  ONGOING wedge (0 further events) reads a small gap and is SKIPPED, not paged. It catches a
  silent-then-resumes-same-day gap, not an open-ended silence. This is the settled boundary - do not
  document it as covering the ongoing/overnight class.
- **FINER (token-freeze) arm:** SHADOW-permanent until its own idle-vs-dead discriminator is validated;
  it never pages.
- **Codex-runtime EXCLUDED from COARSE paging** (`total_output_tokens` always null; 4h cadence gives
  only 2x margin at the Claude-calibrated threshold). Interim coverage is shadow-visible + daemon
  out.log, just unpaged; re-inclusion gated on the cadence-aware follow-up (`task_1789661123581`).

## The paging split - correct WHEN gap-liveness fires (TWO lists, do not conflate)

- **ARM-DAY notify** (when COARSE paging is flipped ON): **the-orchestrator + the-sop-keeper**, same
  day. (the-sop-keeper's capture task triggers on paging-armed - it is a notify target, NOT a paging
  target.)
- **PAGING TARGET** (when COARSE actually FIRES on a wedged agent):
  - COARSE-on-the-orchestrator -> **Adam direct (Telegram) + claude-dev-agent (urgent)** - never orch,
    never sop-keeper.
  - COARSE-on-any-other-agent -> **the-orchestrator** (normal path; +claude-dev on a repeat).

**Why the orch-down split:** the daemon heartbeat-staleness watchdog routes its alert to
the-orchestrator, so when orch is the wedged agent there is no escalation path (single-point
dependency on the most costly agent to lose). This detector is the interim NON-ORCH sink for the
orch-down class, and it pages a RECOVERY-CAPABLE peer: claude-dev owns the restart machinery
(`cortextos restart` / agent-management), while the-sop-keeper is gated-idle with no recovery
authority, so sop-keeper is not a paging target. Adam-direct is the orch-approved orch-down EXCEPTION
to the single-voice consolidation rule (the rule is voided precisely when the consolidator is the dead
agent). A zero-successful-delivery guard fires an error event if an orch-down page reaches nobody -
never silent.

## Responding to a page / a manual wedge check

1. **Recovery is claude-dev's lane** - restart the wedged agent (`cortextos restart <agent>` /
   agent-management).
2. **Manual wedge-discriminator (banked recipe):** read the agent's post-roll OUTBOUND / boot messages
   (`logs/<agent>/outbound-messages.jsonl`), NOT `heartbeat.json`. A wedged idle-prompt agent cannot
   send an outbound; a live one sends "Booting up" + a real "Back online" ~30-90s post-roll.
3. **Do NOT read `heartbeat.json` / `last_heartbeat` as the signal** - it is watchdog-clobbered post-roll
   for ALL agents (including verified-PASS agents), so it cannot discriminate wedge from clean in that
   window.

## Durable instrument-lessons (these outlive any single detector)

1. **Classify restart-TYPE from the daemon `out.log` + `crashes.log`, never the agent's own status
   string.** On 2026-09-17 both codex-dev-agent ("online after --continue config reload") and
   the-sop-keeper ("Thu cold boot") mis-described their own rollover restart; the authoritative records
   said session-time-cap rollover, and untouched config files falsified the "config reload" self-label
   directly. An agent's self-description of WHY it restarted is unreliable.
2. **Process-alive is NOT inference-alive.** A woken cron marks `fired` on a successful write while the
   turn it triggers can die silently - there is no feedback path that a woken turn aborted. So key
   liveness on the ABSENCE of an agent-AUTHORED signal, never on cron-fire, delivery success, or a
   watchdog mark-alive.
3. **`heartbeat.json` freshness is a process-liveness proxy, not an inference-liveness signal** - and it
   is watchdog-clobbered post-roll. The reliable manual signal is agent-AUTHORED output.

These are the same family as [the false-zero-from-the-instrument rules](standing-rules.md) - a proxy
that also describes the healthy case is not a detector.

## Boundaries - stated so nothing here is over-trusted

- gap-liveness is BOUNDED-GAP only; the COUNTER-FREEZE shape is OPEN (caught by neither instrument
  today); the-analyst's authored-events instrument is IN BUILD, not live.
- LATENCY: gap-liveness runs daily at 03:40Z, so a 19:00Z-roll wedge is caught ~8.7h later - a large
  improvement over the 18-20h that went unnoticed on 09-16, but a faster post-roll fire is a cadence
  question (raise with orch), separate from arming.
- Threshold is Claude-runtime-calibrated; per-agent cadence-awareness (~4x each agent's own beat
  interval) is the model, not a flat number.

## Cross-refs

- `FINDINGS-fleet-session-rollover-wedge-2026-09-17.md` - root cause, confirmed facts, hypotheses
  (claude-dev-agent). Authored but NOT yet on main (pending merge as of 2026-09-19); convert this to a
  link once it lands in the tracked tree.
- [heartbeat-staleness-watchdog.md](heartbeat-staleness-watchdog.md) - the watchdog whose
  process-alive/inference-dead LIMIT this detection set begins to close.
- the-analyst's `inference-liveness-validation.md` (threshold evidence, shadow samples, arm decision) -
  lives in the analyst's workspace, not the tracked tree; named here rather than linked. Graduation to
  the tracked tree is the-analyst's call.
- Follow-ups: `task_1787926557382` (#930 `last_agent_heartbeat` de-spoof), `task_1789661123581`
  (codex cadence-aware threshold).

## Owner note

gap-liveness detector = the-analyst (owns + operates). fast-checker written_at-staleness + the
counter-freeze gap = claude-dev-agent. This runbook = the-sop-keeper (documentation). Recovery action
on a page = claude-dev-agent.
