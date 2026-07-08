---
type: playbook
agent: security-agent
process: daily-security-sweep
status: active
date: 2026-07-07
tags: [playbook, security, scanning, secrets, injection]
---

# Daily Security Sweep

A model-driven safety-net sweep over the fleet's secret and injection exposure. Fires weekly, Monday 5am PT (cron `daily-security-sweep` - the name says "daily" but the live schedule is weekly; it is the interim/safety-net layer over the zero-model launchd scanners that do the heavy lifting every 12h). Derived from the cron prompt + the agent's `tools/fleet-scan.sh`, `tools/daily-backup.sh`, and IDENTITY.md.

## Mandate

Defensive security and data-safety for Clean Green's OWN systems only (cortextOS + marketing stack). Internal/authorized targets, never external. Containment before deletion: quarantine suspicious files (non-destructive), then ask before removing. Brief, immediate, emoji-free Adam pings only on confirmed findings.

## The sequence

1. **Run the zero-model fleet scan**: `tools/fleet-scan.sh --quiet` - gitleaks (git history + directory mode over orgs/ and state/) + injection-scan.js over orgs/ and framework src/. It dedups against its own state file and owns its Telegram alerting, so only NEW findings alert.
2. **Review the scan log** to confirm the latest results line.
3. **Check deletion-risk** separately on critical files/repos/sheets.
4. **Triage each new finding**: real secret/injection (alert Adam) vs. a new false-positive needing baseline suppression (add + commit the suppression). Brief-ping Adam ONLY on confirmed real findings; stay quiet otherwise.

## The layers behind this sweep (context)

- **fleet-scan.sh** also runs zero-model on launchd every 12h ([../fleet/zero-model-monitors.md](../fleet/zero-model-monitors.md)); the contained `.env.bak` mute is fail-closed (any miss stays a full alert, so a genuinely leaked backup still fires).
- **daily-backup.sh** runs purely on launchd (not in crons.json): pushes the framework repo to the backup remote + backs up agent state, self-alerting on any failure in three categories (secret-guard-block, code-push-conflict, agent-state-fail) - built so a silent backup failure is impossible.
- **Injection defense** is hook-first by Adam's choice (`injection-detection-rules.md` + `injection-hook-design.md`): suspicious content is quarantined non-destructively, the consuming action blocked, Adam brief-pinged - never auto-deleted. This weekly sweep is interim coverage under that hook.

## Hard rules

- Read/scan widely; never rotate a secret or delete a file without Adam's explicit approval (both irreversible).
- Redact secret/payload values from all logs and chat - emit redacted JSON (file/rule/severity/line), never raw values.
- A scan reporting constant zero is a dead-scan smell, not a clean-fleet signal - the dedup state and periodic positive-plant prove it still fires.
