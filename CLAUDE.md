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
- Check the current shell with `scripts/check-native-abi.sh`; use `scripts/check-native-abi.sh --fix` to run `npm rebuild better-sqlite3` in `dashboard/` with the current Node and re-check.
