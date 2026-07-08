---
type: standing-rules
scope: fleet
status: active
date: 2026-07-08
tags: [fleet, standing-rules, governance]
---

# Fleet Standing Rules

The canonical home for cross-agent STANDING RULES - hard rules every agent follows, distinct from the per-agent playbooks (which document a single agent's process). A playbook says "here is how this process runs"; a standing rule says "here is a constraint that holds across the fleet, regardless of process." Rules live here, beside the processes they govern.

Each rule is titled, dated, and states the rule + why it exists. New rules land here as they are ratified. The fleet-wide non-negotiables that are structural to every agent (no em dashes; Pacific Time for human-facing times) live in each agent's `GUARDRAILS.md`; this file is for cross-agent operating rules that are not per-agent guardrails.

## Standing rule: playbook maintenance is part of Definition of Done

**Rule.** Updating the affected playbook is part of the definition of done for any workflow, cron, or skill change. A change is not "done" until the playbook that documents it is current - the code/config change and the playbook update land together, not as a follow-up.

**Why.** The playbook tree is only trustworthy if it is continuously current. A workflow that changes without its playbook updating silently turns the SOP into a stale claim - the exact failure mode the playbook system exists to prevent. Treating the doc update as optional or deferrable is how documentation rots; treating it as part of "done" is how it stays load-bearing. The-sop-keeper maintains the tree, but the trigger is any agent's change: flag the-sop-keeper (via the-orchestrator) on any workflow/cron/skill change so the playbook is updated via a reviewed branch, never a silent live edit.

**Applies to.** Every agent, every workflow/cron/skill change. See the fleet playbook index at [../README.md](../README.md).
