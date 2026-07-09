---
type: playbook
agent: meta-compliance-agent
process: lp-advertorial-review
status: active
date: 2026-07-09
tags: [playbook, compliance, landing-page, advertorial, fda]
---

# LP / Advertorial Review

Compliance review of a landing page or advertorial (the ad's DESTINATION), dispatched like a scan: an owner (cro-agent, meta-ads, the orchestrator, Adam) hands a page. A separate surface from the ad asset - the LP gets different latitude on vocabulary and NO latitude on health claims. Derived from the agent's rulings of 2026-06-29/30 (its MEMORY.md is the live authority; local, untracked - flagged).

## Scope gate first, always

Confirm whether the page receives Meta traffic (`meta-traffic: true/false`). That single flag decides the vocabulary rules:

- **meta-traffic false** (post-age-gate advertorial/DR page): the Meta cannabis-VOCAB ban relaxes - bud/flower/high/strain/potency are usable.
- **meta-traffic true**: full Meta vocabulary rules are back in scope; treat the page text like ad copy.

## What NEVER relaxes: health claims (M-4 family)

The destination page is where FDA drug-claim scrutiny actually lands (the reason M-10 exists), so cross-asset codes apply to LP HTML regardless of traffic source. The load-bearing lines:

- **Experiential vs efficacy**: describing a moment/state ("a relaxing evening", "wind down", sensory language) PASSES; a causal-efficacy assertion ("helps with relaxation", "effects kick in quickly") FLAGS M-4. The tell is the causal claim.
- **Medication substitution is M-4 on any surface**: "natural alternative" to prescriptions, "take the edge off" cabinet framing, pharmacy-replacement narratives. Fix = recast origin/motivation to quality/provenance, drop the medicine-replacement framing.
- **Testimonial health-claim clauses are attributed to the advertiser** even when genuine and owner-cleared - trim the claim clause, keep the testimonial.
- **Visual drug-effect claims count**: a glowing/heat-map pain-area graphic implies treatment as strongly as words - gate to Adam/legal, steer to a no-glow functional default.

## Lane split: FDA is this agent's verdict, FTC-comparative is Adam/legal

FDA content (disease/cure/treat/substitution, substantiation of numbers and press mentions) = this agent verdicts. FTC comparative/superiority claims and specific-price defensibility = risk-tiering + safe-default recommendations only; the final "legally defensible" call is Adam/legal. Guarantee-backed risk-reversal and customer-attributed opinions tier as defensible; flat brand-voice objective superiority is the riskiest tier.

## Whole-page premise gate

Some pages are structurally FDA-adjacent no matter the wording (e.g. positioning flower for pain). Reframes maximize defensibility but the residual is structural - such pages carry a whole-page Adam/legal publish-gate on top of line-item fixes.

## Verdict standard

Same as [scan-and-verdict.md](scan-and-verdict.md): PASS only on certainty, UNCLEAR routes to a human, FAIL and UNCLEAR are separate queues.
