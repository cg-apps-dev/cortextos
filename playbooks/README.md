---
type: index
scope: fleet
status: active
date: 2026-07-05
---

# Fleet Playbooks

Every process any agent follows, written as a plain-English playbook: easy to read, follow, and update, by a human or an agent. One folder per agent, one playbook per process (Adam directive, 2026-07-05). Kept continuously current: updating the affected playbook is part of the definition of done for any workflow change - the [fleet standing rule](fleet/standing-rules.md) that keeps this tree trustworthy.

Playbooks distill; they do not replace. The technical spec an agent executes stays in its SKILL.md (linked from each playbook); domain rules agents read live (e.g. the Meta M-code compliance rules in the brain repo) are linked, never copied.

Maintained by the-sop-keeper. Changes land via a local branch reviewed by the-orchestrator - never direct edits to main.

## Agents

| Folder | Playbooks | Covers |
|---|---|---|
| [meta-ads-agent/](meta-ads-agent/) | 8 | Meta ads upload-to-launch pipeline: ClickUp intake, sheet posting, ad copy, launch drafts, ad-set batching, launch tracking, upkeep, compliance scan |
| [meta-media-buyer-agent/](meta-media-buyer-agent/) | cross-link | Executing owner of the launch-draft, ad-set-batch and launch-tracking playbooks, which live under meta-ads-agent for pipeline browsability |
| [the-ad-strategist/](the-ad-strategist/) | 1 | Weekly what-is-working ad-intelligence report (nCAC iterate-ranker, pattern extraction, task list to the-team-lead) |
| [the-analyst/](the-analyst/) | 5 | Daily digest, throughput snapshot, theta-wave cycle, fleet health monitoring, nightly maintenance |
| [the-orchestrator/](the-orchestrator/) | 9 | Daily/weekly review cadence, goal lifecycle, approvals + human tasks, fleet optimization, account onboarding + agent migration, merge review + backup push |
| [the-team-lead/](the-team-lead/) | 2 | Sunday per-person retrospective + Monday forward-look for the human marketing team |
| [security-agent/](security-agent/) | 4 | Security safety-net sweep, bi-weekly threat-intel research, per-heartbeat usage watch, injection FP-triage/baseline loop |
| [cro-agent/](cro-agent/) | 1 | Weekly CRO opportunities report |
| [claude-dev-agent/](claude-dev-agent/) | 2 | Dev-pairing contract (plan/review half) + daily upstream check |
| [codex-dev-agent/](codex-dev-agent/) | 1 | Implementation-partner flow (the execution half of the dev pair) |
| [meta-compliance-agent/](meta-compliance-agent/) | 3 | Scan-and-verdict process, M-code rules ownership, LP/advertorial review (agent files live in the brain; process documented here) |
| [the-axon-agent/](the-axon-agent/) | 2 | Axon / AppLovin intake (all-boards creative detection -> Axon Ads Upload Sheet, fork-invert of the Meta engine) + phase-1 creative_set-grain analytics feed; phase-2 NC attribution staged behind a reconciliation gate |
| [the-production-house/](the-production-house/) | stub | Creative-asset production engine (Higgsfield Soul personas, image/video/VO from briefs, asset-only mandate). Coverage stub: settled core noted, process playbooks deferred until asset-landing conventions lock |
| [fleet/](fleet/) | 3 + rules | Cross-agent processes owned by no single agent: the zero-model launchd monitor layer + the RTK post-bounce engagement sweep (manual hook-verification method). Also holds [fleet/standing-rules.md](fleet/standing-rules.md), the home for cross-agent standing rules |

The playbook system now covers the full active fleet.

## How to read a playbook (the labels)

- **Folder = the agent** whose process it is. `fleet/` holds cross-agent processes owned by no single agent.
- **One file = one process.** Numbered filenames (`01-`, `02-`, ...) mean the folder is a PIPELINE and the numbers are its stage order; unnumbered filenames are independent processes.
- **Frontmatter fields** at the top of each playbook:
  - `agent` - whose folder it lives in.
  - `executing_owner` - set only when a DIFFERENT agent actually runs the process (e.g. the launch playbooks live under meta-ads-agent for browsability but meta-media-buyer-agent executes them).
  - `pipeline_stage` - maps a numbered playbook back to its pipeline stage.
  - `status` / `date` - active vs superseded, and when last verified against the live system.
- **Every folder's README** is that agent's index: each playbook, what it covers, when it runs, and its autonomy level (autonomous vs human-gated).
- **"FLAG" notes** inside a playbook mark a reference that cannot cleanly resolve to a tracked file (e.g. a script that exists only in an agent's untracked runtime directory) - named on purpose, not linked to nowhere.
- **Transient reminder crons are not playbooked**: a self-terminating reminder cron (removes itself on task-done/STOP) is a reminder, not a process - classify process-vs-reminder before flagging a cron as a coverage gap in any drift audit.

## File-type conventions (fleet-wide)

| Kind | Naming | Freshness rule |
|---|---|---|
| Playbook | `playbooks/<agent>/<process>.md` (`NN-` prefix for pipeline stages) | Always-current - updated with the workflow it describes (part of the change's Definition of Done) |
| Standing rules | `playbooks/fleet/standing-rules.md` | Always-current - cross-agent hard rules (not per-agent guardrails); each rule titled + dated |
| Runbook | `RUNBOOK-*.md` (in agent workspaces) | Point-in-time execution procedure; allowed to age |
| Spec | `SPEC-*.md` | Design-before-build; allowed to age |
| Reference/findings | `REF-*.md` / `FINDINGS-*.md` | Standing facts; dated |
