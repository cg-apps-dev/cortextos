---
type: playbook
agent: fleet
process: switch-agent-account
executing_owner: the-orchestrator
status: active
date: 2026-07-09
tags: [playbook, fleet, auth, bearer, setup-token, migration]
---

# Switch an Agent's Claude Account (bearer/setup-token)

Move an agent's Claude runtime from one Max account to another with 100% accuracy: flip the token, flip the attribution, prove the agent is alive on the new account, and prove nothing else broke. Executing owner: the-orchestrator (account moves are orchestrator-coordinated fleet ops, never per-agent self-serve).

**Proven live 2026-07-09** (Adam commission): 5 agents migrated sequentially in ~15 min, zero failures, zero rollbacks, zero dedup races - every parameter below comes from that run's notes. Canonical technical spec: the `agent-auth` skill (`.claude/skills/agent-auth/SKILL.md` in each agent dir, org-shared via `list-skills`). The one-command tool spec is claude-dev-agent's `SPEC-switch-agent-account.md` (local staging spec, named not linked); its gates and these steps are reconciled 1:1.

## Scope (v1)

- **In**: agents running on bearer setup-tokens (`.env` `CLAUDE_CODE_OAUTH_TOKEN`) - the fleet rule mode.
- **Out**: login/keychain-mode agents (different procedure, keychain health checks first - see the agent-auth skill §4 "MIGRATION PROCEDURE (login/keychain -> bearer)" and §6 "TROUBLESHOOTING"). Do NOT apply this SOP to them.

## The three credentials (confusing these is the #1 procedure error)

- **Setup-token** (`sk-ant-oat01`, minted `claude setup-token` AS the account): RUNS the agent. ~1 year, self-contained.
- **Usage/PKCE credential** (`oauth/accounts.json`): reads the usage API only. Does NOT run an agent; a setup-token gets 403 on the usage API.
- **Stored/reused access_token**: dead for runtime. Only a fresh setup-token minted as the target account works.

## The token vault (canonical source)

Runtime setup-tokens live in the vault: `~/.cortextos/default/state/oauth/setup-tokens/<account>.token` (file 0600, dir 0700, out-of-repo, backup-excluded, leak-scan-allowlisted; validated by security-agent on creation, perms-hardening queued). The vault stores RUNTIME setup-tokens only - never usage/PKCE creds.

- **Ingest** (new mint, HUMAN GATE - Adam mints AS the target account in a clean browser context): deliver as a file -> fingerprint (bare method, below) -> write to vault -> SHRED the delivery file. Tokens last ~1yr; no routine re-minting.
- **Fingerprint standard**: bare-value sha256 (`printf '%s' | shasum -a 256`-class, never `echo` piped - the trailing newline yields a different hash for the same secret). State the method with every fingerprint you report.
- **Rollback source**: the vault RETAINS the prior account's token after a move - rollback never depends on scavenging an old `.env`.

## Preconditions (all must hold before touching anything)

1. **No auth wobble in progress** anywhere in the fleet - never move an agent during an active auth incident.
2. **Target token in the vault, fingerprint-asserted.** DONE-WHEN: the vault file's bare-method fingerprint matches the recorded expected fingerprint - asserted BEFORE every apply, not once per wave.
3. **One agent at a time, verify each before the next.** A batch move is N sequential single moves; stop on the first failure.
4. **Fleet baseline snapshot**: pool sampler read (`multi-account-usage.json`: all accounts, 5h/7d, ok-flags) + per-agent attribution via `cortextos bus list-agent-accounts`. DONE-WHEN: both captured in the run log.

## Per-agent sequence

1. **Baseline read** (fresh, not cached): the agent's `list-agent-accounts` attribution + current heartbeat + daemon/PM2 state. DONE-WHEN: baseline recorded in the run log.
2. **Flip BOTH halves together** - a half-flip mislabels attribution:
   - `.env`: `CLAUDE_CODE_OAUTH_TOKEN=<vault token>` - exactly ONE active token line (strip stale/commented/placeholder lines), file mode 600.
   - `config.json`: `usage_account` = target billing-account name (the setup-token will not token-match `accounts.json`; this override is what attributes usage correctly).
   - DONE-WHEN: both files re-read and verified to name the target (`.env` token fingerprint = vault fingerprint, bare method; `usage_account` string = target account name).
3. **Restart = `stop` -> wait 60s -> `start`** - never a plain restart (daemon dedup / orphan-poller race; zero races in 5 cycles at 60s, so 60s stands as the wait). A "deduped - already running" on start can mean the first start already succeeded: check `cortextos status` for running + fresh uptime before retrying. DONE-WHEN: old process confirmed gone before `start`, agent shows running with fresh uptime after.
4. **Post-boot verification** (boot-verify at +40s post-start; all four points, each read fresh):
   - **Bearer proof (strong)**: the live process runs THE target token. Proven method (5/5 at +40s on a FRESH process): PID via `cortextos status`, then `ps eww -p $PID | tr " " "\n" | grep "^CLAUDE_CODE_OAUTH_TOKEN=" | cut -d= -f2-` piped to bare sha256, first 12 hex === the vault fingerprint. RELIABILITY RULES (a same-day independent attempt got contradictory reads from this class of command minutes later): (a) run it AT FRESH BOOT, never as a late-session check; (b) always pair with a planted positive (a var known present, e.g. `CTX_AGENT_NAME`) and repeat the read once - an empty result with a failed plant is a DEAD SCAN, not a verdict, and the empty-input hash `e3b0c442...` offered as a "fingerprint" means nothing was read; (c) never let ad-hoc `ps` parsing be the SOLE evidence. Candidate replacement pending arbitration: an in-session self-probe (the agent hashes its OWN env var and reports the bare fingerprint via bus) - immune to `ps` quirks IF tool subshells carry the var; at least one agent's tool subshell does NOT (under test now), so do not adopt until arbitrated. Tool path: the hardened `hashLiveProcessToken` util, itself to be proven against the time-flakiness before it ships as a gate.
   - **Attribution**: `cortextos bus list-agent-accounts | grep <agent>` = target account. Read the LIVE resolver, not the snapshot file (the snapshot file lags; the live read was correct at +40s for all 5). Observed attribution lag: none.
   - **Heartbeat**: the agent self-reports within ~2 min - boot-clean, no 401/login prompt, inbox reachable, crons intact. Anchor freshness on the RESTART TIME, never wall-clock (a recent-but-pre-bounce heartbeat must not pass a hung agent).
   - **Inference probe**: the agent's own bus round-trip self-verification message IS the probe (agent-level - proves the agent runs inference, not merely that the token is valid). Tool path: a bus echo round-trip.
   - DONE-WHEN: all four observed; any miss = stop, do not proceed to the next agent.
5. **Post-migration functional sweep** of every lane the runtime change touches (standing-rules registry: "migration silently drops a side path"). Immediate half: boot/inbox/crons/inference (step 4's self-report). Lane-depth half: each of the agent's real lanes exercises on its next natural cycle - the agent flags anomalies rather than pre-declaring clean. Bearer specifics: the claude.ai connector bridge DIES under bearer - any Composio-bridge-dependent lane must already be on its gog/REST replacement. DONE-WHEN: immediate half self-reported; lane-depth flagged-on-anomaly on the next cycle of each lane.
6. **Only then the next agent.** Transient burst-429s when several agents land on one account and boot close together are a concurrency throttle, not a cap and not a bad token - stagger and wait, never re-mint for this.

## Rollback

Trigger: any step-4 point failing (or a step-2/3 failure). The vault retains the prior account's token (`<old-account>.token`) as the rollback source: re-apply it BOTH-halves (step 2), stop-wait-start (step 3), and run the same four-point verification (step 4) against the OLD account. A verify-fail must end in a KNOWN state - prior account, running - never an ambiguous half-flip. (Live run: 0 rollbacks needed. Tool path: snapshot-restore of the captured pre-state.)

## Fleet-level watch during a wave

- Re-read the pool sampler after each agent: account rebalances can churn global gating and wedge UNMOVED agents - per-agent `usage_account` overrides are the fix.
- The vacated account's 7d burn sheds at its weekly reset, not immediately - expected, not a leak.
- Multiple agents CAN share one account's setup-token (they then share that account's 5h/7d caps) - deliberate concentration is a capacity decision, take it knowingly.

## The one command (tool wrapper)

`cortextos switch-agent-account <agent> <target-account>` (+ `--all-from <source> <target>` batch = sequential, verify-each, stop-on-first-failure) wraps steps 1-4 + rollback with every DONE-WHEN above as a hard in-script assert - this SOP is the spec, the script is the enforcement. The tool's success state is **"auth flip verified; functional sweep pending"**, never "migration complete": the success path ends with a loud FUNCTIONAL SWEEP REQUIRED block pointing at step 5 and auto-queues a per-agent sweep task. Spec: claude-dev's `SPEC-switch-agent-account.md`; built by the dev pair; verify semantics identical to step 4.

## Related

- [standing-rules.md](standing-rules.md) - migration-drops-a-side-path class (step 5), fingerprint-method class (the bare-value standard), fresh+ok+impossible-value class (the dead-scan rules in step 4)
- [zero-model-monitors.md](zero-model-monitors.md) - the usage/monitor layer that watches the accounts
- [README.md](README.md) - fleet playbook index
