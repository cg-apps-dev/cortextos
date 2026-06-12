# SPEC: Capacity-aware cron gating (task_1781239775991)

Goal: the daemon cron scheduler must skip/defer NON-CRITICAL cron fires for an agent whose
billing account's 5h bucket is capped (100%) with the extra-usage meter enabled, so recurring
crons (heartbeat class) stop burning metered dollars post-cap. Root cause being fixed:
06-11 night burn, $12+ billed to the capped seat meter by heartbeat fires on long-context sessions.

Repo: TypeScript strict, ESM (`.js` import suffixes), no new runtime deps, atomic writes via
`src/utils/atomic.ts`. Do NOT touch files other than those listed.

## Files to create/modify

### 1. NEW `src/daemon/cron-capacity-gate.ts`

```ts
import type { CronDefinition } from '../types/index.js';

export interface GateDecision { defer: boolean; reason?: string }

export interface CapacityGateOptions {
  agentName: string;
  agentDir: string;   // contains .env and config.json
  ctxRoot: string;    // contains state/usage/multi-account-usage.json and state/oauth/accounts.json
  logger?: (msg: string) => void;
}

export const USAGE_FILE_MAX_AGE_MS = 30 * 60_000; // stale-guard: fail-open beyond this
export const GATE_RECHECK_MS = 15 * 60_000;       // deferred crons recheck on this cadence
export const RESOLUTION_CACHE_TTL_MS = 60_000;    // per-agent account-label cache

export function makeCapacityGate(opts: CapacityGateOptions): (cron: CronDefinition) => GateDecision
```

Behavior of the returned gate function, in order. EVERY ambiguous/error path returns
`{ defer: false }` (FAIL-OPEN - a monitoring outage must never stop heartbeats):

1. `cron.critical === true` -> `{ defer: false }` (critical crons exempt, never even read files).
2. Read `<ctxRoot>/state/usage/multi-account-usage.json`. Missing, unreadable, unparseable,
   no `generated_at`, or `Date.now() - Date.parse(generated_at) > USAGE_FILE_MAX_AGE_MS`
   -> fail-open (log once per distinct reason, not per tick).
   Shape: `{ generated_at: string, accounts: Array<{ account: string, ok: boolean,
   five_hour_pct?: number, extra_usage?: { is_enabled: boolean, used_credits?: number } }> }`.
3. Resolve the agent's billing account label (cached for RESOLUTION_CACHE_TTL_MS):
   a. `<agentDir>/config.json` key `usage_account` (string, non-empty) -> use it (explicit override wins).
   b. Else read `<agentDir>/.env`; if a line `CLAUDE_CODE_OAUTH_TOKEN=<value>` exists
      (tolerate `export ` prefix, surrounding single/double quotes, whitespace), compare the
      token IN MEMORY (exact string equality) against every account's `access_token` in
      `<ctxRoot>/state/oauth/accounts.json` (shape:
      `{ accounts: Record<string, { access_token: string, usage_credential?: { source: string } }> }`).
      Exactly one match -> that account label. No match (stale .env token) -> UNRESOLVED.
   c. Else (no token in .env = machine-login lane): the account whose
      `usage_credential?.source === 'keychain-capture'` is the machine-login account.
      Exactly one such entry -> that label. Zero or multiple -> UNRESOLVED.
      // EDGE (document in a comment): this marker assumes machine login = the seat account.
      // If the machine login is ever flipped to another account, the marker goes stale;
      // fail-open covers safety, but the flip procedure must update usage_credential
      // sources or set explicit usage_account overrides on the login lane.
   d. UNRESOLVED -> fail-open (log the reason once, never guess an account).
4. Find the resolved label in the usage file's `accounts`. Missing or `ok !== true` -> fail-open.
5. If `five_hour_pct >= 100` AND `extra_usage?.is_enabled === true` ->
   `{ defer: true, reason: 'account <label> 5h=<pct>% capped + extra-usage meter on' }`.
   Otherwise `{ defer: false }`.

SECURITY INVARIANTS (these will be security-reviewed):
- Token values from .env / accounts.json are compared in memory ONLY. They must NEVER appear in
  any log, error message, GateDecision.reason, thrown Error, or returned object. Only account
  LABELS may be surfaced.
- Read-only: this module never writes any file.
- All fs reads wrapped in try/catch -> fail-open.

Module-level doc comment: explain the night-burn root cause, fail-open philosophy, and the
machine-login-flip edge.

Logging dedup: keep a module-internal `lastLoggedReason` per gate instance; only call
`logger` when the reason CHANGES (avoid a log line every 30s tick).

### 2. MODIFY `src/types/index.ts`

Add to `CronDefinition` (optional field, after `enabled`):
```ts
  /**
   * Critical crons are EXEMPT from capacity-aware gating: they fire even when
   * the agent's billing account 5h bucket is capped with the extra-usage meter
   * on (user-facing/safety work). Non-critical (default) crons - heartbeat
   * class - are deferred until the bucket resets.
   */
  critical?: boolean;
```

Also add `'deferred'` to the `CronExecutionLogEntry` status union (find the existing union with
'fired' | 'retried' | 'failed' and extend it).

### 3. MODIFY `src/daemon/cron-scheduler.ts`

- `CronSchedulerOptions` gains optional `gate?: (cron: CronDefinition) => GateDecision`
  (import the type from `./cron-capacity-gate.js`).
- In `tick()`, after the `firing` re-entry guard and BEFORE setting `sc.firing = true`:
  ```ts
  if (this.gate) {
    const decision = this.gate(sc.definition);
    if (decision.defer) {
      this.logger(`[cron-scheduler] capacity-deferred "${name}" - ${decision.reason ?? 'capped'}; recheck in ${GATE_RECHECK_MS / 60000}min`);
      appendExecutionLog(this.agentName, {
        ts: new Date().toISOString(), cron: name, status: 'deferred',
        attempt: 0, duration_ms: 0, error: decision.reason ?? null,
      });
      sc.nextFireAt = now + GATE_RECHECK_MS;
      continue;
    }
  }
  ```
- The gate call itself must be try/catch-wrapped: a throwing gate = fail-open (fire normally).
- Do not change any other scheduler behavior.

### 4. MODIFY `src/daemon/agent-manager.ts`

In `startAgentCronScheduler`, build the gate and pass it to the CronScheduler constructor:
```ts
import { makeCapacityGate } from './cron-capacity-gate.js';
// inside startAgentCronScheduler, after entry lookup; entry.process['config'] pattern exists,
// agentDir: resolve the same way the rest of the file does (entry holds it - check the
// AgentEntry shape; if it does not carry agentDir, use this.discoverAgents() lookup or the
// existing private helper that maps name -> dir).
const gate = makeCapacityGate({
  agentName,
  agentDir: /* resolved agent dir */,
  ctxRoot: this.ctxRoot,
  logger: (msg) => console.log(`[daemon] ${msg}`),
});
const scheduler = new CronScheduler({ agentName, onFire, gate, logger: ... });
```

### 5. MODIFY `src/cli/bus.ts`

`add-cron` command: add `.option('--critical', 'Exempt this cron from capacity-aware gating (fires even when the account is capped + metered)')`
and include `...(opts.critical ? { critical: true } : {})` in the CronDefinition it builds.

### 6. NEW `tests/unit/daemon/cron-capacity-gate.test.ts`

vitest, temp-dir based (mkdtempSync pattern like tests/unit/bus/usage-accounts.test.ts).
Helper writes: usage file (with generated_at now/stale), accounts.json, agent .env, config.json.
Cases (each asserts defer true/false and that NO token string ever appears in logged output -
capture logger lines and assert no 'sk-ant' substring):

1. critical cron -> never defers even when capped+metered (and reads no files - assert by
   pointing ctxRoot at a nonexistent dir).
2. tokenless agent + keychain-capture marker account capped 100% + meter on -> defer true,
   reason contains the label.
3. same but five_hour_pct = 99 -> defer false.
4. same but extra_usage.is_enabled = false -> defer false (capped but unmetered = no billing risk).
5. .env token matches account B; B capped+metered, keychain-capture account A uncapped -> defer true
   (per-agent resolution, not machine account).
6. .env token matches B; B uncapped, A capped+metered -> defer false (the inverse lane check).
7. config.json usage_account override wins over .env token match.
8. stale usage file (generated_at 31 min ago) -> fail-open defer false even when capped+metered.
9. missing usage file -> fail-open.
10. .env token matches NO account -> fail-open.
11. zero keychain-capture entries (tokenless lane) -> fail-open.
12. corrupt accounts.json -> fail-open.
13. logger dedup: calling gate 3x with same fail-open reason logs once.

### 7. MODIFY `tests/unit/daemon/cron-scheduler.test.ts` (it exists - check actual path/name with ls)

Add a describe block: scheduler with a gate that defers -> onFire NOT called, execution log gets
a 'deferred' row, nextFireAt advanced by GATE_RECHECK_MS; gate that throws -> onFire IS called
(fail-open); no gate option -> behavior unchanged.

## Validation
`npx tsc --noEmit` clean, `npx vitest run tests/unit/daemon/` green, plus full
`npx vitest run` for regressions. No em/en dashes (U+2014/U+2013) in any added text.
