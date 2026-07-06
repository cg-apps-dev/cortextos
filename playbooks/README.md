# Fleet Playbooks

Every process any agent follows, written as a plain-English playbook: easy to read, follow, and update, by a human or an agent. One folder per agent, one playbook per process (Adam directive, 2026-07-05). Kept continuously current - updating the affected playbook is part of the definition of done for any workflow change.

Playbooks distill; they do not replace. The technical spec an agent executes stays in its SKILL.md (linked from each playbook); domain rules agents read live (e.g. the Meta M-code compliance rules in the brain repo) are linked, never copied.

Maintained by the-sop-keeper. Changes land via a local branch reviewed by the-orchestrator - never direct edits to main.

## Agents

| Agent | Playbooks | Covers |
|---|---|---|
| [meta-ads-agent/](meta-ads-agent/) | 8 | Meta ads upload-to-launch pipeline: ClickUp intake, sheet posting, ad copy, launch drafts, ad-set batching, launch tracking, upkeep, compliance scan |
| [meta-media-buyer-agent/](meta-media-buyer-agent/) | (cross-link) | Executing owner of the launch-draft + ad-set-batch playbooks, which live under meta-ads-agent for pipeline browsability |

More agents land here per the fleet-playbook migration plan (next: the-ad-strategist, the-analyst).
