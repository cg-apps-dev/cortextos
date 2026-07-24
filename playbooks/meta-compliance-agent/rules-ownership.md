---
type: playbook
agent: meta-compliance-agent
process: rules-ownership
status: active
date: 2026-07-07
tags: [playbook, compliance, meta, rules, governance]
---

# Rules Ownership

How the M-code ruleset is owned, served, and grown. Derived from IDENTITY.md, references/rules.md, and the fleet live-read discipline.

## The ruleset

`references/rules.md` (in the brain repo) is the canonical M-1 through M-25 set - each entry one rule or a family, many decomposing into lettered sub-rules by enforcement tier (e.g. M-19a hard-fail grep, M-19b flag-for-review, M-19c/d/e visual/creative/emoji). Each rule carries an applies-to surface, a severity, and cites the empirical rejection that motivated it. A consolidated Tier-1 grep block projects the deterministic subset to a machine-readable `banned-terms.json`.

## The three-way split

- **Who defines the rules**: meta-compliance-agent, solely. It owns rules.md; every other agent points here.
- **Who runs the scan**: split two-surface, worst-of - meta-ads runs the creative/vision scan and stages findings; meta-compliance runs the copy-layer scan and writes col B as worst-of(creative, copy). See [scan-and-verdict.md](scan-and-verdict.md).
- **Who signs off**: Adam, for UNCLEAR/decision-level calls and any rule change or gate override. Legal-boundary calls (FTC comparative/superiority, whole-page publish defensibility) are Adam/legal, not this agent.

## Standing disciplines

1. **Rules are NEVER localized.** Agents read rules.md / banned-terms.json LIVE from brain main, never a cached copy (KB finds, repo is truth). Rationale: compliance rules changed 3x in one mid-week; only live reads make staleness impossible.
2. **Deterministic-clean != compliant** - the semantic/visual layer catches what grep can't (the packaging-gestalt gap that killed a clean-copy ad; the E-0930 account death on a col-B PASS).
3. **For video the AUDIO is source of truth** - whisper the actual audio, not de-coded captions (the Brandon M. proof: clean copy, an M-2 "plain box" hiding in the spoken VO).
4. **Source-of-truth hierarchy on conflict**: for `meta-traffic: true` assets the Meta rule wins over channel-agnostic brand vocab - words the brand marks "approved" (e.g. real bud, hand-rolls) are still banned on Meta.

## Rejection-driven growth (M-17)

1. Every Meta rejection is logged to learnings.md within 24h (ad name/ID/account, date, Meta-cited policy, the triggering copy/imagery, and the rule that should have caught it or "no existing rule").
2. 3+ rejections of the same type auto-promote to a new Tier-1 grep or Tier-2 classifier via human-gated PR (the threshold is deliberately low).
3. Optional weekly AdManage pull filters DISAPPROVED / WITH_ISSUES (the Meta reason text isn't exposed - manual paste). **Account scope (Adam/orch, 2026-07-23/24):** any account that transitioned WARMING -> ACTIVE (first live launch) auto-promotes into this pull's scope immediately - never wait for a manual account-list update. See [fleet/standing-rules.md](../fleet/standing-rules.md)'s warming-to-active registry row (the JCG2 near-miss).
4. If any account drops to Limited/Restricted, all new launches halt until a human-gated review updates the ruleset.
