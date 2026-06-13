import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { makeCapacityGate, resolveAgentAccount } from '../../../src/daemon/cron-capacity-gate';
import type { CronDefinition } from '../../../src/types/index';

const TOKEN_A = 'sk-ant-account-a-secret';
const TOKEN_B = 'sk-ant-account-b-secret';

function cron(overrides: Partial<CronDefinition> = {}): CronDefinition {
  return {
    name: 'heartbeat',
    prompt: 'Run heartbeat.',
    schedule: '1m',
    enabled: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

function makeRoot(): { root: string; agentDir: string; logs: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'cron-capacity-gate-test-'));
  const agentDir = join(root, 'agent');
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(root, 'state', 'usage'), { recursive: true });
  mkdirSync(join(root, 'state', 'oauth'), { recursive: true });
  return { root, agentDir, logs: [] };
}

function writeUsage(root: string, accounts: unknown[], generatedAt = new Date().toISOString()): void {
  writeJson(join(root, 'state', 'usage', 'multi-account-usage.json'), {
    generated_at: generatedAt,
    accounts,
  });
}

function writeAccounts(root: string, accounts: Record<string, unknown>): void {
  writeJson(join(root, 'state', 'oauth', 'accounts.json'), { accounts });
}

function writeEnv(agentDir: string, token: string): void {
  writeFileSync(join(agentDir, '.env'), `export CLAUDE_CODE_OAUTH_TOKEN="${token}"\n`, 'utf-8');
}

function writeConfig(agentDir: string, usageAccount: string): void {
  writeJson(join(agentDir, 'config.json'), { usage_account: usageAccount });
}

function baseAccounts(): Record<string, unknown> {
  return {
    A: {
      access_token: TOKEN_A,
      usage_credential: { source: 'keychain-capture' },
    },
    B: {
      access_token: TOKEN_B,
    },
  };
}

function usageAccount(account: string, pct: number, metered: boolean, ok = true): unknown {
  return {
    account,
    ok,
    five_hour_pct: pct,
    extra_usage: { is_enabled: metered, used_credits: 12 },
  };
}

describe('makeCapacityGate', () => {
  let root: string;
  let agentDir: string;
  let logs: string[];

  beforeEach(() => {
    const fixture = makeRoot();
    root = fixture.root;
    agentDir = fixture.agentDir;
    logs = fixture.logs;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function gate() {
    return makeCapacityGate({
      agentName: 'agent',
      agentDir,
      ctxRoot: root,
      logger: (msg) => logs.push(msg),
    });
  }

  function expectNoTokenLeak(): void {
    expect(logs.join('\n')).not.toContain('sk-ant');
  }

  it('critical cron never defers and reads no files', () => {
    const missingRoot = join(root, 'missing');
    const g = makeCapacityGate({
      agentName: 'agent',
      agentDir,
      ctxRoot: missingRoot,
      logger: (msg) => logs.push(msg),
    });

    expect(g(cron({ critical: true }))).toEqual({ defer: false });
    expect(logs).toEqual([]);
    expectNoTokenLeak();
  });

  it('tokenless agent with keychain-capture marker capped and metered defers', () => {
    writeUsage(root, [usageAccount('A', 100, true)]);
    writeAccounts(root, baseAccounts());

    const decision = gate()(cron());

    expect(decision.defer).toBe(true);
    expect(decision.reason).toContain('A');
    expectNoTokenLeak();
  });

  it('does not defer at 99 percent', () => {
    writeUsage(root, [usageAccount('A', 99, true)]);
    writeAccounts(root, baseAccounts());

    expect(gate()(cron()).defer).toBe(false);
    expectNoTokenLeak();
  });

  it('does not defer when capped but extra usage is disabled', () => {
    writeUsage(root, [usageAccount('A', 100, false)]);
    writeAccounts(root, baseAccounts());

    expect(gate()(cron()).defer).toBe(false);
    expectNoTokenLeak();
  });

  it('uses the matching .env token account instead of the machine account', () => {
    writeEnv(agentDir, TOKEN_B);
    writeUsage(root, [usageAccount('A', 10, false), usageAccount('B', 100, true)]);
    writeAccounts(root, baseAccounts());

    const decision = gate()(cron());

    expect(decision.defer).toBe(true);
    expect(decision.reason).toContain('B');
    expectNoTokenLeak();
  });

  it('does not defer when .env token account is uncapped and machine account is capped', () => {
    writeEnv(agentDir, TOKEN_B);
    writeUsage(root, [usageAccount('A', 100, true), usageAccount('B', 10, true)]);
    writeAccounts(root, baseAccounts());

    expect(gate()(cron()).defer).toBe(false);
    expectNoTokenLeak();
  });

  it('config usage_account override wins over .env token match', () => {
    writeEnv(agentDir, TOKEN_B);
    writeConfig(agentDir, 'A');
    writeUsage(root, [usageAccount('A', 100, true), usageAccount('B', 10, false)]);
    writeAccounts(root, baseAccounts());

    const decision = gate()(cron());

    expect(decision.defer).toBe(true);
    expect(decision.reason).toContain('A');
    expectNoTokenLeak();
  });

  it('fails open for stale usage file', () => {
    writeUsage(root, [usageAccount('A', 100, true)], new Date(Date.now() - 31 * 60_000).toISOString());
    writeAccounts(root, baseAccounts());

    expect(gate()(cron()).defer).toBe(false);
    expectNoTokenLeak();
  });

  it('fails open for missing usage file', () => {
    writeAccounts(root, baseAccounts());

    expect(gate()(cron()).defer).toBe(false);
    expectNoTokenLeak();
  });

  it('fails open when every usage row is an impossible read', () => {
    writeUsage(root, [
      { ...usageAccount('A', 0, true, false), status: 'impossible-read', error: 'impossible-read: five_hour+seven_day utilization without resets_at' },
      { ...usageAccount('B', 0, true, false), status: 'impossible-read', error: 'impossible-read: five_hour+seven_day utilization without resets_at' },
    ]);
    writeAccounts(root, baseAccounts());

    const decision = gate()(cron());

    expect(decision.defer).toBe(false);
    expect(logs.join('\n')).toContain('usage account A unavailable');
    expectNoTokenLeak();
  });

  it('fails open when .env token matches no account', () => {
    writeEnv(agentDir, 'sk-ant-not-in-accounts');
    writeUsage(root, [usageAccount('A', 100, true)]);
    writeAccounts(root, baseAccounts());

    expect(gate()(cron()).defer).toBe(false);
    expectNoTokenLeak();
  });

  it('fails open when tokenless lane has zero keychain-capture entries', () => {
    writeUsage(root, [usageAccount('A', 100, true)]);
    writeAccounts(root, {
      A: { access_token: TOKEN_A },
      B: { access_token: TOKEN_B },
    });

    expect(gate()(cron()).defer).toBe(false);
    expectNoTokenLeak();
  });

  it('fails open for corrupt accounts.json', () => {
    writeUsage(root, [usageAccount('A', 100, true)]);
    writeFileSync(join(root, 'state', 'oauth', 'accounts.json'), '{ nope', 'utf-8');

    expect(gate()(cron()).defer).toBe(false);
    expectNoTokenLeak();
  });

  describe('resolveAgentAccount (public read surface for list-agent-accounts)', () => {
    it('reports source=override when config usage_account wins', () => {
      writeEnv(agentDir, TOKEN_B);
      writeConfig(agentDir, 'A');
      writeAccounts(root, baseAccounts());
      const r = resolveAgentAccount(agentDir, root);
      expect(r).toEqual({ label: 'A', source: 'override' });
    });

    it('reports source=token-match for the .env lane', () => {
      writeEnv(agentDir, TOKEN_B);
      writeAccounts(root, baseAccounts());
      const r = resolveAgentAccount(agentDir, root);
      expect(r).toEqual({ label: 'B', source: 'token-match' });
    });

    it('reports source=login-marker for the tokenless lane', () => {
      writeAccounts(root, baseAccounts());
      const r = resolveAgentAccount(agentDir, root);
      expect(r).toEqual({ label: 'A', source: 'login-marker' });
    });

    it('unresolved returns null label + reason and NEVER any token material', () => {
      writeEnv(agentDir, 'sk-ant-not-in-accounts');
      writeAccounts(root, baseAccounts());
      const r = resolveAgentAccount(agentDir, root);
      expect(r.label).toBeNull();
      expect(r.source).toBeUndefined();
      expect(JSON.stringify(r)).not.toContain('sk-ant');
    });

    it('successful resolutions never include token material either', () => {
      writeEnv(agentDir, TOKEN_B);
      writeAccounts(root, baseAccounts());
      expect(JSON.stringify(resolveAgentAccount(agentDir, root))).not.toContain('sk-ant');
    });
  });

  it('deduplicates repeated fail-open logger lines', () => {
    const g = gate();

    expect(g(cron()).defer).toBe(false);
    expect(g(cron()).defer).toBe(false);
    expect(g(cron()).defer).toBe(false);

    expect(logs).toHaveLength(1);
    expectNoTokenLeak();
  });
});
