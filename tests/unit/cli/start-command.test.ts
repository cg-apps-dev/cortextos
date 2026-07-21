import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const {
  mockHomedir,
  mockIpcSend,
  mockIpcIsDaemonRunning,
} = vi.hoisted(() => ({
  mockHomedir: vi.fn(),
  mockIpcSend: vi.fn(),
  mockIpcIsDaemonRunning: vi.fn(),
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: mockHomedir,
  };
});

vi.mock('../../../src/daemon/ipc-server.js', () => {
  class MockIPCClient {
    send = mockIpcSend;
    isDaemonRunning = mockIpcIsDaemonRunning;
  }
  return { IPCClient: MockIPCClient };
});

import { startCommand } from '../../../src/cli/start';

describe('cortextos start agent auto-register guard', () => {
  let homeDir: string;
  let projectRoot: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    homeDir = join(tmpdir(), `cortextos-start-home-${Date.now()}-${Math.random()}`);
    projectRoot = join(tmpdir(), `cortextos-start-project-${Date.now()}-${Math.random()}`);
    mkdirSync(homeDir, { recursive: true });
    mkdirSync(projectRoot, { recursive: true });
    mockHomedir.mockReturnValue(homeDir);
    mockIpcSend.mockReset().mockResolvedValue({ success: true, data: 'started' });
    mockIpcIsDaemonRunning.mockReset().mockResolvedValue(true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__TEST_PROCESS_EXIT_${code}__`);
    }) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function enabledPath(): string {
    return join(homeDir, '.cortextos', 'test', 'config', 'enabled-agents.json');
  }

  function writeEnabledAgents(value: Record<string, unknown>): void {
    const path = enabledPath();
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  }

  it('rejects malformed agent names before writing enabled-agents.json', async () => {
    const original = { existing: { enabled: true, org: 'acme' } };
    writeEnabledAgents(original);

    await expect(
      startCommand.parseAsync(['node', 'start', 'a b c', '--instance', 'test'], { from: 'node' }),
    ).rejects.toThrow(/__TEST_PROCESS_EXIT_1__/);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid agent name 'a b c'"));
    expect(JSON.parse(readFileSync(enabledPath(), 'utf-8'))).toEqual(original);
    expect(mockIpcSend).not.toHaveBeenCalled();
  });

  it('rejects valid-slug unknown agents before writing enabled-agents.json', async () => {
    const original = { existing: { enabled: true, org: 'acme' } };
    writeEnabledAgents(original);

    await expect(
      startCommand.parseAsync(['node', 'start', 'bogus-nonexistent', '--instance', 'test'], { from: 'node' }),
    ).rejects.toThrow(/__TEST_PROCESS_EXIT_1__/);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Unknown agent 'bogus-nonexistent'"));
    expect(JSON.parse(readFileSync(enabledPath(), 'utf-8'))).toEqual(original);
    expect(mockIpcSend).not.toHaveBeenCalled();
  });

  it('auto-registers and starts a real agent directory as before', async () => {
    mkdirSync(join(projectRoot, 'orgs', 'acme', 'agents', 'worker'), { recursive: true });

    await startCommand.parseAsync(['node', 'start', 'worker', '--instance', 'test'], { from: 'node' });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(existsSync(enabledPath())).toBe(true);
    expect(JSON.parse(readFileSync(enabledPath(), 'utf-8'))).toEqual({
      worker: {
        enabled: true,
        status: 'configured',
        org: 'acme',
      },
    });
    expect(mockIpcSend).toHaveBeenCalledWith({
      type: 'start-agent',
      agent: 'worker',
      source: 'cortextos start',
    });
    expect(logSpy).toHaveBeenCalledWith('  Registered worker in enabled-agents.json');
  });
});
