---
type: playbook
agent: claude-dev-agent
process: upstream-check
status: active
date: 2026-07-07
tags: [playbook, dev, upstream, git]
---

# Upstream Check

A daily read-only check for upstream framework updates, notify-only. Fires daily 7am PT (cron `upstream-check`).

## The rule

READ-ONLY, notify-only - do NOT apply. Report incoming commits to the orchestrator; never auto-merge. (Incoming-change estimates use merge-base diffs, not two-dot - two-dot overstates on divergence.)

## Triage discipline: "N commits behind" is a SHA-delta artifact

On a fork that did prior selective merges, ported content lands under NEW SHAs, so the original upstream SHAs still read as "incoming" - the raw behind-count overstates. The disconfirming instrument is **PR-ref presence**: extract `#NNNN` refs from local history since the merge-base (`git log <merge-base>..main | grep -oE '#[0-9]+'`) and compare against incoming refs; refs already local are already ported. Live-proven 2026-07-08: 175/186 "incoming" PR-refs were already local, collapsing a 246-commit headline to ~11 genuinely absent PRs. Caveat: non-PR incoming commits (merges, cron subtasks) are not ref-covered - spot-check those separately.

## Hand-off

Incoming commits reported to the-orchestrator, who decides whether/when to sync.
