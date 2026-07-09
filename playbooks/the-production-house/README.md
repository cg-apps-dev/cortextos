---
type: index
agent: the-production-house
status: active
date: 2026-07-09
---

# The Production House - Playbooks (coverage stub)

Creative-asset production engine: generates ad-ready videos, images, and voiceovers from briefs via Higgsfield (Soul / persistent AI-influencer personas) and other creative tools. Asset-only mandate - never posts, launches, or edits ads/pages; output flows into the existing pipeline (Drive -> ClickUp -> intake -> compliance scan -> human QC). Persistent Telegram agent at `orgs/clean-green-marketing/agents/the-production-house/` (gitignored runtime state). New agent, enabled 2026-07-08.

## Status: settled core, conventions still forming - process playbooks deferred

Per the settled-only rule (a playbook documents a settled live process; pinning a moving target goes stale immediately):

**Settled and proven** (one complete production run, 2026-07-08, compliance-cleared):
- Persona onboarding: lock an AI influencer as a Higgsfield Soul ID (one Soul ID per persona, reused everywhere; a locked persona's face is never regenerated from scratch). First persona (Jennifer) complete: Soul + library + 3 image engines + override set.
- Image generation via the Higgsfield headless key/secret API - executable spec lives in the agent's `higgsfield` skill (verified-working scheme, corrected 2026-07-08).
- Concept-stage compliance posture: banned visual elements (packaging text, on-screen flower/bud, doctor/lab-coat characters, retail-shelf compositions, before/after framing) are flagged back to the brief owner, never generated around.

**Still forming** (playbooks land when these settle):
- Asset-landing conventions: the Drive folder structure for produced assets (an "AI Influencer Personas" organic-only separation is in flight) - load-bearing for any production playbook, so nothing is documented until it locks.
- Remaining personas (Dana, Vivian, Sarah, Rachel) - gated on Adam's direction.
- Voiceover lane (ElevenLabs) - wired as a tool, no evidenced production run yet.

No recurring process crons exist (heartbeat only, verified via `list-crons` 2026-07-09); production is brief/dispatch-driven.

**Trigger to expand this stub into process playbooks:** Drive asset-landing conventions locked + a second persona run confirming the onboarding process is stable. Per the DoD standing rule, the-production-house flags the-sop-keeper (via the-orchestrator) when that lands.
