import { afterEach, describe, it, expect, vi } from 'vitest';

// node-pty is native; stub it so constructing AgentPTY never touches it.
vi.mock('node-pty', () => ({ spawn: vi.fn() }));

// existsSync=false → the local/*.md system-prompt block is skipped in buildClaudeArgs.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    rmSync: vi.fn(),
  };
});

const fs = await import('fs');
const { AgentPTY, enforceIsolatedClaudeCredentialEnv } = await import('../../../src/pty/agent-pty.js');

const mockEnv = {
  instanceId: 'test',
  ctxRoot: '/tmp/test-ctx',
  frameworkRoot: '/tmp/fw',
  agentName: 'alice',
  agentDir: '/tmp/fw/orgs/acme/agents/alice',
  org: 'acme',
  projectRoot: '/tmp/fw',
} as any;

function argsFor(config: any): string[] {
  const pty = new AgentPTY(mockEnv, config);
  return (pty as unknown as { buildClaudeArgs(m: 'fresh' | 'continue', p: string): string[] })
    .buildClaudeArgs('fresh', 'PROMPT');
}

describe('AgentPTY --dangerously-skip-permissions toggle', () => {
  it('includes the flag by default (back-compat: skip stays ON)', () => {
    expect(argsFor({})).toContain('--dangerously-skip-permissions');
  });

  it('includes the flag when dangerously_skip_permissions is explicitly true', () => {
    expect(argsFor({ dangerously_skip_permissions: true })).toContain('--dangerously-skip-permissions');
  });

  it('does NOT include the flag when dangerously_skip_permissions is false (permission gate engaged)', () => {
    expect(argsFor({ dangerously_skip_permissions: false })).not.toContain('--dangerously-skip-permissions');
  });

  it('includes the flag when dangerously_skip_permissions is explicitly undefined (treated as default)', () => {
    expect(argsFor({ dangerously_skip_permissions: undefined })).toContain('--dangerously-skip-permissions');
  });

  it('fails safe (keeps the flag) and warns on a non-boolean value, e.g. the string "false"', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // A typo'd string must NOT silently disable the skip flag.
      expect(argsFor({ dangerously_skip_permissions: 'false' as any })).toContain('--dangerously-skip-permissions');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('AgentPTY isolated Claude config guard', () => {
  const goodToken = `sk-ant-oat01-${'A'.repeat(95)}`;

  it('removes shared fallback credentials when CLAUDE_CONFIG_DIR is isolated and token is valid', () => {
    vi.mocked(fs.rmSync).mockClear();
    enforceIsolatedClaudeCredentialEnv({
      CLAUDE_CONFIG_DIR: '/tmp/agent-home',
      CLAUDE_CODE_OAUTH_TOKEN: goodToken,
    }, 'alice');
    expect(fs.rmSync).toHaveBeenCalledWith('/tmp/agent-home/.credentials.json', { force: true });
  });

  it('rejects isolated spawn when the bearer token is missing or malformed', () => {
    vi.mocked(fs.rmSync).mockClear();
    expect(() => enforceIsolatedClaudeCredentialEnv({
      CLAUDE_CONFIG_DIR: '/tmp/agent-home',
      CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-short',
    }, 'alice')).toThrow(/requires a 108-char/);
    expect(fs.rmSync).not.toHaveBeenCalled();
  });

  it('does not enforce bearer credentials for non-isolated agents', () => {
    vi.mocked(fs.rmSync).mockClear();
    enforceIsolatedClaudeCredentialEnv({}, 'alice');
    expect(fs.rmSync).not.toHaveBeenCalled();
  });
});

type MockPty = {
  pid: number;
  write: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
};

function makeMockPty(): MockPty {
  return {
    pid: 123,
    write: vi.fn(),
    onData: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onExit: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    kill: vi.fn(),
    resize: vi.fn(),
  };
}

function makePromptPollingAgent(options: {
  recent: () => string;
  bootstrapped?: () => boolean;
}): { agent: InstanceType<typeof AgentPTY>; mockPty: MockPty } {
  const agent = new AgentPTY(mockEnv, {});
  const mockPty = makeMockPty();
  (agent as unknown as { spawnFn: unknown }).spawnFn = vi.fn().mockReturnValue(mockPty);
  (agent as unknown as { outputBuffer: unknown }).outputBuffer = {
    push: vi.fn(),
    getRecent: options.recent,
    isBootstrapped: options.bootstrapped || (() => false),
  };
  return { agent, mockPty };
}

describe('AgentPTY Claude Code first-run prompt auto-accept', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('selects Yes on the Bypass Permissions screen with Down-arrow then Enter', async () => {
    vi.useFakeTimers();
    const { agent, mockPty } = makePromptPollingAgent({
      recent: () => 'Bypass Permissions mode\n1. No, exit\n2. Yes, I accept',
    });

    await agent.spawn('fresh', 'PROMPT');
    await vi.advanceTimersByTimeAsync(1200);
    expect(mockPty.write).toHaveBeenCalledTimes(1);
    expect(mockPty.write).toHaveBeenNthCalledWith(1, '\x1b[B');

    await vi.advanceTimersByTimeAsync(350);
    expect(mockPty.write).toHaveBeenCalledTimes(2);
    expect(mockPty.write).toHaveBeenNthCalledWith(2, '\r');
    expect(mockPty.write.mock.calls).not.toEqual([['\r']]);
  });

  it('accepts the trust-folder screen with a bare Enter', async () => {
    vi.useFakeTimers();
    const { agent, mockPty } = makePromptPollingAgent({
      recent: () => 'Do you trust this folder?',
    });

    await agent.spawn('fresh', 'PROMPT');
    await vi.advanceTimersByTimeAsync(1200);

    expect(mockPty.write).toHaveBeenCalledTimes(1);
    expect(mockPty.write).toHaveBeenCalledWith('\r');
  });

  it('does not write a stray keystroke for normal output', async () => {
    vi.useFakeTimers();
    const { agent, mockPty } = makePromptPollingAgent({
      recent: () => 'Starting Claude Code...',
    });

    await agent.spawn('fresh', 'PROMPT');
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockPty.write).not.toHaveBeenCalled();
  });

  it('handles the bypass screen only once while it persists across polls', async () => {
    vi.useFakeTimers();
    const { agent, mockPty } = makePromptPollingAgent({
      recent: () => 'Bypass Permissions mode\n1. No, exit\n2. Yes, I accept',
    });

    await agent.spawn('fresh', 'PROMPT');
    await vi.advanceTimersByTimeAsync(1200);
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockPty.write.mock.calls).toEqual([['\x1b[B'], ['\r']]);
  });

  it('stops polling after the session is bootstrapped', async () => {
    vi.useFakeTimers();
    let recent = 'Claude ready';
    const { agent, mockPty } = makePromptPollingAgent({
      recent: () => recent,
      bootstrapped: () => true,
    });

    await agent.spawn('fresh', 'PROMPT');
    await vi.advanceTimersByTimeAsync(1200);
    recent = 'Bypass Permissions mode\n1. No, exit\n2. Yes, I accept';
    await vi.advanceTimersByTimeAsync(5000);

    expect(mockPty.write).not.toHaveBeenCalled();
  });
});
