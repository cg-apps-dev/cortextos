# Contributing to cortextOS

## Development Setup

```bash
git clone https://github.com/grandamenium/cortextos.git
cd cortextos
npm install
npm run build
npm test
```

## Before Submitting Changes

1. `npm run build` - TypeScript must compile cleanly
2. `npm test` - all tests must pass
3. Match existing patterns in `src/` for new features
4. Add unit tests in `tests/` for any new code

> Run `npm test` from a clean shell or CI, NOT from inside a running cortextOS
> agent session. A live agent exports `CTX_*` env vars (`CTX_AGENT_DIR`, etc.)
> that otherwise leak into CLI-invoking tests and trip the CLI's sandbox-leak
> guard, causing ~33 spurious failures. The vitest setup
> (`tests/setup/scrub-ctx-env.ts`) scrubs `CTX_*` automatically so the suite
> stays green either way, but a clean shell remains the canonical run env.

## Project Structure

- `src/` - TypeScript source (bus, cli, daemon, hooks, types, utils)
- `bus/` - Shell wrapper scripts (delegate to `dist/cli.js bus`)
- `dashboard/` - Next.js 14 web dashboard
- `templates/` - Agent templates (agent, orchestrator, analyst)
- `community/` - Community skills and agent catalog
- `tests/` - Unit, integration, and E2E tests

## Code Style

- TypeScript strict mode
- No external runtime dependencies beyond what's in `package.json`
- File operations use atomic writes (see `src/utils/atomic.ts`)
- All bus operations go through `src/bus/` modules

## Native modules (better-sqlite3) - dual-Node ABI

- The dashboard runtime is PM2 on Node 25 from `/opt/homebrew/Cellar/node/25.9.0_1/bin`, ABI 141.
- Shell and test runs use Node 22, ABI 127.
- Rebuild `better-sqlite3` under the Node version that will load it. A binary compiled for one ABI will crash when loaded by the other.
- Deploy recipe: build the dashboard under Node 25 from `/opt/homebrew/Cellar/node/25.9.0_1/bin`, or dashboard restarts can fail with `NODE_MODULE_VERSION` errors.
- `dashboard/.nvmrc` contains `25` as dev convenience and intent only. PM2 does not read `.nvmrc`; the runtime fix is the generated PM2 env PATH pin from `cortextos ecosystem`.
- WARNING: `pm2 jlist` `node_version`, shell `node --version`, the npm parent process, and `scripts/check-native-abi.sh` without `--child` can all report the Node-22 parent, not the runtime that loads `better-sqlite3`.
- Canonical runtime verify: find the live `next-dev` or `next-server` child PID, then run `lsof -p <child_pid> | grep bin/node`. That child node is the dashboard runtime to verify, not the PM2 parent or shell.
- The authoritative ABI check is an instantiate test under that child node: `require("better-sqlite3")`, `new Database(":memory:")`, then a simple query. A bare require is not enough.
- Use `scripts/check-native-abi.sh --child` to lsof the live Next child and run the instantiate test under its node. Use `scripts/check-native-abi.sh --fix` only when you intentionally want to rebuild for the current shell node.
- 2026-06-13 incident note: treating the Node-22 parent as the dashboard runtime led to an ABI-127 rebuild that crashed the dashboard. The child process was Node 25.

## Dashboard cost data (cost_entries) - unique index is REQUIRED

- The dashboard SQLite DB lives OUTSIDE the repo, under the instance state dir: `~/.cortextos/<instance>/dashboard/cortextos-default.db` (e.g. `default`).
- `cost_entries` dedups ingestion via `INSERT OR IGNORE`, which is a NO-OP without a UNIQUE constraint. The required index is `idx_cost_entries_unique(agent,model,source_file,timestamp)`, created by `migrateCostEntriesUniqueIndex` in `dashboard/src/lib/db.ts` (guarded, idempotent, wired into `initializeSchema`).
- WITHOUT that index, every `syncCosts` re-inserts all rows -> millions of duplicate rows -> all cost aggregations (`getDailyCosts`/`getCostByModel`/`getCostByAgent`/fleet) SUM raw and inflate ~147x. Incident 2026-06-16: `cost_entries` reached 6.03M rows / $7.42M total before the dedup (true distinct ~$50.6K).
- Do NOT remove the migration call or recreate `cost_entries` via a bare schema reset without restoring the index. Codex token logs are CUMULATIVE-per-session (parser dedups to the last snapshot); Claude transcripts are per-turn/additive.

## Agent authentication - bearer setup-tokens (HARD RULE)

- Every persistent cortextOS agent authenticates via a FRESH per-account `claude setup-token` (a `sk-ant-oat01` OAuth token, minted `claude setup-token` AS that account) set as `CLAUDE_CODE_OAUTH_TOKEN` in the agent `.env` (bearer mode). This is a ~1-year self-contained token. **NEVER interactive-login/keychain for a persistent agent.** Full how-to + troubleshooting = the `agent-auth` skill (`community/skills/agent-auth/`); the org-level rule = `orgs/<org>/knowledge.md` (HARD RULE - AGENT AUTHENTICATION).
- ROOT CAUSE this prevents: Claude Code OAuth refresh bug #31095 - interactive `claude login` stores an 8-HOUR access token + a refresh token it NEVER uses, so any 24/7 login-mode agent breaks ~every 8h (in-session 401 AND at reboot). Re-login never fixes it (it never changes the MODE). The infra agents on bearer do NOT break - that is the proof.
- THREE credentials, NOT interchangeable: (1) RUNTIME token = the setup-token in `.env`, RUNS the agent; (2) USAGE/PKCE cred = in `oauth/accounts.json`, ONLY reads `/api/oauth/usage` (a setup-token gets 403 there); (3) a stored/cached access_token. A usage/PKCE or stale/reused token in `.env` will NOT run the agent ("dead for runtime"). `setup-token != usage-cred != access_token`.
- PRECEDENCE: `CLAUDE_CODE_OAUTH_TOKEN` in the process env (bearer) takes precedence over the keychain login AND silently KILLS the claude.ai MCP connector bridge. So the presence of that env var in a live agent's PID = "this agent is bearer / keychain-independent."
- CONNECTOR PIN: claude.ai-bridge connectors (AdManage / ClickUp / Slack-via-bridge / Sheets-via-bridge / Composio / Drive-MCP) ONLY work in login mode; bearer kills them. MIGRATE the connector to an own-credential API (Slack bot-token, Meta Marketing API, `gog` for Sheets/Drive, ClickUp REST, own-key stdio MCPs) FIRST, prove it, THEN switch the agent to bearer. No agent stays on login "for the connector" permanently.
- APPLY = FLIP BOTH HALVES together: `.env CLAUDE_CODE_OAUTH_TOKEN` (exactly ONE active line, strip stale/commented/placeholder token lines, `chmod 600`) AND `config.json usage_account` = the target billing account (the setup-token won't token-match `accounts.json`, so the override is what attributes the usage gate). Token + override move together or usage cross-account-mislabels.
- MIGRATE one agent at a time + VERIFY each before the next: boot-clean (no `/login`/401), inference works, attribution correct (`list-agent-accounts`), tools work; DEFINITIVE bearer-proof (leak-safe, names only) = `ps eww -p <pid> | tr ' ' '\n' | grep -oE '^CLAUDE_CODE_OAUTH_TOKEN='` (present = bearer; login agents have none). Validation-first on a low-stakes agent.
- RESTART = `stop` -> wait 60s -> `start`, NOT a plain `cortextos restart` (it trips the daemon dedup/orphan-poller race; a "deduped - already in registry" can mean the start ALREADY succeeded - check `cortextos status` for running+fresh-uptime). The daemon re-reads `.env` even when it resumes claude via `--continue`.
- TOKEN LEAK-CLASS: tokens live ONLY in `.env` (0600) + out-of-tree backups - NEVER in a `.rtf`/chat/export/any file that can ride into git or the agent-state backup; shred any delivered `.rtf` after applying (urandom overwrite + rm).
- CAPACITY: a setup-token can serve multiple agents (shared 5h/7d cap). Metered accounts (extra-usage ON = never-stop valve) take HEAVY agents; UNMETERED (e.g. me-com, extra-usage OFF = a cap is a HARD STOP) take LIGHT agents only.
- MONITORING gotcha: `/api/oauth/usage` `seven_day` (weekly_all) UNDER-READS bearer-on-metered burn - the burn shows in `five_hour` + `extra_usage`/`spend.percent`, NOT in `seven_day` (which can decouple). Watch 5h + spend% (rising-from-flat = overage onset), NOT 7d-alone; a 7d-low on a bearer account is decoupled, not "safe". (`src/bus/oauth.ts`; fix spec = `SPEC-usage-monitor-7d-decouple-fix.md`.)
- Reference docs: `RUNBOOK-step2-setup-token-migration.md` (the executable runbook), `FINDINGS-agent-auth-durable.md` (the auth-model findings), the `agent-auth` skill (detail + worked connector-migration examples: team-lead Slack->bot-token, meta-ads Composio->gog, mmb AdManage->Meta-API).
