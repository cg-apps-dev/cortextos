# Migration note - meta-ads-agent relocated here

This folder is the meta-ads-agent's canonical home, relocated from the Clean Green marketing brain team repo (`CLEAN-APPS-DEV/clean-green-marketing-brain`, `agents/meta-ads-agent/`) into this private cortextOS repo on 2026-07-07 per Adam's directive: the meta-ads-agent is cortextOS infrastructure and belongs in the private infra repo, not the shared team marketing brain.

Files were moved byte-identical (no content changes in this step).

## Related and pending (as of the relocation)

- **meta-compliance-agent stays in the brain** (its M-1..M-25 rules are shared team marketing content). Cross-references between the two agents are being reconciled to the new locations.
- **Live-read repoint (pending, coordinated):** the live meta-intake runner fetches `skills/clickup-intake/SKILL.md` from the brain at runtime; that read is being repointed to this new home before the brain copy is removed, so the ad pipeline never breaks.
- **Brain removal (pending):** the original `agents/meta-ads-agent/` folder is removed from the brain via a reviewed PR only after the live-read repoint and the ~16 brain-internal reference updates are verified.

Maintained by the-sop-keeper. Structural changes land via review (the-orchestrator), never unilateral.
