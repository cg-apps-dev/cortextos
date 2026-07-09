---
type: playbook
agent: fleet
process: switch-agent-account
executing_owner: the-orchestrator
status: draft
date: 2026-07-09
tags: [playbook, fleet, auth, bearer, setup-token, migration]
---

# Switch an Agent's Claude Account (bearer/setup-token)

> **DRAFT SKELETON** (Adam commission, 2026-07-09): structure + gates seeded from the two prior live moves; the orchestrator's next live migration (5 agents -> a new account) completes the [LIVE-RUN] placeholders. The one-command script (dev pair) wraps this SOP once it is proven; until then this SOP is executed by hand, gate by gate.

Move an agent's Claude runtime from one Max account to another with 100% accuracy: flip the token, flip the attribution, prove the agent is alive on the new account, and prove nothing else broke. Executing owner: the-orchestrator (account moves are orchestrator-coordinated fleet ops, never per-agent self-serve).

Canonical technical spec: the `agent-auth` skill (`.claude/skills/agent-auth/SKILL.md` in each agent dir, org-shared via `list-skills`) - auth modes, cred types, mint procedure, troubleshooting. The executable step-2 runbook lives in claude-dev-agent's local staging specs (`RUNBOOK-step2-setup-token-migration.md` - local-only artifact, named not linked). This playbook is the readable fleet SOP; those stay the specs.

## Scope (v1)

- **In**: agents running on bearer setup-tokens (`.env` `CLAUDE_CODE_OAUTH_TOKEN`) - the fleet rule mode.
- **Out**: login/keychain-mode agents (different procedure, keychain health checks first - see the agent-auth skill §4 "MIGRATION PROCEDURE (login/keychain -> bearer)" and §6 "TROUBLESHOOTING"). Do NOT apply this SOP to them.

## The three credentials (confusing these is the #1 procedure error)

- **Setup-token** (`sk-ant-oat01`, minted `claude setup-token` AS the account): RUNS the agent. ~1 year, self-contained.
- **Usage/PKCE credential** (`oauth/accounts.json`): reads the usage API only. Does NOT run an agent; a setup-token gets 403 on the usage API.
- **Stored/reused access_token**: dead for runtime. Only a FRESH setup-token minted as the target account works.

## Preconditions (all must hold before touching anything)

1. **No auth wobble in progress** anywhere in the fleet - never move an agent during an active auth incident.
2. **Fresh setup-token minted AS the target account** (HUMAN GATE - Adam; incognito/clean browser signed in as that account). DONE-WHEN: token string received via secret-safe channel (never echoed to chat/logs) AND its fingerprint is recorded with the METHOD STATED - bare-value sha256, first 8 hex (`printf '%s' "$TOKEN" | shasum -a 256`-class, never `echo` piped: the trailing-newline variant false-alarms as a different token).
3. **One agent at a time, verify each before the next.** A batch move is N sequential single moves.
4. **Fleet gating snapshot taken** ([LIVE-RUN: exact command + fields]) - account rebalances can churn global gating and wedge UNMOVED agents; the pre-snapshot is what makes that visible.

## Per-agent sequence

1. **Baseline read** (fresh, not cached): `cortextos bus list-agent-accounts` attribution for the agent + its current heartbeat + PM2/daemon state. DONE-WHEN: baseline recorded in the run log.
2. **Flip BOTH halves together** - a half-flip mislabels attribution:
   - `.env`: `CLAUDE_CODE_OAUTH_TOKEN=<new setup-token>` - exactly ONE active token line (strip stale/commented/placeholder lines), file mode 600.
   - `config.json`: `usage_account` = target billing-account name (the setup-token will not token-match `accounts.json`; this override is what attributes usage correctly).
   - DONE-WHEN: both files re-read and grep-verified to name the target (token fingerprint matches the minted one, bare-method; `usage_account` string equals the target account name).
3. **Restart = `stop` -> wait 60s -> `start`** - never a plain restart (daemon dedup / orphan-poller race). A "deduped - already running" on start can mean the first start already succeeded: check `cortextos status` for running + fresh uptime before retrying. DONE-WHEN: old process confirmed gone before `start`, agent shows running with fresh uptime after.
4. **Post-boot verification, all four fresh** (the daemon re-reads `.env` even on `--continue`, so history survives):
   - bearer env present in the live process ([LIVE-RUN: exact PID-env check]),
   - `list-agent-accounts` attributes the agent to the target account,
   - a fresh heartbeat lands,
   - one real inference round-trip (e.g. a bus message the agent answers).
   - DONE-WHEN: all four observed; any miss = stop, do not proceed to the next agent.
5. **Post-migration functional sweep** of every lane the runtime change touches (standing-rules registry: "migration silently drops a side path"). Bearer specifics: the claude.ai connector bridge DIES under bearer - any Composio-bridge-dependent lane must already be on its gog/REST replacement; sweep and prove each touched lane executes, not just that the agent boots. DONE-WHEN: [LIVE-RUN: per-lane checklist from the 5-agent move].
6. **Only then the next agent.** Transient burst-429s when several agents land on one account and boot close together are a concurrency throttle, not a cap and not a bad token - stagger and wait, never re-mint for this.

## Rollback

Keep the OLD token line (commented, clearly marked) until step 4 passes; revert = flip both halves back + stop-wait-start + the same four-point verification against the OLD account. [LIVE-RUN: confirm the comment-marker convention used.]

## Fleet-level watch during a wave

- Re-read the gating snapshot after each agent: unmoved agents wedged by global gating churn get per-agent `usage_account` overrides ([LIVE-RUN: observed?]).
- Usage monitoring on the target account: bearer runtimes read via the sampler layer; expect the moved agents' burn to appear under the target within [LIVE-RUN: observed lag].
- Multiple agents CAN share one account's setup-token (they then share that account's 5h/7d caps) - deliberate concentration is a capacity decision, take it knowingly.

## The one command (pending)

The dev-pair script wraps steps 1-5 for a single agent (`[LIVE-RUN/BUILD: name + invocation]`), with each DONE-WHEN above as a hard in-script assert - the SOP is the spec, the script is the enforcement. Until it ships, this SOP is the procedure.

## Related

- [standing-rules.md](standing-rules.md) - migration-drops-a-side-path class (the sweep in step 5), fingerprint-method class (the bare-value standard)
- [zero-model-monitors.md](zero-model-monitors.md) - the usage/monitor layer that watches the accounts
- [README.md](README.md) - fleet playbook index
