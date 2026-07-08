---
type: playbook
agent: security-agent
process: threat-intel
status: active
date: 2026-07-07
tags: [playbook, security, threat-intel, research]
---

# Threat-Intel Research Routine

A recurring read-only research cycle that must translate new attack techniques into concrete scanner-rule changes, or be discarded as noise. Fires every 2 weeks (cron `threat-intel`; the skill is titled "weekly" but the live interval is 2w). Defensive, our-own-systems focus. Derived from `.claude/skills/threat-intel/SKILL.md`.

## The governing principle

Research that does not change a detection or a defense is just noise. The deliverable is an updated rule, not a summary.

## The sequence

1. **Create a task** for the cycle, mark in progress, write WORKING ON to daily memory.
2. **Research (read-only web)** the latest in: prompt-injection/jailbreak techniques (direct + indirect via docs an agent reads live); supply-chain attacks (malicious npm packages, typosquatting, post-install scripts, poisoned skills/MCP servers); secret-leak patterns + new credential formats; and CVEs touching OUR specific stack (Node.js and the connectors actually used - Triple Whale, ClickUp, Slack, Google, Higgsfield, Meta/AdManage).
3. **Triage to actionable-for-us only.** Most public threat news won't touch us; keep only what maps to a concrete defense or a real exposure in our setup.
4. **Fold concrete detections into the rules** - the injection/leak scanner heuristics + any gitleaks custom rules. Note what changed. This is the deliverable.
5. **KB-ingest the cycle's findings** so they're searchable.
6. **Surface to Adam only if genuinely urgent/actionable** - brief chat ping + a task assigned to Adam with clear steps. Otherwise stay quiet; just update rules and log.
7. **Complete the task** with a result summary, log a task_completed event, write COMPLETED to daily memory.

## Hard rules

- Read-only research + own rule files only. No external actions, no live-config changes, no secret rotation without Adam's explicit ok.
- Signal only - never dump raw threat-feed noise into chat.
