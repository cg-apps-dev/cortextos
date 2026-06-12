# SPEC: Per-card agent lists on the analytics usage panel (Adam request)

Goal: each Claude account card on the analytics page lists WHICH AGENTS bill that
account. Live-derived from the capacity gate's per-agent resolution - never hardcoded,
auto-updates on re-wiring. NO em or en dashes anywhere in added text. No new deps.

## 1. NEW `src/bus/agent-accounts-snapshot.ts` (zero-token snapshot writer)

```ts
import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync, ensureDir } from '../utils/atomic.js';
import { resolveAgentAccount } from '../daemon/cron-capacity-gate.js';

export interface AgentAccountEntry {
  org: string;
  agent: string;
  account: string | null;   // resolved billing-account label, null = unresolved
  source: string | null;    // 'override' | 'token-match' | 'login-marker' | null
}

export function writeAgentAccountsSnapshot(ctxRoot: string, frameworkRoot: string): number | null
```

Behavior: discover agents exactly like the `list-agent-accounts` CLI does
(`<frameworkRoot>/orgs/<org>/agents/<agent>` directories, skip non-dirs), call
`resolveAgentAccount(agentDir, ctxRoot)` per agent, and atomically write
`<ctxRoot>/state/usage/agent-accounts.json`:
```json
{ "generated_at": "<ISO>", "agents": [ { "org": "...", "agent": "...", "account": "...", "source": "..." } ] }
```
ensureDir the usage dir first. Returns the agent count written. ANY error (missing
orgs dir, fs error) -> return null, never throw (fail-soft: this rides the usage job
and must never break it). Labels + source enum only - resolveAgentAccount already
never returns token material; do not add anything beyond its return + org/agent names.

## 2. MODIFY `src/cli/bus.ts` - check-all-usage action

After the `checkAllUsage` result is obtained (before output handling is fine), add:
```ts
try { writeAgentAccountsSnapshot(env.ctxRoot, env.frameworkRoot); } catch { /* fail-soft */ }
```
Import the function. Must not affect output, alerts, or exit codes.

## 3. MODIFY `dashboard/src/lib/data/reports.ts`

- Export pure helper `shortAgentName(name: string): string`: strips a trailing
  `-agent` suffix and a leading `the-` prefix (both, in that order - e.g.
  `cortextos-dev-agent` -> `cortextos-dev`, `the-orchestrator` -> `orchestrator`,
  `meta-ads-agent` -> `meta-ads`, `cro-agent` -> `cro`). Plain name without either
  passes through unchanged.
- Export `getAgentAccounts(): { byAccount: Record<string, string[]>; unassigned: string[] } | null`:
  reads `<CTX_ROOT>/state/usage/agent-accounts.json` (same existsSync/try-parse style
  as getMultiAccountUsage). byAccount = account label -> SORTED array of
  shortAgentName(agent) for entries with a non-null account. unassigned = SORTED
  shortAgentName list of entries with account null (must be VISIBLE in the UI, not
  silently dropped - an unresolved agent has to prompt the override fix). Parse
  failure or missing file -> null.

## 4. MODIFY `dashboard/src/components/analytics/subscription-usage.tsx`

- `SubscriptionUsage` props gain `agentAccounts?: Record<string, string[]> | null`.
- `AccountCard` gains optional `agents?: string[]`. When non-empty, render UNDER the
  extra-usage label area: a flex-wrap row of small chips, one per agent name -
  `<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">`.
  Match the file's existing styling conventions. Nothing rendered when absent/empty.
- Wire: each account card gets `agents={agentAccounts?.byAccount[entry.account]}`.
- UNASSIGNED footer: when `agentAccounts?.unassigned` is non-empty, render a muted
  chip row under the cards grid (above the refresh footer line): a tiny label
  `unassigned:` followed by the same chip style per name, with the chips in a
  warning tint (e.g. text-amber-600/bg-amber-500/10) so the state is noticeable.
- Do NOT touch the Codex card (ChatGPT plan - no Claude agents) or anything else.

## 5. MODIFY `dashboard/src/app/(dashboard)/analytics/page.tsx`

Import `getAgentAccounts`, add `Promise.resolve(getAgentAccounts())` to the existing
parallel fetch block, pass `agentAccounts={...}` to `<SubscriptionUsage />`.

## 6. Tests

- NEW `tests/unit/bus/agent-accounts-snapshot.test.ts` (mkdtemp fixture style of
  tests/unit/daemon/cron-capacity-gate.test.ts): build a fake frameworkRoot with
  orgs/o1/agents/{a1,a2} + ctxRoot with accounts.json (one keychain-capture account A,
  one token account B) + a2/.env containing the B token. Assert: snapshot file written,
  a1 -> A/login-marker, a2 -> B/token-match; returns 2; output JSON contains NO
  'sk-ant' substring. Also: missing orgs dir -> returns null, no file written, no throw.
- NEW `dashboard/src/lib/__tests__/agent-accounts.test.ts`: shortAgentName cases
  (the- prefix, -agent suffix, both, neither) + getAgentAccounts is exercised only if
  trivially mockable - otherwise shortAgentName tests suffice (note it in a comment).
- Snapshot test addition: an agent with NO resolvable account (empty agentDir, no
  keychain-capture entry anywhere) appears in the JSON with account null - and
  getAgentAccounts surfaces it via `unassigned`.

## Validation (from worktree root)
`npx tsc --noEmit` (root) AND `cd dashboard && npx tsc --noEmit`, then
`npx vitest run tests/unit/bus/agent-accounts-snapshot.test.ts dashboard/src/lib/__tests__/agent-accounts.test.ts`.
Do not run next build. Do not git add or commit.
