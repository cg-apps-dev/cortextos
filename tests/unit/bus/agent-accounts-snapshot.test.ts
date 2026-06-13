import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeAgentAccountsSnapshot } from '../../../src/bus/agent-accounts-snapshot';

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

    const count = writeAgentAccountsSnapshot(ctxRoot, frameworkRoot);

    expect(count).toBe(4);
    const file = join(ctxRoot, 'state', 'usage', 'agent-accounts.json');
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf-8');
    expect(raw).not.toContain('sk-ant');
    const snapshot = JSON.parse(raw) as {
      generated_at: string;
      agents: Array<{ org: string; agent: string; account: string | null; source: string | null }>;
    };
    expect(snapshot.generated_at).toEqual(expect.any(String));
    expect(snapshot.agents).toEqual([
      { org: 'o1', agent: 'a1', account: 'A', source: 'login-marker' },
      { org: 'o1', agent: 'a2', account: 'B', source: 'token-match' },
      { org: 'o1', agent: 'a3', account: null, source: null, reason: 'agent billing account unresolved' },
      {
        org: 'o1',
        agent: 'a4',
        account: null,
        source: 'runtime-excluded',
        reason: 'codex-app-server runtime bills the Codex plan, not a Claude account',
      },
    ]);
  });

  it('returns null and writes no file when orgs is missing', () => {
    const ctxRoot = makeRoot('agent-accounts-ctx-');
    const frameworkRoot = makeRoot('agent-accounts-framework-');

    expect(writeAgentAccountsSnapshot(ctxRoot, frameworkRoot)).toBeNull();
    expect(existsSync(join(ctxRoot, 'state', 'usage', 'agent-accounts.json'))).toBe(false);
  });
});
