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

**Proven live 2026-07-09** (Adam commission): 5 agents migrated sequentially in ~15 min, zero failures, zero rollbacks, zero dedup races - every parameter below comes from that run's notes. Canonical technical spec: the `agent-auth` skill (`.claude/skills/agent-auth/SKILL.md` in each agent dir, org-shared via `list-skills`).

**PRIMARY PATH: the shipped one-command tool** - `cortextos switch-agent-account` (shipped 2026-07-09, merge `4576c07`; usage in "The one command" below). It enforces every gate in this SOP as a hard in-script assert. The per-agent sequence below is the normative spec the tool implements AND the manual fallback - execute it by hand only when the tool or daemon is unavailable, or when auditing a tool run.

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
   - **Bearer proof (LAYERED - no single instrument may pass or fail it alone)**: the live process runs THE target token. Four layers, all required: (i) `.env` re-read: token fingerprint = vault fingerprint (bare method) - proves the RIGHT token is configured; (ii) **process start time AFTER the `.env` flip time** (`ps -o lstart -p $PID` vs the file's mtime - both reads proven reliable) - closes the file-vs-process gap, since a process spawned pre-flip runs the OLD token no matter what the file now says; (iii) attribution (below); (iv) inference probe (below). CORROBORATOR (strong when readable, never sole evidence, never a rollback trigger): the process-env read - `ps eww -p $PID | tr " " "\n" | grep "^CLAUDE_CODE_OAUTH_TOKEN=" | cut -d= -f2-` piped to bare sha256, first 12 hex === vault fingerprint (proven 5/5 at +40s on fresh processes, run from the operator session). `ps` READ RULES: pair with a planted positive (a var known present, e.g. `CTX_AGENT_NAME`) and repeat once; an EMPTY read = INDETERMINATE (try another layer, never rollback on it) - the empty-input hash `e3b0c442...` offered as a "fingerprint" is THE tell that nothing was read; reads are caller/session- and time-sensitive (a cross-session read of the same PID can return nothing minutes after an own-session read worked). The in-session self-probe (agent hashes its OWN env var from a tool shell) is STRUCTURALLY DEAD - arbitrated 2026-07-09 by security-agent: the harness scrubs the runtime token from tool shells fleet-wide (two bearer agents both read count=0 in-shell while process-env reads proved bearer), so it reads 0 for every bearer agent and proves nothing. Never use it. Tool path: the hardened `hashLiveProcessToken` util as the corroborator layer, proven against these caller/time quirks first, with empty-read = indeterminate semantics.
   - **Attribution**: `cortextos bus list-agent-accounts | grep <agent>` = target account. Read the LIVE resolver, not the snapshot file (the snapshot file lags; the live read was correct at +40s for all 5). Observed attribution lag: none.
   - **Heartbeat**: the agent self-reports within ~2 min - boot-clean, no 401/login prompt, inbox reachable, crons intact. Anchor freshness on the RESTART TIME, never wall-clock (a recent-but-pre-bounce heartbeat must not pass a hung agent).
   - **Inference probe**: the agent's own bus round-trip self-verification message IS the probe (agent-level - proves the agent runs inference, not merely that the token is valid). Tool path: a bus echo round-trip.
   - DONE-WHEN: all four observed; any miss = stop, do not proceed to the next agent.
5. **Post-migration functional sweep** of every lane the runtime change touches (standing-rules registry: "migration silently drops a side path"). Immediate half: boot/inbox/crons/inference (step 4's self-report). Lane-depth half: each of the agent's real lanes exercises on its next natural cycle - the agent flags anomalies rather than pre-declaring clean. Bearer specifics: the claude.ai connector bridge DIES under bearer - and a bridge call under bearer HANGS the session (no error, no fallback), so this audit is PRE-FLIP, not post: grep the agent's full EXECUTION SURFACE for bridge-tool calls by CONTRACT CLASS, never a hand-enumerated sample (security tightening 2026-07-09: a sample under-covers - a Composio DRIVE/SLACK action slips a grep that only lists GOOGLESHEETS_). FIVE detection classes, all required: (a) the claude.ai bridge prefix-class `mcp__claude_ai_` (catches every bridge connector generically), (b) the Composio entry points `COMPOSIO_MULTI_EXECUTE_TOOL` (uppercase - the fleet's actual entry point) and `mcp__composio`, (c) the Composio app-action shape (`[A-Z]+_`-prefixed app actions - GOOGLESHEETS_/GOOGLEDRIVE_/SLACK_/GMAIL_/...), (d) **PROSE DIRECTIVES naming a bridge tool in natural language** (case-insensitive: `composio`, `claude.ai bridge`, `claude ai connector`, `bridge MCP`) - the token-class grep (a)-(c) reads 0 on an instruction like "use the Composio Google Sheets MCP to read candidate rows," but a prose directive telling the session to use a dead tool is EXACTLY as lethal as a literal call-site: it makes the session place the hanging call, (e) **LOWERCASE snake_case connector-ACTION names** (`clickup_*`/`slack_*`/`gmail_*`/`notion_*`/etc - e.g. `clickup_get_task`, `clickup_filter_tasks`) - no capital letters, no vendor keyword, so this class matches NEITHER the uppercase token classes (a)-(c) NOR the prose-keyword class (d), yet hangs under bearer identically (2026-07-24 amendment, mmb+meta-ads: a token-only sweep scored `agents/meta-ads-agent/skills/{adset-batch,launch,analysis}/SKILL.md` clean, missing 3 armed prose-trap files - one was mmb's OWN live-read batching skill, on its real next-run path; the same-day follow-up surfaced class (e) as a distinct blind spot neither prior class covers). Surface = local `.claude/skills/` AND every remote skill the agent live-reads at run time (its IDENTITY/MEMORY/cron prompts name them; a local grep cannot see those - and the enumeration is only as complete as the prompt naming, so a transitively-referenced remote skill can hide: the live-verified DONE-WHEN is the backstop). **REMEDIATION is PER INSTRUCTION SITE, not per file** (2026-07-24 amendment, meta-ads: a top-of-file DO-NOT-USE banner is NOT sufficient - meta-ads found ~9 numbered-step lines still instructing Composio under a clean top-banner, because execution jumps straight to the STEPS and never re-reads the banner). Any hit migrates to its own-cred replacement (gog/REST) BEFORE the flip, with the DO-NOT-USE warning written AT THAT SITE, not only at the top of the file. DONE-WHEN: every class-(a)-(e) hit is remediated inline (own-cred tool + a DO-NOT-USE warning at that exact site), or the class-grep across all five classes reads 0 hits - a file-level "clean" declaration with an unremediated step further down does not satisfy this. **Any sweep completed before 2026-07-24 checked classes (a)-(c) only and/or remediated at the file/banner level rather than per-site - it must be RE-RUN covering all five classes with per-site remediation before its clean-PASS is trusted.** (Live proof 2026-07-09: three hung mmb sessions - the Composio dependency sat in a brain-main live-read skill, invisible to any local-file audit.) DONE-WHEN: immediate half self-reported; lane-depth flagged-on-anomaly on the next cycle of each lane.
6. **Only then the next agent.** Transient burst-429s when several agents land on one account and boot close together are a concurrency throttle, not a cap and not a bad token - stagger and wait, never re-mint for this.

## Rollback

Trigger: any step-4 point failing (or a step-2/3 failure). The vault retains the prior account's token (`<old-account>.token`) as the rollback source: re-apply it BOTH-halves (step 2), stop-wait-start (step 3), and run the same four-point verification (step 4) against the OLD account. A verify-fail must end in a KNOWN state - prior account, running - never an ambiguous half-flip. (Live run: 0 rollbacks needed. Tool path: snapshot-restore of the captured pre-state.)

## Fleet-level watch during a wave

- Re-read the pool sampler after each agent: account rebalances can churn global gating and wedge UNMOVED agents - per-agent `usage_account` overrides are the fix.
- The vacated account's 7d burn sheds at its weekly reset, not immediately - expected, not a leak.
- Multiple agents CAN share one account's setup-token (they then share that account's 5h/7d caps) - deliberate concentration is a capacity decision, take it knowingly.

## The one command (primary path - SHIPPED 2026-07-09, main merge `4576c07`)

```
cortextos switch-agent-account <agent> <target-account> [--dry-run] [--token-file <path>] [--json] [--instance <id>]
cortextos switch-agent-account --all-from <source-account> <target-account>   # batch = sequential, verify-each, stop-on-first-failure
```

- Wraps the preconditions (incl. the auth-wobble gate) + steps 1-4 + rollback, with every DONE-WHEN above as a hard in-script assert - this SOP is the spec, the script is the enforcement. Live-run params are baked in: 60s stop-wait, +40s boot-verify, 2-min heartbeat window and inference-probe timeout; a start response queued behind an in-flight stop is accepted and verified after (the dedup race, handled).
- `--dry-run` = preflight only: no flip, no restart, no sweep task queued; with `--token-file` it validates the delivery without mutating the vault.
- `--token-file <path>` = ingest a delivered mint into the vault before switching: format-validated (`sk-ant-oat01...`), 0600 enforced, delivery file shredded only after a successful vault write; a preflight failure leaves the vault untouched.
- Verify = the step-4 layered scheme verbatim: bare-method fingerprint, process-start-time-after-flip, live attribution, restart-anchored heartbeat, bus inference probe. The process-env corroborator is `hashLiveProcessToken` with empty-read = INDETERMINATE semantics: a restricted `ps` read alone can never fail the switch, but a real runtime-token mismatch rolls back.
- Success state is **"auth flip verified; functional sweep pending"**, never "migration complete": the success path prints a loud FUNCTIONAL SWEEP REQUIRED block pointing at step 5 and auto-queues a per-agent sweep task (`[FUNCTIONAL SWEEP] <agent> after switch to <account>`, project `functional-sweeps`, assigned to the agent, with a bus ping).
- Rollback on any gate failure: snapshot-restore of BOTH halves, stop-wait-start, the same four-point verify against the OLD account; a rollback that itself fails verification exits loud with the failing gate named - never a silent half-flip. No token values ever appear in output or errors (fingerprints only).
- Source: `src/cli/switch-agent-account.ts` + `src/bus/switch-agent-account.ts`; acceptance tests: `tests/unit/bus/switch-agent-account.test.ts` (preflight gates, layered verify incl. indeterminate ps, rollback paths, batch stop-on-first-failure, token-hygiene) and `tests/unit/utils/live-token-hash.test.ts` (bare-fingerprint method pin: newline hashes differently). Spec history: claude-dev's `SPEC-switch-agent-account.md` (local staging spec, named not linked), gates reconciled 1:1 with these steps.

## Related

- [standing-rules.md](standing-rules.md) - migration-drops-a-side-path class (step 5), fingerprint-method class (the bare-value standard), fresh+ok+impossible-value class (the dead-scan rules in step 4); the 2026-07-10/11 fleet auth cascade's 3 root-cause classes (shared-claude-home cascade, truncated-token, tier-scoped-429-misread) - the incident this SOP's per-agent isolation and exact-108 checks exist to prevent recurring
- [zero-model-monitors.md](zero-model-monitors.md) - the usage/monitor layer that watches the accounts
- [README.md](README.md) - fleet playbook index
