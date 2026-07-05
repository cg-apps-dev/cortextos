import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  AgentAccountsSnapshotLeakError,
  assertAgentAccountsSnapshotOutputSafe,
  isPendingRestart,
  writeAgentAccountsSnapshot,
} from '../../../src/bus/agent-accounts-snapshot';
import { shortTokenHash } from '../../../src/utils/live-token-hash';

const TOKEN_A = 'sk-ant-account-a-secret';
const TOKEN_B = 'sk-ant-account-b-secret';

let roots: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8');
}

function writeAccounts(ctxRoot: string): void {
  writeJson(join(ctxRoot, 'state', 'oauth', 'accounts.json'), {
    accounts: {
      A: {
        access_token: TOKEN_A,
        usage_credential: { source: 'keychain-capture' },
      },
      B: {
        access_token: TOKEN_B,
      },
    },
  });
}

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots = [];
});

describe('writeAgentAccountsSnapshot', () => {
  it('throws when serialized output contains token-shaped material', () => {
    expect(() => assertAgentAccountsSnapshotOutputSafe('{"note":"sk-ant-oat01-never-write-this"}'))
      .toThrow(AgentAccountsSnapshotLeakError);
    expect(() => assertAgentAccountsSnapshotOutputSafe(`{"note":"${'A'.repeat(40)}"}`))
      .toThrow(AgentAccountsSnapshotLeakError);
  });

  it('marks pending restart only on known live/env divergence', () => {
    expect(isPendingRestart('live-a', 'env-a')).toBe(true);
    expect(isPendingRestart('same', 'same')).toBe(false);
    expect(isPendingRestart(null, 'env-a')).toBe(false);
    expect(isPendingRestart('live-a', null)).toBe(false);
    expect(isPendingRestart(null, null)).toBe(false);
  });

  it('writes account labels and sources without token material', () => {
    const ctxRoot = makeRoot('agent-accounts-ctx-');
    const frameworkRoot = makeRoot('agent-accounts-framework-');
    const agentsRoot = join(frameworkRoot, 'orgs', 'o1', 'agents');
    const a1 = join(agentsRoot, 'a1');
    const a2 = join(agentsRoot, 'a2');
    const a3 = join(agentsRoot, 'a3');
    const a4 = join(agentsRoot, 'a4');
    mkdirSync(a1, { recursive: true });
    mkdirSync(a2, { recursive: true });
    mkdirSync(a3, { recursive: true });
    mkdirSync(a4, { recursive: true });
    writeAccounts(ctxRoot);
    writeFileSync(join(a2, '.env'), `CLAUDE_CODE_OAUTH_TOKEN="${TOKEN_B}"\n`, 'utf-8');
    writeFileSync(join(a3, '.env'), 'CLAUDE_CODE_OAUTH_TOKEN="sk-ant-missing"\n', 'utf-8');
    writeJson(join(a4, 'config.json'), { runtime: 'codex-app-server' });

    const count = writeAgentAccountsSnapshot(ctxRoot, frameworkRoot, { snapshotIntervalMs: 90_000 });

    expect(count).toBe(4);
    const file = join(ctxRoot, 'state', 'usage', 'agent-accounts.json');
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf-8');
    expect(raw).not.toContain('sk-ant');
    expect(raw).not.toContain(TOKEN_A);
    expect(raw).not.toContain(TOKEN_B);
    expect(raw).not.toContain('sk-ant-missing');
    const snapshot = JSON.parse(raw) as {
      generated_at: string;
      snapshot_interval_ms: number;
      override_unreadable?: boolean;
      override_source?: string;
      promotion_candidates: unknown[];
      agents: Array<{
        org: string;
        agent: string;
        account: string | null;
        source: string | null;
        env_cluster_id: string | null;
        live_cluster_id: string | null;
        pending_restart: boolean;
        pkce_match: boolean;
        cluster_id: string | null;
        tier: string;
      }>;
    };
    expect(snapshot.generated_at).toEqual(expect.any(String));
    expect(snapshot.snapshot_interval_ms).toBe(90_000);
    expect(snapshot.override_unreadable).toBeUndefined();
    expect(snapshot.override_source).toBeUndefined();
    expect(snapshot.promotion_candidates).toEqual([]);
    expect(snapshot.agents).toEqual([
      expect.objectContaining({
        org: 'o1',
        agent: 'a1',
        account: 'A',
        source: 'login-marker',
        env_cluster_id: null,
        live_cluster_id: null,
        pending_restart: false,
        pkce_match: false,
        cluster_id: null,
        tier: 'UNVERIFIED',
      }),
      expect.objectContaining({
        org: 'o1',
        agent: 'a2',
        account: 'B',
        source: 'token-match',
        env_cluster_id: shortTokenHash(TOKEN_B),
        live_cluster_id: null,
        pending_restart: false,
        pkce_match: false,
        cluster_id: shortTokenHash(TOKEN_B),
        tier: 'UNVERIFIED',
      }),
      expect.objectContaining({
        org: 'o1',
        agent: 'a3',
        account: null,
        source: null,
        reason: 'agent billing account unresolved',
        env_cluster_id: shortTokenHash('sk-ant-missing'),
        live_cluster_id: null,
        pending_restart: false,
        pkce_match: false,
        cluster_id: shortTokenHash('sk-ant-missing'),
        tier: 'UNVERIFIED',
      }),
      expect.objectContaining({
        org: 'o1',
        agent: 'a4',
        account: null,
        source: 'runtime-excluded',
        reason: 'codex-app-server runtime bills the Codex plan, not a Claude account',
        env_cluster_id: null,
        live_cluster_id: null,
        pending_restart: false,
        pkce_match: false,
        cluster_id: null,
        tier: 'UNVERIFIED',
      }),
    ]);
  });

  it('returns null and writes no file when orgs is missing', () => {
    const ctxRoot = makeRoot('agent-accounts-ctx-');
    const frameworkRoot = makeRoot('agent-accounts-framework-');

    expect(writeAgentAccountsSnapshot(ctxRoot, frameworkRoot)).toBeNull();
    expect(existsSync(join(ctxRoot, 'state', 'usage', 'agent-accounts.json'))).toBe(false);
  });

  it('ignores underscore-prefixed override comment keys', () => {
    const ctxRoot = makeRoot('agent-accounts-ctx-');
    const frameworkRoot = makeRoot('agent-accounts-framework-');
    const agentsRoot = join(frameworkRoot, 'orgs', 'o1', 'agents');
    const adStrategist = join(agentsRoot, 'the-ad-strategist');
    mkdirSync(adStrategist, { recursive: true });
    writeAccounts(ctxRoot);
    writeFileSync(join(adStrategist, '.env'), `CLAUDE_CODE_OAUTH_TOKEN="${TOKEN_B}"\n`, 'utf-8');
    const overridePath = join(frameworkRoot, 'override.json');
    writeJson(overridePath, {
      _comment: 'human documentation only',
      generated_at: '2026-07-05T00:00:00.000Z',
      overrides: {
        _comment: { tier: 'CONFIRMED-PKCE', billing_account: 'should-not-apply' },
        'renamed-stale-agent': {
          tier: 'CONFIRMED-CORRELATION',
          billing_account: 'stale-account',
          note: 'stale override from a prior roster',
        },
        'the-ad-strategist': {
          tier: 'UNVERIFIED',
          note: '666d swap-not-relabel + correlation-pending',
          set_at: '2026-07-05T00:00:00.000Z',
        },
      },
    });

    expect(writeAgentAccountsSnapshot(ctxRoot, frameworkRoot, { securityOverridePath: overridePath })).toBe(1);
    const snapshot = JSON.parse(readFileSync(join(ctxRoot, 'state', 'usage', 'agent-accounts.json'), 'utf-8')) as {
      agents: Array<{ agent: string; tier: string; account: string | null; override_note?: string }>;
    };
    expect(snapshot.agents[0]).toMatchObject({
      agent: 'the-ad-strategist',
      tier: 'UNVERIFIED',
      account: 'B',
      override_note: '666d swap-not-relabel + correlation-pending',
    });
    expect(JSON.stringify(snapshot)).not.toContain('should-not-apply');
    expect(JSON.stringify(snapshot)).not.toContain('renamed-stale-agent');
    expect(JSON.stringify(snapshot)).not.toContain('stale-account');
  });

  it('marks present but unreadable override files without changing mechanical tiers', () => {
    const ctxRoot = makeRoot('agent-accounts-ctx-');
    const frameworkRoot = makeRoot('agent-accounts-framework-');
    const agentsRoot = join(frameworkRoot, 'orgs', 'o1', 'agents');
    const a1 = join(agentsRoot, 'a1');
    const a2 = join(agentsRoot, 'a2');
    mkdirSync(a1, { recursive: true });
    mkdirSync(a2, { recursive: true });
    writeAccounts(ctxRoot);
    writeFileSync(join(a1, '.env'), `CLAUDE_CODE_OAUTH_TOKEN="${TOKEN_B}"\n`, 'utf-8');
    writeFileSync(join(a2, '.env'), `CLAUDE_CODE_OAUTH_TOKEN="${TOKEN_B}"\n`, 'utf-8');
    const overridePath = join(frameworkRoot, 'override.json');
    mkdirSync(join(overridePath, '..'), { recursive: true });
    writeFileSync(overridePath, '{ nope', 'utf-8');

    expect(writeAgentAccountsSnapshot(ctxRoot, frameworkRoot, { securityOverridePath: overridePath })).toBe(2);
    const snapshot = JSON.parse(readFileSync(join(ctxRoot, 'state', 'usage', 'agent-accounts.json'), 'utf-8')) as {
      override_unreadable?: boolean;
      override_source?: string;
      agents: Array<{ agent: string; tier: string }>;
    };
    expect(snapshot.override_unreadable).toBe(true);
    expect(snapshot.override_source).toBe('error');
    expect(snapshot.agents).toEqual([
      expect.objectContaining({ agent: 'a1', tier: 'ASSERTED' }),
      expect.objectContaining({ agent: 'a2', tier: 'ASSERTED' }),
    ]);
  });

  it('refuses to write agent-accounts.json when a future field carries a token-shaped value', () => {
    const ctxRoot = makeRoot('agent-accounts-ctx-');
    const frameworkRoot = makeRoot('agent-accounts-framework-');
    const agentsRoot = join(frameworkRoot, 'orgs', 'o1', 'agents');
    const agentDir = join(agentsRoot, 'the-ad-strategist');
    mkdirSync(agentDir, { recursive: true });
    writeAccounts(ctxRoot);
    const overridePath = join(frameworkRoot, 'override.json');
    writeJson(overridePath, {
      generated_at: '2026-07-05T00:00:00.000Z',
      overrides: {
        'the-ad-strategist': {
          tier: 'UNVERIFIED',
          note: 'sk-ant-oat01-future-regression-token',
          set_at: '2026-07-05T00:00:00.000Z',
        },
      },
    });

    expect(() => writeAgentAccountsSnapshot(ctxRoot, frameworkRoot, { securityOverridePath: overridePath }))
      .toThrow(AgentAccountsSnapshotLeakError);
    expect(existsSync(join(ctxRoot, 'state', 'usage', 'agent-accounts.json'))).toBe(false);
  });
});
