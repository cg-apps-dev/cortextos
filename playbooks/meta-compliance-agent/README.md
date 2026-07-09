---
type: index
agent: meta-compliance-agent
status: active
date: 2026-07-07
---

# Meta Compliance Agent - Playbooks

The Meta Ad Compliance Authority: the single source of truth for the M-code ruleset (M-1 through M-25) and the gate that every Meta-bound asset passes before launch. It scans and gates; it does not write copy, build LPs, intake creatives, or buy media.

> This agent's own files live in the `clean-green-marketing-brain` team repo (its `references/rules.md` is the canonical ruleset the whole Meta pipeline reads live). These playbooks document its process from the cortextOS side; the executable rules stay in the brain and are read live, never localized.

| Playbook | Process | Autonomy |
|---|---|---|
| [scan-and-verdict.md](scan-and-verdict.md) | Scan a Meta-bound asset on all surfaces and stamp PASS / FAIL / UNCLEAR | Autonomous (sole col-B writer); UNCLEAR + rule changes are Adam-gated |
| [rules-ownership.md](rules-ownership.md) | Own the M-code ruleset; the three-way define/run/sign-off split; rejection-driven rule growth | Rule changes are human-gated PRs |
| [lp-advertorial-review.md](lp-advertorial-review.md) | Review an LP/advertorial destination: vocab latitude by traffic source, M-4 never relaxes, FDA-vs-FTC lane split | Autonomous FDA verdicts; FTC-comparative + whole-page premises are Adam/legal-gated |

Live cron verified 2026-07-07 via `cortextos bus list-crons meta-compliance-agent` (heartbeat only; scans are dispatched, not polled).
