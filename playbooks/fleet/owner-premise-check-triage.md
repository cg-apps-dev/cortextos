---
type: playbook
scope: fleet
process: owner-premise-check-triage
status: active
date: 2026-08-24
tags: [playbook, fleet, approvals, human-tasks, triage, premise-check]
---

# Owner-Premise-Check Triage

How a carried approval / human-task backlog is kept live and small: each check-approvals cycle TRIAGES 1-2 carried items with an OWNER-ROUTED PREMISE-CHECK instead of re-reminding them. The primary executor is the-orchestrator's check-approvals cron ([approvals-and-human-tasks.md](../the-orchestrator/approvals-and-human-tasks.md)); the method is documented fleet-wide because every agent is a potential premise-OWNER on the receiving end.

## The problem it solves

A repeated reminder is not a tracked item. A backlog of 25-30+ human tasks, most of them weeks old, cannot be re-reminded per-item without training the user to ignore the channel - and a carried item is worse than noise when its PREMISE has silently gone stale: it becomes a followable-but-wrong ask that costs the user real time (grant 8 accounts when only 4 are still live; re-book a slot that already lapsed). The backlog's danger is not its size - it is the stale-premise items hiding inside it.

## The core move: owner-routed premise-check, not self-investigation

Each cycle, pick 1-2 CARRIED items and, instead of re-reminding, send the OWNING agent a cheap bounded question:

> "Is this task's premise still live per your CURRENT records? No deep re-derivation - just check what you already hold."

This is what makes triage both CHEAP and SAFE:

- CHEAP: the owner already holds the current state, so the check costs them one lookup and costs the coordinator ZERO re-derivation. Returns are typically same-cycle.
- SAFE: the disposition rests on the OWNER's authority over their own lane, not the coordinator's guess about someone else's work.

Do NOT self-investigate another lane's premise - that is expensive, error-prone, and steps on ownership. Route it. (The only self-verifiable checks the coordinator runs directly are ones fully inside its own records.)

## Bucket order: premise-inverted-first

Triage in order of how HARMFUL a stale item is if it sits:

1. PREMISE INVERTED / overtaken FIRST - still-followable and therefore harmful if stale (the 8-vs-4 grant class).
2. Still-valid, still-blocked - the real backlog; route with the owner.
3. Already-fixed - harmless if it sits, so last.

## Dispositions (what the owner's answer drives)

- **Premise dissolved / overtaken -> CLOSE** with the owner-endorsed reason AND a REFILE TRIGGER the owner owns (e.g. "reopen on persona-volume scale-up"). Because the owner owns the watch, the close is safe.
- **Scope changed -> CLOSE-AND-REFILE with two-way pointers**: the old task completed-superseded, a NEW task fresh-scoped, each naming the other. Prevents double-carry and keeps the eventual ask quoting fresh state (the 8->4 BM re-grant).
- **Premise still live -> route / hold** per the buckets; if it is a carried DECISION, see the discipline rules.

## Standing discipline rules

- **Verify before quoting.** Never restate a figure or availability from an old task body - quote fresh at execution; ask the owner first.
- **Decisions are inert; diagnoses expire.** A carried DECISION awaiting a ruling is fine to hold (it does not rot). A carried DIAGNOSIS is a claim with a shelf life - re-verify or label it unverified, never re-assert it unexamined.
- **3+ carries -> forcing-function-or-close.** An item carried three or more times unchanged gets a default action (a forcing function - attach it to a scheduled session or a decision slot) or a stated-reason close. Never re-copy it a fourth time.
- **Owner-confirmed still-live -> no re-check for 7 days; disposition, not re-verification.** An item whose premise an OWNER has confirmed still-live receives no further premise-check for 7 days from that confirmation. The correct next action on an owner-confirmed still-live item is a DISPOSITION - the carried-3+ forcing function, route-with-owner, or hold-per-bucket - never a re-verify. The window is per-item-per-confirmation; a fresh owner confirmation restarts it. Re-checking an owner-confirmed item inside the week yields ~zero (measured: 6 items across 2 cycles, 6 still-live confirmations, 0 closes) while each check costs an owner lookup and trains owners to deprioritize the ask channel. The window blocks only UNPROMPTED re-verification - never acting on new information; four overrides lift it:
    - **State-change evidence:** any new signal the premise may have moved (an owner report, a monitored trigger firing, an Adam action touching the item) permits an immediate re-check.
    - **Deadline proximity:** an item entering a genuinely-expiring window (a dated deadline within ~72h) gets one fresh verify stamp before riding a consolidated Adam message.
    - **Verify-before-quoting takes precedence (unchanged):** quoting a figure or availability to Adam requires quote-time freshness regardless of the window - that is a quote rule, not a premise re-check.
    - **Owner-initiated re-stamps** on the owner's own cadence are always welcome and are not premise-checks (e.g. an ad-strategist Foreplay heartbeat re-stamp).
- **Trust the enumeration, not the tally.** The enumerated ID list is the artifact; a running count is a label that drifts (an untagged close never touches a scoped tally). Re-enumerate rather than trust the running number.
- **Answers labeled at evidence strength, boundaries stated** (measured vs plausible vs confirmed).

## Cadence and night-mode

1-2 per cycle - enough to convert carried items into fresh-asks-or-clean-closes at ~1 per cycle without flooding owners. NIGHT-MODE: owners are idle overnight, so run NO owner-ping triage at night - only self-verifiable checks - and let the backlog state ride the MORNING BRIEF (consolidated backlog belongs in the brief, never in reminder pings).

## Proof (the run this codifies)

2026-08-23/24 overnight, the method converted a long-carried backlog at near-zero user cost: 5 owner premise-checks -> 4 closes/relaxes + 1 rescope in one night, and the user's Mon-Wed ask-queue shrank by one.

- BM-access 8-account grant (carried from 08-10) -> mmb premise-check same-hour -> partially overtaken -> rescoped 8->4, close-and-refile (would otherwise have asked the user for 8 grants, 4 of them pointless).
- Higgsfield Soul back-fill (08-12, 11 days) -> production-house -> still live but the NB-reference workaround covers 100% of current production -> closed with an owner-owned refile trigger.
- June Flower duplicate -> closed (a 4-week unnoticed double-carry).
- Flower-404 assets -> mc re-verify -> premise dissolved (22/22 assets present) -> closed.
- Lane-A product-as-news ruling (07-09, oldest carried, 6.5 weeks) -> mc -> never-launched (zero ad-ids across all 19 authoritative ledger columns) -> closed-superseded, refiled as a post-trip policy ask, OFF the near-term queue.

Each was an ask that would have reached the user stale; the owner-check either evaporated it or re-scoped it into a fresh two-minute item.

2026-08-31/09-01, the-orchestrator ran two more premise-checks against carried human-task backlog; both dispositioned in-cycle at near-zero user cost, and one spun off a durable fleet capability.

- Brain Drive-mirror lag (task_1786647706267, carried from 08-13, "v1.0.12 Drive vs v1.0.14 GitHub") -> SELF-verifiable, no owner ping -> read the Drive mirror directly off the local CloudStorage mount + `gh api` on main, compared BYTE-PARITY (normalized-JSON sha256): both v1.1.5, identical, mirror already re-synced Aug 24 -> premise dissolved -> CLOSED, no user decision needed. Spun off a fleet standing rule (Drive-mirror READS are self-serviceable) so the whole class stops needing `[HUMAN]` filings for reads.
- activity-channel Telegram bot (task_1786560196566, carried from 08-12, premise-checked 08-26 AND 08-31) -> STILL LIVE (no `activity-channel.env` tree-wide, `postActivity` reads only that file, no fallback) -> HELD, attached to the post-trip BotFather/credential bundle (a forcing-function slot), NOT re-copied -> zero op-impact, low-pri-but-valid.

REFINEMENT this run added: the core move is "owner-routed, not self-investigation" for a premise that is an OWNER JUDGMENT - but when the premise is a directly machine-verifiable FACT (a version, a file's presence, a byte-for-byte currency check), SELF-VERIFY it; do not ping an owner to read something you can read. Route to the owner only for the judgment the owner alone can give. And on a multi-carry item whose premise is still live, the disposition is a FORCING FUNCTION (attach to a scheduled slot), not a fourth re-copy - the "3+ carries" discipline rule in practice.

REFINEMENT 2026-09-16 (the self-verify move extended to the REQUESTER-ASSERTION direction): the machine-verifiable-fact -> self-verify rule above binds not only a premise you CARRIED but a premise you are HANDED - including one an authority cites from memory when requesting work. A machine-verifiable premise in an incoming ask gets self-verified BEFORE you build on it; the requester's authority does not substitute for the check. Origin: the-orchestrator requested a specimen be appended to a fleet rule described as living "in both knowledge.md AND standing-rules.md"; a one-line `git grep -c` against main returned 0 in standing-rules.md - the rule was knowledge.md-only, and the dual-home the request presumed did not exist. Cost of the check: one command. Cost of skipping it: appending to a nonexistent target and mis-shaping the edit. Same move as the Drive-mirror byte-parity self-verify, applied to a HANDED premise rather than a carried one - and it is why "verify before quoting" (discipline rules above) governs the PREMISE of an incoming ask, not just a figure in an outgoing one. This is the requester-side complement of owner-routing: route the JUDGMENT to the owner, but self-verify the FACT the ask rests on, whoever handed it to you.

REFINEMENT 2026-09-22 (the 7-day floor on re-checking owner-confirmed items): the owner-routed premise-check has a floor - once an OWNER confirms a premise still-live, re-checking the same item inside 7 days is near-zero-yield churn, not diligence. Origin: 2026-09-21 20:38Z, the-orchestrator premise-checked cro's trust-line task (1787258541458) three days after an identical 09-18 check returned an identical answer; cro flagged the duplicate ("owner-confirmed still-live = a forcing function, not re-triage"). Companion datapoint the same day: 6 carried items checked across 2 cycles returned 6 still-live confirmations and 0 closes - the marginal yield of re-checking an owner-confirmed item inside a week is ~zero, while each check costs an owner lookup and erodes the ask channel (owners learn the question is noise). Codified as the "owner-confirmed still-live -> no re-check for 7 days" discipline rule above, with four overrides (state-change evidence, deadline-proximity, verify-before-quoting-precedence, owner-initiated re-stamp) so the window blocks only UNPROMPTED re-verification and never blocks acting on new information. Same family as this playbook's founding premise that "a repeated reminder is not a tracked item" - here the repeated PREMISE-CHECK is the thing that is not diligence.
