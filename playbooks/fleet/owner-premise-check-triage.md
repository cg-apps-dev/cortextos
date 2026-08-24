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
