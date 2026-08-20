---
type: playbook
scope: fleet
process: capacity-incident-response
status: active
date: 2026-08-15
tags: [playbook, fleet, capacity, usage-cap, incident, escalation]
---

# Fleet runbook: usage-cap capacity incident

How the fleet responds when a shared usage account (e.g. the `me-com` Claude account the fleet runs on) is trending toward its cap **before** its reset, risking a fleet-wide hard-stop. Codified from the 2026-08-14 me-com incident (the-orchestrator's decision log, `agents/the-orchestrator/memory/2026-08-14.md`). The-analyst owns the usage watch; the-orchestrator owns the escalation + the human-facing pings; agents own honoring the tighten.

## When this fires

A capacity incident is a **rate-vs-reset race**, not a spike: the account's usage is on a trajectory to cross 100% of its window **before** the window resets, on a **hard-stop** account (extra-usage OFF = cap-hit stops the fleet, not just bills overage). The trigger is a *sustained rate* read, not a single high number — see burst-vs-settled below.

## The core discipline: pre-stage the levers, fire on signal, never re-deliberate

**Decide the whole ladder while calm; at each tripwire, FIRE — do not re-open the decision.** The 08-14 arc worked because every lever, threshold, and page was drafted in advance ("STAGED LEVERS (decisions pre-made, no re-deliberation)"; "DECISION TREE LOCKED"). Mid-incident re-deliberation burns the exact resource you're conserving and adds latency at the worst moment. Tripwires are mechanical: *"12:37Z ≥86% OR another 5h-jump = page immediately regardless of hour"* fires with no further thought. Pre-draft the human pages too (the valve ask was written before it was needed, so sending it was one action, not a drafting round).

## The escalation ladder (each rung: what it does, what it costs, how far it reaches)

Ordered least-to-most invasive. Each rung's *reach* (can it actually get you to the reset?) is the deciding question — a rung that only buys time is a delay, not a fix.

1. **TIGHTEN (fleet directive, fires first, no human needed).** All non-watch agents: defer electives, minimum-cost cron fires, terse cycles, production-critical only (intake, stamps, launch sweep, and the usage watch itself), report-by-exception. Pulled per the pre-staged agreement with no fresh decision round. **Reach:** throttles the *work-half* of the burn; does not touch the automation **floor** (idle-fleet baseline). Necessary, rarely sufficient alone.
2. **TIER-2 (pause intake + non-critical crons).** Hold production intake at draft-stage only (recoverable — costs staging latency, not launches, when the human publishes manually anyway) + pause non-critical crons. Fires if the human is silent past a pre-set hour. **Reach (08-14 math):** moved crossing ~noon→~8pm — a **7–8h time-buy only**, could NOT reach the reset, because the automation floor (~21%/day) alone was ~3.4× the survivable rate (~6.1%/day). Know your floor before trusting tier-2.
3. **OPTION-C / emergency re-split (attack the floor directly).** Re-split the 2–3 heaviest agents onto a different account (08-14: icloud-max via the gated `switch-agent-account` tool). Reversible, fleet-executable. Attacks the **floor**, not just the work-half. Fires on human approval OR at ~95% on emergency authority (outage beats an unblessed re-split on harm). **Caveat to state honestly:** the fallback account's cred may be dead/unverified — flag that blind spot rather than assume it's fresh. Tension: a re-split is often also the human's pending account-strategy/SPOF decision, so it briefs as their option *and* an emergency authority, not a silent action.
4. **HUMAN VALVE (the only full fix).** Ask the human to flip **extra-usage ON** — cap-hit becomes overage *cost* instead of fleet *stop*. This is the only rung that actually reaches past the cap. Everything below it buys time or lowers the rate; only the valve removes the hard stop. Ask early, ask plainly (a 2-minute toggle), re-elevate on re-acceleration, and downgrade to "good insurance" honestly when the trajectory flattens — but keep asking, because it's the real fix.

## Burst vs settled rate — do not act on a spike

The single most important read discipline: **a high instantaneous number can be a one-off burst, not a trend.** A fleet-wide `--continue` restart or a crash re-ingests ~10 large agent contexts at once — a real cost, but a *burst shape* that settles. On 08-14, `84% (+4pp)` looked alarming until the settle-read showed `5h-active = 3%` = **burst settled, no active burn**. The 11:19Z restart and the 11:53Z crash were **two distinct burst events, not an accelerating loop** — mislabeling them as a loop would have triggered a wrong page.

- **The disambiguator is the settled-rate read** (recent short-window active %, e.g. "5h active"), not the cumulative %. Cumulative tells you where you are; the settled rate tells you where you're going.
- **On any spike: wait for the next settle-read before paging or firing a rung** — unless a hard tripwire (absolute % ceiling) is independently hit. Pre-arm the settle-read into the tripwire ("≥86% OR a 5h-jump") so the burst case can't stampede a decision.

**Instrument scope — the 5h utilization read is Code/inference-only; it is BLIND to consumer/web (Fable-class) usage.** A `5h = 0%` means no *inference* burn — it does **NOT** mean no billable usage. On a shared personal account, consumer/web usage bills against the same account invisibly to the 5h metric: on 08-14 me-com read **Fable 69% + 202 overage credits while the 5h showed 0%.** So the watch needs two lenses, not one:
- **Fleet / inference burn:** the 5h utilization + spend% (what the escalation ladder above is calibrated to).
- **Consumer/web burn on a shared personal account:** `used_credits` + `scoped_limits` **per-model** (catches the Fable-class burn the 5h can't see).
Never conclude "no active burn" from a 5h of 0 alone on a shared personal account — cross-check the per-model credit view first, or a whole billing dimension stays dark exactly like the per-agent attribution gap below.

## Watcher-cadence ownership: turn-based watcher, coordinator owns the pings

The watch is **turn-based and pull-model**: the watcher (08-14: the-analyst) polls on its own heartbeats + on demand — **messaging the watcher IS the poll trigger.** The watcher does not push every reading; it messages the coordinator only on **promised triggers** (approach-flag %, genuine re-acceleration, a credential-expiry/400, a real decision point). **The coordinator owns the human-facing cadence** — it decides what reaches the human, held to a *promised-triggers-only* bar (not every percentage point), so the human gets state-changes, not a stream. Split cleanly: watcher → coordinator on triggers; coordinator → human on decisions. Never let the raw poll stream reach the human.

## The authoritative reset source

**Read the reset time from the usage-API's own `resets` field — NOT from `list-oauth-accounts`.** The account-list view is not the authoritative reset clock; anchoring the whole rate-vs-reset race on the wrong reset time silently miscalculates the entire race. Confirm the reset from the usage API before projecting any crossing.

## Manual kill-window protocol — LEGACY / fallback-only

A manual "kill-window" (hard-stopping heavy agents during the peak window by hand) was the pre-fix stopgap. **As of 2026-08-15 it is LEGACY / fallback-only:** claude-dev landed the `switch-tool` probe-fix (`425c96a7`, live + security-sealed), which is the current mechanism for moving load off a hot account. Use the tool path (option-C re-split); fall back to the manual kill-window only if the tool path fails, and only pending the first real-switch validation of the fix. The decision-tree and lever content above are unchanged by this — only the kill-window's status is demoted.

## Open question — valve semantics (unresolved)

**Does flipping extra-usage ON actually prevent 429-pauses past the cap, or can the account still 429-pause past cap despite the valve being on?** This was observed/suspected on 08-14 and is **not yet resolved.** Until confirmed, do not treat the valve as a guaranteed never-stop — treat it as the best available full-fix while flagging that a past-cap 429-pause may still occur. Resolve this against the provider's actual behavior and update this section.

## The meta-lesson: attribution blindness forces blanket tightening

The 08-14 incident was harder than it needed to be for one structural reason: **with per-agent cost attribution frozen (cost-ingestion dark since 07-12), the fleet could not see which 2–3 agents burned the most — so it had to blanket-tighten all 10.** A blanket tighten is a blunt instrument that costs every agent's throughput to throttle a few heavy ones. **The priority case for the cost-ingestion fix keeps writing itself every incident** — until per-agent attribution is live, capacity response cannot be surgical, only fleet-wide. Note this in any capacity post-mortem: the response quality is capped by attribution visibility.

**Update 2026-08-19 — the fix landed.** The cost-ingestion fix shipped as `c154047f` (per-agent claude-home isolated-transcript scan + a per-source staleness watch). Once its per-agent attribution is verified **producing live data**, the next capacity incident can be **surgical** — throttle the 2–3 heavy agents instead of blanket-tightening all of them — the exact upgrade this lesson called for. Verify the attribution is actually live before relying on it in an incident (merged ≠ producing data — the same deploy-beat the DNS runbook keeps teaching); until then, default to the blanket ladder above.

---

*Provenance: the-orchestrator's 2026-08-14 me-com capacity incident (`agents/the-orchestrator/memory/2026-08-14.md` — the full decision log), codified by the-sop-keeper 2026-08-15 per orch dispatch (task_1786806150631). Kill-window demoted to LEGACY per the switch-tool probe-fix `425c96a7`. Related: `switch-agent-account.md` (the re-split tool), `standing-rules.md` (pre-staged-levers + burst-vs-settled are instances of decide-the-test-not-the-verdict / verify-against-the-settled-state).*
