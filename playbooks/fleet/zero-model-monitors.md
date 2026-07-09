---
type: playbook
agent: fleet (cross-agent; design owners noted per job)
process: zero-model-monitors
status: active
date: 2026-07-05
tags: [playbook, fleet, launchd, monitoring, zero-model]
---

# Zero-Model Monitor Layer (launchd)

A whole class of fleet monitoring runs with ZERO model invocation: pure self-alerting scripts scheduled by macOS launchd. Rationale: a daemon cron fire = a full agent wake (model turn + heavy cache read); these jobs need no reasoning, only a scheduled script that exits quietly on healthy and sends its own Telegram alert on failure.

## THE GOTCHA this playbook exists for

**These jobs are invisible to `cortextos bus list-crons` and the agent cron system entirely.** Anyone auditing "what monitoring runs" from crons alone will wrongly conclude backups, security scans, and usage monitoring are not running. The authoritative check is:

```bash
launchctl list | grep -iE 'cortextos|cleangreen'   # running jobs (exit code 0 = healthy last run)
ls ~/Library/LaunchAgents/com.cortextos.*.plist ~/Library/LaunchAgents/com.cleangreen.*.plist   # the definitions
```

## The live jobs (verified 2026-07-09 from the loaded plists)

| Job | Cadence | Runs | Design owner |
|---|---|---|---|
| check-all-usage | 5 min | `bus/check-all-usage-job.sh` - per-account usage reads for the monitoring stack | usage-monitoring stack (claude-dev-agent maintains) |
| refresh-usage | 2h | `cortextos bus refresh-usage` | usage-monitoring stack |
| usage-monitor | 2h | `bus/check-usage-api.sh --warn-7day 80 --warn-5h 90` - threshold alerts | the-analyst (designed) |
| usage-burn-sampler | 1h | analyst `scripts/usage-burn-sampler.sh` | the-analyst |
| dependency-health | 12h | `bus/check-dependency-health.sh` - probes Gemini/ClickUp/TW/AdManage/Composio | the-analyst |
| codex-auth-check | 30 min | `bus/check-dependency-health.sh --only codex_runtime_auth` - catches Codex runtime-token REVOCATION (401 signature + heartbeat staleness), which the expiry-only check is blind to | claude-dev-agent (built, live 2026-07-07); the-analyst (watch lane) |
| fleet-scan | 12h | security-agent `tools/fleet-scan.sh --quiet` - gitleaks + injection scan across agents | security-agent |
| daily-backup | daily 2:00am | security-agent `tools/daily-backup.sh` | security-agent |
| fleet-cost-snapshot | daily 4:55pm | orchestrator `scripts/fleet-token-snapshot.py` | the-orchestrator |
| ingest-meeting-notes | daily 6:00am | analyst `scripts/ingest-meeting-notes-launchd.sh` | the-analyst |
| meta-ads.ready-check | 15 min | meta-ads-agent `scripts/clickup-ready-check.sh` - zero-token ClickUp ready-card watcher; wakes the agent only when new ready cards exist (replaced the agent's 9am/1pm/5pm meta-poll crons) | meta-ads-agent |
| meta-ads.reconcile-completed | 12h | meta-ads-agent `scripts/reconcile-completed-check.sh` - completed-cards vs sheet reconciliation check | meta-ads-agent |
| meta-media-buyer.launch-tracker-watch | 15 min | mmb `scripts/launch-tracker-watch.sh` - launch-detection watcher stamping the tracker (the agent's daily 8am cron is the watcher-died safety net) | meta-media-buyer-agent |

The three `com.cleangreen.*` jobs are org-owned watchers on the same launchd layer; the full authoritative listing is `launchctl list | grep -iE 'cortextos|cleangreen'`.

## The contract every job follows

- **Quiet on success**: exit 0, no notification, no agent wake.
- **The script owns its own alerting**: threshold breach or failure sends Telegram directly, with dedup via a state file.
- **Constant-zero is a dead-scan smell**: a monitor that never fires is proven alive by planting a positive, not by trusting silence.

## Maintenance notes

- An in-daemon no-model runner also exists (a `command` field on a normal crons.json entry runs a script instead of waking the agent) - the fleet's monitors currently use host launchd, but new zero-model jobs can choose either mechanism; prefer the in-daemon path for anything that should deploy with the repo.
- launchd plists live outside the repo (`~/Library/LaunchAgents/`) - a machine rebuild must restore them; the design/rollback spec is the analyst's `workspace/spec-launchd-no-model-monitors.md` (local, untracked - flagged).
- Keychain-dependent jobs (usage monitoring) break when credential stores move (a Claude Code update once relocated OAuth creds and blinded the monitor) - a monitor failure there means "check the cred-store location," not "credentials lost."
