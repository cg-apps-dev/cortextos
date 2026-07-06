import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStatus } from '../../../src/types/index';
import {
  createProbe,
  createRtkContinueDecayAutohealLoop,
  discoverClaudeAgents,
  hasRecentAuthWobble,
  readRtkAutohealState,
  rtkAutohealStatePath,
  writeRtkAutohealState,
  type RtkDiscoveredAgent,
  type RtkHistoryReader,
} from '../../../src/daemon/rtk-continue-decay-autoheal';

function forceFreshPath(ctxRoot: string, agentName: string): string {
  return join(ctxRoot, 'state', agentName, '.force-fresh');
}

function manager(statuses: AgentStatus[]) {
  const injections: Array<{ agent: string; text: string }> = [];
  return {
    injections,
    getAllStatuses: () => statuses,
    injectAgentDetailed: vi.fn((agent: string, text: string) => {
      injections.push({ agent, text });
      return { ok: true as const };
    }),
  };
}

function historyReader(options: {
  recent?: boolean;
  probeTokens?: Set<string>;
} = {}): RtkHistoryReader {
  return {
    hasRecentProjectCommand: vi.fn(() => options.recent ?? false),
    hasProbeToken: vi.fn((token: string) => options.probeTokens?.has(token) ?? false),
  };
}

function discovered(runtime: RtkDiscoveredAgent['runtime'] = 'claude-code'): RtkDiscoveredAgent[] {
  return [{
    name: 'alpha-agent',
    agentDir: '/agents/alpha-agent',
    projectPath: '/agents/alpha-agent',
    runtime,
  }];
}

describe('rtk continue-decay autoheal loop', () => {
  let root: string;
  let ctxRoot: string;
  let frameworkRoot: string;
  let now: number;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rtk-autoheal-test-'));
    ctxRoot = join(root, 'ctx');
    frameworkRoot = join(root, 'framework');
    mkdirSync(join(ctxRoot, 'state'), { recursive: true });
    mkdirSync(frameworkRoot, { recursive: true });
    now = Date.parse('2026-07-06T12:00:00.000Z');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('uses Stage A only to inject a logged-command probe, never to arm force-fresh', () => {
    const fakeManager = manager([{ name: 'alpha-agent', status: 'running', pid: 111 }]);
    const loop = createRtkContinueDecayAutohealLoop({
      agentManager: fakeManager,
      ctxRoot,
      frameworkRoot,
      nowMs: () => now,
      historyReader: historyReader({ recent: false }),
      discoverAgents: () => discovered(),
      logger: () => undefined,
    });

    loop.runOnce();

    expect(fakeManager.injectAgentDetailed).toHaveBeenCalledTimes(1);
    expect(existsSync(forceFreshPath(ctxRoot, 'alpha-agent'))).toBe(false);
    const state = readRtkAutohealState(ctxRoot);
    expect(state.agents['alpha-agent'].pendingProbe?.token).toMatch(/^RTK_HEAL_PROBE_alpha-agent_/);
  });

  it('keeps the active probe command to a single bare logged ls command', () => {
    const probe = createProbe('alpha.agent', now, '/agents/alpha-agent');

    expect(probe.command).toBe('ls -la /etc/hosts /tmp/RTK_HEAL_PROBE_alpha_agent_1783339200000');
    expect(probe.command).not.toContain('#');
    expect(probe.command).not.toContain('|');
    expect(probe.command).not.toContain('>');
    expect(probe.command).not.toContain('2>&1');
    expect(probe.command).not.toMatch(/\becho\b/);
    expect(probe.command).not.toMatch(/\bsqlite3\b/);
    expect(probe.command).not.toMatch(/\bpython\b/);
    expect(probe.command).not.toMatch(/\bnpm\b/);
    expect(probe.command).not.toMatch(/\bcortextos\s+bus\b/);
  });

  it('clears a pending probe when the marker appears in RTK history', () => {
    const token = 'RTK_HEAL_PROBE_alpha-agent_1783339200000';
    writeRtkAutohealState(ctxRoot, {
      version: 1,
      agents: {
        'alpha-agent': {
          pendingProbe: {
            token,
            command: `ls -la /etc/hosts /tmp/${token}`,
            injectedAt: new Date(now - 5_000).toISOString(),
            projectPath: '/agents/alpha-agent',
          },
        },
      },
    });
    const fakeManager = manager([{ name: 'alpha-agent', status: 'running', pid: 111 }]);
    const loop = createRtkContinueDecayAutohealLoop({
      agentManager: fakeManager,
      ctxRoot,
      frameworkRoot,
      nowMs: () => now,
      historyReader: historyReader({ recent: false, probeTokens: new Set([token]) }),
      discoverAgents: () => discovered(),
      logger: () => undefined,
    });

    loop.runOnce();

    expect(existsSync(forceFreshPath(ctxRoot, 'alpha-agent'))).toBe(false);
    const state = readRtkAutohealState(ctxRoot);
    expect(state.agents['alpha-agent'].pendingProbe).toBeUndefined();
    expect(state.agents['alpha-agent'].lastProbeOkAt).toBe(new Date(now).toISOString());
  });

  it('arms force-fresh after a settled active probe remains absent', () => {
    const token = 'RTK_HEAL_PROBE_alpha-agent_1783339200000';
    writeRtkAutohealState(ctxRoot, {
      version: 1,
      agents: {
        'alpha-agent': {
          pendingProbe: {
            token,
            command: `ls -la /etc/hosts /tmp/${token}`,
            injectedAt: new Date(now - 5_000).toISOString(),
            projectPath: '/agents/alpha-agent',
          },
        },
      },
    });
    const fakeManager = manager([{ name: 'alpha-agent', status: 'running', pid: 111 }]);
    const loop = createRtkContinueDecayAutohealLoop({
      agentManager: fakeManager,
      ctxRoot,
      frameworkRoot,
      nowMs: () => now,
      historyReader: historyReader({ recent: false }),
      discoverAgents: () => discovered(),
      logger: () => undefined,
    });

    loop.runOnce();

    expect(readFileSync(forceFreshPath(ctxRoot, 'alpha-agent'), 'utf-8')).toContain('rtk-reengage');
    const state = readRtkAutohealState(ctxRoot);
    expect(state.agents['alpha-agent'].pendingProbe).toBeUndefined();
    expect(state.agents['alpha-agent'].lastArmAt).toBe(new Date(now).toISOString());
  });

  it('does not arm while a pending probe is still settling', () => {
    const token = 'RTK_HEAL_PROBE_alpha-agent_1783339200000';
    writeRtkAutohealState(ctxRoot, {
      version: 1,
      agents: {
        'alpha-agent': {
          pendingProbe: {
            token,
            command: `ls -la /etc/hosts /tmp/${token}`,
            injectedAt: new Date(now - 1_000).toISOString(),
            projectPath: '/agents/alpha-agent',
          },
        },
      },
    });
    const loop = createRtkContinueDecayAutohealLoop({
      agentManager: manager([{ name: 'alpha-agent', status: 'running', pid: 111 }]),
      ctxRoot,
      frameworkRoot,
      nowMs: () => now,
      historyReader: historyReader({ recent: false }),
      discoverAgents: () => discovered(),
      logger: () => undefined,
    });

    loop.runOnce();

    expect(existsSync(forceFreshPath(ctxRoot, 'alpha-agent'))).toBe(false);
    expect(readRtkAutohealState(ctxRoot).agents['alpha-agent'].pendingProbe).toBeDefined();
  });

  it('skips agents that already have recent RTK history', () => {
    const fakeManager = manager([{ name: 'alpha-agent', status: 'running', pid: 111 }]);
    const loop = createRtkContinueDecayAutohealLoop({
      agentManager: fakeManager,
      ctxRoot,
      frameworkRoot,
      nowMs: () => now,
      historyReader: historyReader({ recent: true }),
      discoverAgents: () => discovered(),
      logger: () => undefined,
    });

    loop.runOnce();

    expect(fakeManager.injectAgentDetailed).not.toHaveBeenCalled();
    expect(existsSync(rtkAutohealStatePath(ctxRoot))).toBe(false);
  });

  it('skips codex and hermes runtimes', () => {
    const fakeManager = manager([{ name: 'alpha-agent', status: 'running', pid: 111 }]);
    for (const runtime of ['codex-app-server', 'hermes'] as const) {
      const loop = createRtkContinueDecayAutohealLoop({
        agentManager: fakeManager,
        ctxRoot,
        frameworkRoot,
        nowMs: () => now,
        historyReader: historyReader({ recent: false }),
        discoverAgents: () => discovered(runtime),
        logger: () => undefined,
      });
      loop.runOnce();
    }

    expect(fakeManager.injectAgentDetailed).not.toHaveBeenCalled();
    expect(existsSync(forceFreshPath(ctxRoot, 'alpha-agent'))).toBe(false);
  });

  it('does not re-arm while force-fresh is already pending', () => {
    mkdirSync(join(ctxRoot, 'state', 'alpha-agent'), { recursive: true });
    writeFileSync(forceFreshPath(ctxRoot, 'alpha-agent'), 'existing\n', 'utf-8');
    const fakeManager = manager([{ name: 'alpha-agent', status: 'running', pid: 111 }]);
    const loop = createRtkContinueDecayAutohealLoop({
      agentManager: fakeManager,
      ctxRoot,
      frameworkRoot,
      nowMs: () => now,
      historyReader: historyReader({ recent: false }),
      discoverAgents: () => discovered(),
      logger: () => undefined,
    });

    loop.runOnce();

    expect(fakeManager.injectAgentDetailed).not.toHaveBeenCalled();
    expect(readFileSync(forceFreshPath(ctxRoot, 'alpha-agent'), 'utf-8')).toBe('existing\n');
  });

  it('does not re-probe during the no-thrash window after a recent arm', () => {
    writeRtkAutohealState(ctxRoot, {
      version: 1,
      agents: {
        'alpha-agent': {
          lastArmAt: new Date(now - 60_000).toISOString(),
        },
      },
    });
    const fakeManager = manager([{ name: 'alpha-agent', status: 'running', pid: 111 }]);
    const loop = createRtkContinueDecayAutohealLoop({
      agentManager: fakeManager,
      ctxRoot,
      frameworkRoot,
      nowMs: () => now,
      historyReader: historyReader({ recent: false }),
      discoverAgents: () => discovered(),
      logger: () => undefined,
    });

    loop.runOnce();

    expect(fakeManager.injectAgentDetailed).not.toHaveBeenCalled();
    expect(existsSync(forceFreshPath(ctxRoot, 'alpha-agent'))).toBe(false);
  });

  it('freezes healing when recent auth diagnostics are present', () => {
    mkdirSync(join(ctxRoot, 'state', 'usage'), { recursive: true });
    writeFileSync(
      join(ctxRoot, 'state', 'usage', 'diagnostics.jsonl'),
      JSON.stringify({ ts: new Date(now - 1_000).toISOString(), error: 'HTTP 401 unauthorized' }) + '\n',
      'utf-8',
    );
    const token = 'RTK_HEAL_PROBE_alpha-agent_1783339200000';
    writeRtkAutohealState(ctxRoot, {
      version: 1,
      agents: {
        'alpha-agent': {
          pendingProbe: {
            token,
            command: `ls -la /etc/hosts /tmp/${token}`,
            injectedAt: new Date(now - 5_000).toISOString(),
            projectPath: '/agents/alpha-agent',
          },
        },
      },
    });

    const loop = createRtkContinueDecayAutohealLoop({
      agentManager: manager([{ name: 'alpha-agent', status: 'running', pid: 111 }]),
      ctxRoot,
      frameworkRoot,
      nowMs: () => now,
      historyReader: historyReader({ recent: false }),
      discoverAgents: () => discovered(),
      logger: () => undefined,
    });

    loop.runOnce();

    expect(hasRecentAuthWobble(ctxRoot, now)).toBe(true);
    expect(existsSync(forceFreshPath(ctxRoot, 'alpha-agent'))).toBe(false);
    expect(readRtkAutohealState(ctxRoot).agents['alpha-agent'].pendingProbe).toBeDefined();
  });

  it('does not freeze on routine pkce-authorize oauth diagnostics without auth failure signals', () => {
    mkdirSync(join(ctxRoot, 'state', 'usage'), { recursive: true });
    const lines = [
      {
        ts: new Date(now - 1_000).toISOString(),
        account: 'seat',
        credential_source: 'pkce-authorize',
        failure: 'impossible-read',
        status: 'suspect',
        error: null,
      },
      {
        ts: new Date(now - 1_000).toISOString(),
        account: 'max',
        credential_source: 'oauth',
        failure: 'impossible-read',
        status: 'suspect',
        error: 'routine suspect-read usage anomaly',
      },
    ].map((line) => JSON.stringify(line)).join('\n');
    writeFileSync(join(ctxRoot, 'state', 'usage', 'diagnostics.jsonl'), `${lines}\n`, 'utf-8');

    expect(hasRecentAuthWobble(ctxRoot, now)).toBe(false);
  });

  it('discovers only Claude runtime agents and uses working_directory as project path', () => {
    const orgAgents = join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents');
    mkdirSync(join(orgAgents, 'claude-agent'), { recursive: true });
    mkdirSync(join(orgAgents, 'default-claude'), { recursive: true });
    mkdirSync(join(orgAgents, 'empty-wd-claude'), { recursive: true });
    mkdirSync(join(orgAgents, 'codex-agent'), { recursive: true });
    mkdirSync(join(orgAgents, 'hermes-agent'), { recursive: true });
    writeFileSync(
      join(orgAgents, 'claude-agent', 'config.json'),
      JSON.stringify({ runtime: 'claude-code', working_directory: '/work/claude' }),
      'utf-8',
    );
    writeFileSync(join(orgAgents, 'default-claude', 'config.json'), '{}', 'utf-8');
    writeFileSync(
      join(orgAgents, 'empty-wd-claude', 'config.json'),
      JSON.stringify({ runtime: 'claude-code', working_directory: '' }),
      'utf-8',
    );
    writeFileSync(
      join(orgAgents, 'codex-agent', 'config.json'),
      JSON.stringify({ runtime: 'codex-app-server' }),
      'utf-8',
    );
    writeFileSync(
      join(orgAgents, 'hermes-agent', 'config.json'),
      JSON.stringify({ runtime: 'hermes' }),
      'utf-8',
    );

    expect(discoverClaudeAgents(frameworkRoot)).toEqual([
      {
        name: 'claude-agent',
        agentDir: join(orgAgents, 'claude-agent'),
        projectPath: '/work/claude',
        runtime: 'claude-code',
      },
      {
        name: 'default-claude',
        agentDir: join(orgAgents, 'default-claude'),
        projectPath: join(orgAgents, 'default-claude'),
        runtime: 'claude-code',
      },
      {
        name: 'empty-wd-claude',
        agentDir: join(orgAgents, 'empty-wd-claude'),
        projectPath: join(orgAgents, 'empty-wd-claude'),
        runtime: 'claude-code',
      },
    ]);
  });
});
