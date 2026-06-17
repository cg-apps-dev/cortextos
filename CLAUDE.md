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
