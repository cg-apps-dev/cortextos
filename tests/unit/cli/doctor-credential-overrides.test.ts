import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auditCredentialOverrides,
  enumerateAgentEnvKeys,
  parseEnvKeyNames,
} from '../../../src/cli/doctor';

describe('doctor credential override audit', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `cortextos-doctor-credential-${Date.now()}-${Math.random()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeAgentEnv(agent: string, content: string): void {
    const agentDir = join(root, 'orgs', 'acme', 'agents', agent);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, '.env'), content, 'utf-8');
  }

  it('matches the fixture contract without flagging correct bearer or near-miss names', () => {
    const findings = auditCredentialOverrides({
      agents: {
        clean: {
          envKeys: [
            'CLAUDE_CODE_OAUTH_TOKEN',
            'BOT_TOKEN',
            'GEMINI_API_KEY',
            'SHOPIFY_ACCESS_TOKEN',
            'ANTHROPIC_ORG_LABEL',
          ],
        },
        incident: { envKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN'] },
        apikey: { envKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'] },
      },
    });

    expect(findings).toEqual([
      {
        agent: 'incident',
        override: 'ANTHROPIC_AUTH_TOKEN',
        detail: 'ANTHROPIC_AUTH_TOKEN overrides CLAUDE_CODE_OAUTH_TOKEN (silent auth/billing redirect)',
      },
      {
        agent: 'apikey',
        override: 'ANTHROPIC_API_KEY',
        detail: 'ANTHROPIC_API_KEY overrides CLAUDE_CODE_OAUTH_TOKEN (silent auth/billing redirect)',
      },
    ]);
  });

  it('parses env key names without exposing values', () => {
    expect(parseEnvKeyNames([
      '# comment',
      'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-secret',
      'export ANTHROPIC_AUTH_TOKEN=secret',
      'not-an-assignment',
      '',
    ].join('\n'))).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN']);
  });

  it('enumerates live agent .env key names and reports scanned count', () => {
    writeAgentEnv('alpha', 'CLAUDE_CODE_OAUTH_TOKEN=secret\nBOT_TOKEN=secret\n');
    writeAgentEnv('bravo', 'CLAUDE_CODE_OAUTH_TOKEN=secret\nANTHROPIC_API_KEY=secret\n');

    const scan = enumerateAgentEnvKeys(root);

    expect(scan.scannedCount).toBe(2);
    expect(scan.unreadable).toEqual([]);
    expect(scan.agents).toEqual({
      alpha: { envKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'BOT_TOKEN'] },
      bravo: { envKeys: ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'] },
    });
    expect(JSON.stringify(scan)).not.toContain('secret');
  });

  it('makes zero enumeration visible to the caller', () => {
    mkdirSync(join(root, 'orgs', 'acme', 'agents'), { recursive: true });

    const scan = enumerateAgentEnvKeys(root);

    expect(scan.scannedCount).toBe(0);
    expect(auditCredentialOverrides({ agents: scan.agents })).toEqual([]);
    expect(existsSync(join(root, 'orgs', 'acme', 'agents'))).toBe(true);
  });
});
