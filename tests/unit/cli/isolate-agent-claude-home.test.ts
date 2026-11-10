import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isolateAgentClaudeHome } from '../../../src/cli/isolate-agent-claude-home.js';

const ENV_KEYS = [
  'CTX_ROOT',
  'CTX_FRAMEWORK_ROOT',
  'CTX_PROJECT_ROOT',
  'CTX_ORG',
  'CTX_AGENT_NAME',
  'CTX_AGENT_DIR',
  'CTX_INSTANCE_ID',
] as const;

let sandboxRoot: string;
let frameworkRoot: string;
let ctxRoot: string;
let operatorHome: string;
let sourceClaudeHome: string;
let agentDir: string;
let originalEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

function ensureFile(path: string, content = ''): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content, { mode: 0o600 });
}

function triplewhaleEntrypoint(home = operatorHome): string {
  return join(home, '.hermes', 'node', 'lib', 'node_modules', '@triplewhale', 'mcp-server-triplewhale', 'dist', 'index.js');
}

function unrestrictEntrypoint(home = operatorHome): string {
  return join(home, '.hermes', 'node', 'lib', 'node_modules', '@zappush', 'mcp', 'dist', 'index.js');
}

function admanageEntrypoint(root = frameworkRoot): string {
  return join(root, 'dist', 'mcp', 'admanage.js');
}

function nodeBinary(home = operatorHome): string {
  return join(home, '.hermes', 'node', 'bin', 'node');
}

function stdioServer(
  entrypoint = unrestrictEntrypoint(),
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'stdio',
    command: 'node',
    args: [entrypoint],
    env: { ZAPPUSH_API_KEY: 'fixture-value' },
    ...overrides,
  };
}

function targetClaudeJson(): string {
  return join(ctxRoot, 'state', 'worker', 'claude-home', '.claude.json');
}

function writeSourceConfig(config: Record<string, unknown>, home = operatorHome): void {
  mkdirSync(join(home, '.claude'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.claude.json'), JSON.stringify(config, null, 2), { mode: 0o600 });
}

function isolate(config: Record<string, unknown>, source = sourceClaudeHome): void {
  writeSourceConfig(config, join(source, '..'));
  isolateAgentClaudeHome('worker', { sourceClaudeHome: source });
}

beforeEach(() => {
  const canonicalTmp = realpathSync(tmpdir());
  sandboxRoot = realpathSync(mkdtempSync(join(canonicalTmp, 'mcp-launcher-allowlist-')));
  chmodSync(sandboxRoot, 0o700);
  frameworkRoot = join(sandboxRoot, 'framework');
  ctxRoot = join(sandboxRoot, 'ctx');
  operatorHome = join(sandboxRoot, 'operator');
  sourceClaudeHome = join(operatorHome, '.claude');
  agentDir = join(frameworkRoot, 'orgs', 'test-org', 'agents', 'worker');

  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  mkdirSync(ctxRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(agentDir, '.env'), 'EXISTING=value\n', { mode: 0o600 });
  writeFileSync(join(agentDir, 'config.json'), '{}\n', { mode: 0o600 });
  ensureFile(triplewhaleEntrypoint());
  ensureFile(unrestrictEntrypoint());
  ensureFile(admanageEntrypoint());
  ensureFile(nodeBinary());

  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as typeof originalEnv;
  process.env.CTX_ROOT = ctxRoot;
  process.env.CTX_FRAMEWORK_ROOT = frameworkRoot;
  process.env.CTX_PROJECT_ROOT = frameworkRoot;
  process.env.CTX_ORG = 'test-org';
  process.env.CTX_AGENT_NAME = 'worker';
  process.env.CTX_AGENT_DIR = agentDir;
  process.env.CTX_INSTANCE_ID = 'mcp-launcher-allowlist-test';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  rmSync(sandboxRoot, { recursive: true, force: true });
});

describe('isolate-agent-claude-home MCP launcher allowlist', () => {
  it.each(['bash', '/bin/sh'])('A1 rejects an outside launcher basename: %s', (command) => {
    expect(() => isolate({ mcpServers: { hostile: stdioServer(undefined, { command }) } }))
      .toThrow('must use the node launcher');
  });

  it('rejects a node-named command outside the trusted node locations', () => {
    const hostileNode = join(sandboxRoot, 'evil', 'node');
    ensureFile(hostileNode);
    expect(() => isolate({ mcpServers: { hostile: stdioServer(undefined, { command: hostileNode }) } }))
      .toThrow('node command is outside trusted locations');
  });

  it.each(['-e', '-r'])('A2 rejects a node option in entrypoint position: %s', (option) => {
    const args = option === '-e'
      ? ['-e', 'process.exit(1)']
      : ['-r', '/tmp/evil.js', unrestrictEntrypoint()];
    expect(() => isolate({ mcpServers: { hostile: stdioServer(undefined, { args }) } }))
      .toThrow('may not place a node option');
  });

  it('A3 rejects NODE_OPTIONS inside an otherwise valid launcher', () => {
    expect(() => isolate({
      mcpServers: {
        unrestrict: stdioServer(undefined, { env: { ZAPPUSH_API_KEY: 'fixture-value', NODE_OPTIONS: '--require /tmp/evil.js' } }),
      },
    })).toThrow('NODE_OPTIONS');
  });

  it('A4 rejects a package-name decoy outside the known install root', () => {
    const decoy = join(sandboxRoot, 'evil', '@zappush', 'mcp', 'dist', 'index.js');
    ensureFile(decoy);
    expect(() => isolate({ mcpServers: { hostile: stdioServer(decoy) } }))
      .toThrow('entrypoint is not allowlisted');
  });

  it('A4 rejects an exact allowlisted path when its file is a symlink outside the install root', () => {
    const externalEntrypoint = join(sandboxRoot, 'evil-entrypoint.js');
    ensureFile(externalEntrypoint);
    unlinkSync(unrestrictEntrypoint());
    symlinkSync(externalEntrypoint, unrestrictEntrypoint());
    expect(() => isolate({ mcpServers: { unrestrict: stdioServer() } }))
      .toThrow('entrypoint is not allowlisted');
  });

  it('A5 rejects dynamic-loader injection inside an otherwise valid launcher', () => {
    expect(() => isolate({
      mcpServers: {
        unrestrict: stdioServer(undefined, { env: { ZAPPUSH_API_KEY: 'fixture-value', DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib' } }),
      },
    })).toThrow('DYLD_INSERT_LIBRARIES');
  });

  it('A6 rejects a config-supplied PATH for bare node', () => {
    expect(() => isolate({
      mcpServers: {
        unrestrict: stdioServer(undefined, { env: { ZAPPUSH_API_KEY: 'fixture-value', PATH: '/tmp/evil' } }),
      },
    })).toThrow('PATH');
  });

  it('enforces env keys per entrypoint rather than fleet-wide', () => {
    expect(() => isolate({
      mcpServers: {
        triplewhale: stdioServer(triplewhaleEntrypoint(), { env: { ZAPPUSH_API_KEY: 'fixture-value' } }),
      },
    })).toThrow('ZAPPUSH_API_KEY');
  });

  it('A7 rejects npx loudly with the Adam-gated node normalization', () => {
    expect(() => isolate({
      mcpServers: {
        triplewhale: stdioServer(undefined, {
          command: 'npx',
          args: ['-y', '@triplewhale/mcp-server-triplewhale', 'start', 'fixture-workspace'],
          env: {},
        }),
      },
    })).toThrow(/triplewhale.*Adam-gated source normalization.*command to node.*args\[0\]/);
  });

  it.each([
    ['python', ['-c', 'print(1)']],
    ['npx', ['--package=evil', '@triplewhale/mcp-server-triplewhale']],
    ['npx', ['-y', 'evil-package']],
  ])('A8 rejects hostile launcher laundering via %s', (command, args) => {
    expect(() => isolate({
      mcpServers: { hostile: stdioServer(undefined, { command, args, env: {} }) },
    })).toThrow();
  });

  it('B rejects a valid launcher when the source home is inside the framework checkout', () => {
    const repoSource = join(frameworkRoot, 'operator', '.claude');
    writeSourceConfig({ mcpServers: { unrestrict: stdioServer() } }, join(repoSource, '..'));
    expect(() => isolateAgentClaudeHome('worker', { sourceClaudeHome: repoSource }))
      .toThrow('may not be inside a repository checkout');
  });

  it('passes all three exact entrypoints, preserves non-stdio servers, and enforces the target invariant', () => {
    const config = {
      theme: 'dark',
      mcpServers: {
        triplewhale: stdioServer(triplewhaleEntrypoint(), { env: {} }),
        unrestrict: stdioServer(),
        admanage: stdioServer(admanageEntrypoint(), { command: nodeBinary(), env: {} }),
        remote: { type: 'sse', url: 'https://example.test/mcp' },
        'claude.ai connector': { type: 'connector', url: 'https://example.test/bridge' },
      },
    };
    isolate(config);

    const output = JSON.parse(readFileSync(targetClaudeJson(), 'utf-8')) as Record<string, unknown>;
    expect(output.theme).toBe('dark');
    expect(output.mcpServers).toMatchObject({
      triplewhale: expect.any(Object),
      unrestrict: expect.any(Object),
      admanage: expect.any(Object),
      remote: expect.any(Object),
    });
    expect(output.mcpServers).not.toHaveProperty('claude.ai connector');
    const stat = lstatSync(targetClaudeJson());
    expect(stat.isFile()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.mode & 0o777).toBe(0o600);
    if (process.getuid) expect(stat.uid).toBe(process.getuid());
  });

  it('keeps the existing successful output bytes including the current trailing newlines', () => {
    const config = { theme: 'dark', mcpServers: { unrestrict: stdioServer() } };
    isolate(config);
    expect(readFileSync(targetClaudeJson(), 'utf-8')).toBe(`${JSON.stringify(config, null, 2)}\n\n`);
  });

  it('allows an absent or empty MCP mechanism and rejects a malformed stdio server', () => {
    expect(() => isolate({ theme: 'dark' })).not.toThrow();
    expect(() => isolate({ theme: 'dark', mcpServers: {} })).not.toThrow();
    expect(() => isolate({ mcpServers: { malformed: { type: 'stdio', args: [unrestrictEntrypoint()] } } }))
      .toThrow('has no valid command');
  });

  it('rejects a source-home symlink into a world-writable tree', () => {
    const untrustedHome = join(sandboxRoot, 'untrusted-operator');
    const untrustedSource = join(untrustedHome, '.claude');
    writeSourceConfig({ mcpServers: {} }, untrustedHome);
    chmodSync(untrustedHome, 0o777);
    const sourceLink = join(sandboxRoot, 'source-link');
    symlinkSync(untrustedSource, sourceLink);

    expect(() => isolateAgentClaudeHome('worker', { sourceClaudeHome: sourceLink }))
      .toThrow('world-writable path');
  });

  it('rejects a symlinked source .claude.json', () => {
    mkdirSync(sourceClaudeHome, { recursive: true, mode: 0o700 });
    const externalConfig = join(sandboxRoot, 'external.json');
    writeFileSync(externalConfig, '{}\n', { mode: 0o600 });
    symlinkSync(externalConfig, join(operatorHome, '.claude.json'));
    expect(() => isolateAgentClaudeHome('worker', { sourceClaudeHome }))
      .toThrow('regular non-symlink file');
  });

  it('rejects an existing symlink component in the isolated target before writing through it', () => {
    writeSourceConfig({ mcpServers: {} });
    const redirectedState = join(sandboxRoot, 'redirected-state');
    mkdirSync(redirectedState, { recursive: true, mode: 0o700 });
    symlinkSync(redirectedState, join(ctxRoot, 'state'));

    expect(() => isolateAgentClaudeHome('worker', { sourceClaudeHome }))
      .toThrow('isolated Claude path contains a symlink component');
    expect(() => readFileSync(join(redirectedState, 'worker', 'claude-home', '.claude.json'), 'utf-8')).toThrow();
  });
});

describe('isolate-agent-claude-home credential-class scan', () => {
  it.each([
    ['sk-ant-', { futureCredential: 'sk-ant-fixture-value' }],
    ['oauth-token', { futureCredential: 'oauth-token-fixture-value' }],
    ['access_token', { nested: { access_token: 'fixture-value' } }],
    ['refresh_token', { nested: { refresh_token: 'fixture-value' } }],
  ])('throws on serialized credential class %s without echoing the value', (tokenClass, config) => {
    let message = '';
    try {
      isolate(config);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain(tokenClass);
    expect(message).not.toContain('fixture-value');
    expect(message).not.toContain('sk-ant-fixture-value');
    expect(message).not.toContain('oauth-token-fixture-value');
    expect(() => readFileSync(targetClaudeJson(), 'utf-8')).toThrow();
  });

  it('catches a new unknown credential-shaped key outside the fixed delete list', () => {
    expect(() => isolate({ future_auth: { access_token: 'fixture-secret' } }))
      .toThrow('access_token');
  });

  it('passes a representative current clean config after known-key and bridge stripping', () => {
    isolate({
      theme: 'dark',
      oauthAccount: { token: 'known-key-value' },
      claudeCodeFirstTokenDate: '2026-01-01',
      overageCreditGrantCache: { enabled: false },
      claudeAiMcpEverConnected: true,
      projects: { '/fixture/project': { allowedTools: [] } },
      mcpServers: {
        unrestrict: stdioServer(),
        'claude.ai connector': { type: 'connector', url: 'https://example.test/bridge' },
      },
    });

    const serialized = readFileSync(targetClaudeJson(), 'utf-8');
    expect(serialized).not.toContain('oauthAccount');
    expect(serialized).not.toContain('claudeCodeFirstTokenDate');
    expect(serialized).not.toContain('overageCreditGrantCache');
    expect(serialized).not.toContain('claudeAiMcpEverConnected');
    expect(serialized).not.toContain('claude.ai connector');
    expect(serialized).toContain('unrestrict');
  });
});
