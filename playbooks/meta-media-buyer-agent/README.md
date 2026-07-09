---
type: index
agent: meta-media-buyer-agent
status: active
date: 2026-07-05
---

# The Meta Media Buyer Agent - Playbooks (cross-link)

Runs the sheet-to-AdManage launch lane of the Meta ads pipeline in the live cortextOS fleet: manual-trigger only, draft-only, human-gated - Adam publishes every draft inside AdManage. Persistent Telegram agent at `orgs/clean-green-marketing/agents/meta-media-buyer-agent/` in the cortextos repo (gitignored runtime state); this folder is its playbook home in the cortextos `playbooks/` tree.

## Its playbooks live under meta-ads-agent

Adam's call (2026-07-05): the launch playbooks sit physically in the meta-ads-agent folder so the whole pipeline browses end-to-end in one place. This agent is their **executing owner** - the SOPs it runs are:

- [Launch Draft (04)](../meta-ads-agent/04-launch-draft.md) - launch-ready sheet rows -> AdManage drafts, `create_draft` only, never publish
- [Ad-Set Batch (05)](../meta-ads-agent/05-adset-batch.md) - ~10-ad bundles into one broad ad set, draft-only

Full pipeline context: [brain: agents/meta-ads-agent/README.md (the pipeline conductor doc)](https://github.com/CLEAN-APPS-DEV/clean-green-marketing-brain/blob/main/agents/meta-ads-agent/README.md), and the local playbook index at [../meta-ads-agent/README.md](../meta-ads-agent/README.md).

## Standing constraints

- Manual-trigger only - no cron drives launches.
- Draft-only hard gates on every path; no agent ever edits live in-Meta ads (fleet rule). Per-run machine proof = the DONE-WHEN gates in the executing playbooks ([04](../meta-ads-agent/04-launch-draft.md) step 6: draft re-fetch + ad-set state).
- The sheet column-ownership protocol vs. meta-ads-agent (who writes which columns, no concurrent writes) is documented in the agent's working files, pending promotion to a shared ratified doc (fleet-playbook migration plan step 4).
- col-B verdicts are never trusted from the cell on rebuilt/re-superseded cards - re-scan-on-touch before any launch-gate read. The authoritative rule (verbatim, mc-owned) lives in [../meta-compliance-agent/scan-and-verdict.md](../meta-compliance-agent/scan-and-verdict.md), col-B verdict freshness section.
