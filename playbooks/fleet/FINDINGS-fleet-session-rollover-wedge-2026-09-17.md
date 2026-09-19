# FINDINGS: two-agent silent inference-dead wedge after a fleet-wide session-cap rollover (2026-09-16/17)

**Owner:** claude-dev-agent · **Task:** task_1789657613306_61394714 · **Filed:** 2026-09-17
**Handed by:** the-orchestrator (root-cause thread, msg ...u4g0s). Analyst holds the specimens for the liveness detector (task_1789653922243_96509801).

## One-line
A phase-aligned fleet-wide session-time-cap rollover at 2026-09-16T19:00Z re-spawned 8 agents within ~12s; 2 of them (the-orchestrator, meta-ads-agent) had their fresh `--continue` session wedge on a silent turn-death and sat process-alive / inference-dead for ~18-20h. It went undetected because the fast-checker `[watchdog] alive` mark-alive kept `last_heartbeat` fresh - the exact #930 watchdog-spoof gap. Not a crash, not a daemon failure, not an injection-delivery failure.

## CONFIRMED FACTS (evidence-backed)

1. **Trigger = fleet-wide session-time-cap rollover, phase-aligned.** All agents' `crashes.log` carry one entry in the window:
   `type=session-refresh reason=session-time-cap rollover ... end_reason=prompt_input_exit last_task=[watchdog] <agent> alive - idle session`
   Timestamps cluster in ~12s: claude-dev 19:00:02.978Z, cro 19:00:05, meta-ads 19:00:08.9, meta-compliance 19:00:09.7, meta-media-buyer 19:00:09.8, ad-strategist 19:00:09.8, the-team-lead 19:00:14.05, the-orchestrator 19:00:14.07. **[CORRECTED 2026-09-17 - see CORRECTION addendum below]** This is a **24h `max_session_seconds`=86400 cap** on these 8 agents, re-rolling **DAILY at ~19:00Z** (NOT the ~71h `--continue` auto-refresh originally written here). The caps are phase-aligned because these 8 were last batch-(re)started on a 19:00Z boundary; the phase creeps ~6-7s later each day. Each was IDLE at rollover (last activity a watchdog mark-alive).

2. **No daemon crash.** `.daemon-crash-history.json` latest entry is 2026-08-20. The daemon did not crash or restart at the window.

3. **No agent-initiated restart.** Each agent's `restarts.log` latest entry is <= 2026-08-20; the 19:00Z respawn was daemon-level (session rollover), not a self/hard-restart.

4. **Injection delivery stayed intact the whole time.** Both wedged agents' `cron-execution.log` show every cron `status:"fired" attempt:1 error:null` across the outage - orch fired at 18:58 / 20:58 / 22:58 / 00:58 / evening-review 01:00:26 / 02:58 ... 15:00; meta-ads heartbeats 20:58 / 00:58 / 04:58 / 08:58 / 12:58 and meta-daily-sweep 13:00:29. No gaps, no retries, no errors. The daemon delivered; the agents' turns did not process.

5. **Silent turn-death, NOT a crash.** Each agent's `crashes.log` has exactly ONE 09-16/17 entry (the rollover) and no subsequent crash. So the wedge produced no crash record - it is the process-alive / turn-dead wedge, same class as the 2026-06-22 429-killed-heartbeat finding (cron marks `fired` on a successful WRITE; there is NO feedback path that the woken turn aborted, so a dead turn is silently lost).

6. **claude-dev = live negative control.** I rolled at the SAME 19:00:02Z from the SAME cap and processed my boot injection plus every subsequent cron (20:58/00:58/04:58/08:58/12:58Z heartbeats + 14:00Z upstream-check) and all agent messages in real time. So the rollover itself is not the wedge. It hit 2 of 8; 6 (me + 5) recovered. **Selective, not wave-wide.**

7. **Undetected because of the watchdog-authored-heartbeat spoof.** The fast-checker mark-alive (`[watchdog] <agent> alive - idle session`, ~50min) kept `last_heartbeat` fresh throughout, so the heartbeat-staleness watchdog never saw staleness and never alerted. This is precisely the gap that task_1787926557382_04710319 (#930 demote-watchdog-beats -> `last_agent_heartbeat`) and the-analyst's token-freeze detector are built to close. **This incident is live confirmation of the #930 detection gap.**

8. **Abort markers present in the wedged agents' stdout.** `the-orchestrator/stdout.log` = 2 matches, `meta-ads-agent/stdout.log` = 10 matches for `temporarily limiting requests|Rate limited|overloaded_error|529|API Error`. Consistent with API-error/rate-limit killing turns. (Exact timestamp-to-19:00Z correlation not pinned - see open item; stdout.log is 8-31MB, ANSI-laden.)

## HYPOTHESES (plausible, NOT proven)

- **H1 (why these 2 aborted): thundering-herd on simultaneous resume.** 8 fresh `--continue` sessions firing their first turn within ~12s is an API-contention spike; a transient server-side 429/overload on the first post-rollover turn would abort it. Supported by the abort markers (fact 8) and by the 2026-06-22 note that 429 is shared server-side (the watchdog re-inject was deliberately staggered to avoid exactly this). Not proven: abort markers not yet timestamped to 19:00Z.
- **H2 (why it persisted ~18-20h instead of self-recovering ~4h): a rolled session's dead first-turn is stickier than a mid-session missed beat.** In the 2026-06-22 case a single 429-killed heartbeat self-recovered when a later beat landed in a clear window. Here the failure was the FIRST turn of a brand-new `--continue` session; if subsequent injections queue behind an incomplete first turn rather than each getting a fresh turn, the session stays wedged until a restart/heavier break-through. Recovery: meta-ads processed ~13:00Z, orch ~15:00Z (morning-review). Not proven: no direct trace of the queue-behind-stuck-turn state.

## THE DETECTION-GAP LINK (the load-bearing takeaway)

Two agents were inference-dead for 18-20h and **no existing detector fired**, because the only liveness signal (`last_heartbeat`) was kept fresh by watchdog mark-alive writes. The fix is already in flight and this incident is its strongest justification:
- **task_1787926557382_04710319** (mine, #930): `last_agent_heartbeat` advances only on agent-authored beats -> would have gone stale ~18-20h here = detected. Coarse de-spoof (this incident's class).
- **the-analyst token-freeze detector** (task_1789653922243_96509801): total-token movement freeze -> the finer within-cadence layer. Also catches this.
- Both would have fired on this incident. It moves #930 from "non-urgent, backstop exists" to "has a live recurring failure it uniquely catches."

## SECONDARY GAP (worth naming): the watchdog alerts ORCH, but ORCH was the dead agent

The heartbeat-staleness watchdog routes its alert to the-orchestrator. When the orchestrator itself is the wedged agent, there is no escalation path - the independent liveness signal has a single-point dependency on the very agent most costly to lose. Even post-#930 (when staleness would be detectable), the ALERT still needs a non-orch destination for the orch-is-down case. Recommend: a secondary alert sink (Adam-facing, or a peer agent) for staleness alerts naming the orchestrator.

## RECOMMENDATIONS

1. **Prioritize task_1787926557382_04710319** (last_agent_heartbeat) - this incident is its recurring-failure justification. Analyst detector complements. (Sequencing to orch.)
2. **Stagger session-cap rollovers** so the fleet does not resume 8 sessions in ~12s (jitter `max_session_seconds` per agent, or a small per-agent rollover offset). Removes the H1 thundering-herd aggravator regardless of whether H1 is the exact cause. Design-only; needs orch/Adam.
3. **Give the rolled-session first-turn a failure feedback path** - the 2026-06-22 open gap (no signal that a woken turn aborted) is unfixed and is what makes both this and the 06-22 class silent. Cross-reference the SPEC-heartbeat-gap-429-watchdog re-inject (staggered) work.
4. **Secondary alert sink for orch-down staleness** (secondary gap above).

## OPEN ITEMS (if trail-freshness warrants)
- Timestamp the stdout abort markers to confirm they land at ~19:00Z boot (H1). Bounded ANSI-strip extraction; stdout.log is large.
- Confirm H2 by checking whether orch's post-19:00Z injections show any partial-turn stdout before recovery.

## Cross-refs
2026-06-22 silent running-but-heartbeat-stale wedge (MEMORY.md); SPEC-heartbeat-gap-429-watchdog; playbooks/fleet/heartbeat-staleness-watchdog.md (the limit section names this exact undetectable case); FINDINGS-frozen-log-tail-false-codered-2026-07-29.

---

## ADDENDUM (2026-09-17, later): a SECOND phase-cluster (herd-of-2) rolled clean - herd-size is the wedge variable

A second, smaller rollover cluster surfaced the same day and it sharpens the mechanism.

- **codex-dev-agent** session-refreshed at **15:59:42Z**; **the-sop-keeper** at **15:59:43Z** - within one second of each other, a 2-agent cluster on a DIFFERENT cap phase than the 19:00Z eight. sop-keeper's crashes.log shows the ~71h cadence on a ~16-18Z phase (09-11 17:59Z, 09-14 16:59Z, 09-17 15:59Z), batch-aligned ~09-14 (Sun). The daemon did NOT bounce; every 19:00Z-wave agent kept intact ~21h uptime.
- **BOTH PASSED.** Coherent agent-authored heartbeats after the refresh (codex 16:00:25Z, sop-keeper 16:02:54Z) - inference-alive, not watchdog-masked. Zero wedges in this cluster.
- **HERD SIZE is the variable (the load-bearing refinement).** A simultaneous-resume cluster of 2 produced 0 wedges; the cluster of 8 produced 2. Wedge risk scales with how many sessions resume at once - which is exactly the quantity the jitter fix reduces. This is direct (small-sample, not proof, but directionally strong) support for SPEC-session-rollover-jitter: jitter shrinks the simultaneous-resume cluster. It also reframes H1: the thundering-herd is real and size-dependent, not all-or-nothing.

### Codex-runtime records no per-agent lifecycle event (filed: task_1789660994919)
sop-keeper is the clean control for the record-gap: at the SAME rollover second, **the-sop-keeper (Claude-runtime) WROTE a crashes.log `type=session-refresh reason=session-time-cap rollover` entry; codex-dev-agent (Codex-runtime) did NOT** - its refresh is visible only in the daemon out.log (`[codex-dev-agent] Session refresh (--continue restart)`). So the gap is the Codex agent-process path, not the event class. Codex lifecycle events should write the same per-agent crashes.log/restarts.log records as the Claude refresh path.

### Instrument warning (for the wedge-class capture doc)
BOTH codex and sop-keeper MIS-PHRASED their own restart in their heartbeat status string - codex "online after --continue config reload", sop-keeper "Thu cold boot" - when the authoritative records (daemon out.log + crashes.log) say **session-time-cap rollover, --continue**. An agent's self-description of WHY it restarted is unreliable; classify restart-type from the daemon out.log + crashes.log, never the agent's own status string. (Config files were untouched - codex config.json 07-09, .env 07-29 - falsifying the "config reload" self-label directly.)

---

## CORRECTION + REFINEMENT (2026-09-17 ~19:00Z; orch datum + analyst sweep + my config read, three independent instruments)

**1. Cadence was mis-stated as ~71h. It is 24h/DAILY for the wedge herd.** Ground-truthed `max_session_seconds` in every agent's `config.json` and swept all 19 `crashes.log` (09-15..09-17):
- **24h cap (86400s) = the wedge herd of 8**, re-rolling DAILY at ~19:00Z: the-orchestrator, claude-dev-agent, the-team-lead, meta-ads-agent, meta-compliance-agent, meta-media-buyer-agent, the-ad-strategist, cro-agent. Confirmed present 09-14/15/16/17, ~12s spread, phase creeps +6-7s/day.
- **86400s but phase-drifted off 19:00Z** (manual restarts moved their phase): the-analyst (~00Z now), security-agent (~22Z).
- **71h cap (255600s) = separate cohort** on ~16-18Z phases, NOT in the 19:00Z herd: the-axon-agent, the-production-house, research-agent, vitalis, the-sop-keeper, codex-dev-agent. (sop-keeper+codex were the 16:00Z herd-of-2 in the addendum above.)
- Three different-fault instruments agree: orch's crashes.log timing, analyst's 19-log sweep, my `config.json` read (the oracle: "~24h inferred" -> "86400s exact"). Fact 1 and the "batch-restarted ~71h prior" premise are corrected inline above.
- **Implication:** exposure is DAILY at ~19:00Z (next after 09-17 = Fri 09-18 ~19:00Z), NOT a weekly Saturday gate. The jitter deploy deadline is "bounce before the next 19:00Z you want protected."

**2. Herd size is NECESSARY-NOT-SUFFICIENT (refines the "herd size is the variable" addendum).** Herd size was CONSTANT at 8 on both 09-16 and 09-17, but wedges were **2/8 (09-16) vs 0/8 (09-17)**. So 8-simultaneous-resume is NOT sufficient to wedge; if it were, today would have wedged too. The differentiator is the **transient server-side 429/overload on the fragile first post-roll turn** (present 09-16 per the abort markers, absent 09-17). The herd is an **aggravator** (more coincident first-turns -> higher 429 probability), not the trigger.

**3. Two-layer framing (locked with orch+analyst).** Jitter (SPEC-session-rollover-jitter) = LAYER 1, herd de-clustering = lowers 429 PROBABILITY, does NOT remove the failure mode. LAYER 2 = the actual safety: `last_agent_heartbeat` de-spoof (task_1787926557382_04710319) + non-orch alert sink + a failure-feedback path that retries/surfaces a 429-killed first turn (rec #3). **Do not present jitter as "the fix"** - that makes Layer 2 load-bearing-alone.

**4. Today's 09-17 19:00Z roll = 0/8 wedged (clean fleet-PASS batch).** Verified NON-SPOOFABLY: every one of the 8 sent "Booting up... one moment" at ~19:00:30Z AND a real "Back online" status at ~19:01-19:02Z (post-roll outbound messages) = full session-start completion; a wedged idle-prompt agent cannot send outbound.
- **Manual wedge-discriminator recipe (banked):** post-roll outbound/boot messages (`logs/<agent>/outbound-messages.jsonl`), NOT `heartbeat.json`.
- **`heartbeat.json` is watchdog-CLOBBERED for all 8 as of the 19:03:37Z fast-checker mark-alive - including claude-dev-agent, a verified-PASS agent.** So heartbeat.json alone cannot discriminate wedge; this is the #930 spoof observed LIVE today on a known-clean agent = concrete recurring-failure evidence for prioritizing task_1787926557382_04710319. Analyst's coarse detector is robust to this by construction (it carries event-derived `last_agent_authored` across rolled snapshots with a cadence-aware stale threshold, not the current heartbeat.json string).
