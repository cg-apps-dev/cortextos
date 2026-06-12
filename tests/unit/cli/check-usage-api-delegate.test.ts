import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockSpawnSync = vi.hoisted(() => vi.fn());

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawnSync: mockSpawnSync,
  };
});

import { busCommand } from '../../../src/cli/bus';

let frameworkRoot: string;
let originalFrameworkRoot: string | undefined;
let originalProjectRoot: string | undefined;
let originalAgentDir: string | undefined;
let originalAgentName: string | undefined;

function mockExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__PROCESS_EXIT_${code}__`);
  }) as never);
}

beforeEach(() => {
  frameworkRoot = mkdtempSync(join(tmpdir(), 'check-usage-api-fw-'));
  originalFrameworkRoot = process.env.CTX_FRAMEWORK_ROOT;
  originalProjectRoot = process.env.CTX_PROJECT_ROOT;
  originalAgentDir = process.env.CTX_AGENT_DIR;
  originalAgentName = process.env.CTX_AGENT_NAME;

  process.env.CTX_FRAMEWORK_ROOT = frameworkRoot;
  process.env.CTX_PROJECT_ROOT = frameworkRoot;
  process.env.CTX_AGENT_NAME = 'agent';
  delete process.env.CTX_AGENT_DIR;

  mockSpawnSync.mockReset();
  mockSpawnSync.mockReturnValue({ status: 0 });
});

afterEach(() => {
  if (originalFrameworkRoot !== undefined) process.env.CTX_FRAMEWORK_ROOT = originalFrameworkRoot;
  else delete process.env.CTX_FRAMEWORK_ROOT;

  if (originalProjectRoot !== undefined) process.env.CTX_PROJECT_ROOT = originalProjectRoot;
  else delete process.env.CTX_PROJECT_ROOT;

  if (originalAgentDir !== undefined) process.env.CTX_AGENT_DIR = originalAgentDir;
  else delete process.env.CTX_AGENT_DIR;

  if (originalAgentName !== undefined) process.env.CTX_AGENT_NAME = originalAgentName;
  else delete process.env.CTX_AGENT_NAME;

  try { rmSync(frameworkRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  vi.restoreAllMocks();
});

describe('bus check-usage-api', () => {
  it('delegates accepted flags to the canonical bash script and propagates exit status', async () => {
    mockSpawnSync.mockReturnValue({ status: 7 });
    const exitSpy = mockExit();

    await expect(busCommand.parseAsync([
      'node', 'bus', 'check-usage-api',
      '--warn-7day', '82',
      '--force',
      '--warn-5h', '91',
      '--chat-id', '12345',
    ])).rejects.toThrow('__PROCESS_EXIT_7__');

    expect(mockSpawnSync).toHaveBeenCalledWith('bash', [
      join(frameworkRoot, 'bus', 'check-usage-api.sh'),
      '--warn-7day', '82',
      '--force',
      '--warn-5h', '91',
      '--chat-id', '12345',
    ], { stdio: 'inherit' });
    expect(exitSpy).toHaveBeenCalledWith(7);
  });

  it('rejects options unsupported by the bash script', async () => {
    const exitSpy = mockExit();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(busCommand.parseAsync([
      'node', 'bus', 'check-usage-api',
      '--account', 'default',
    ])).rejects.toThrow('__PROCESS_EXIT_1__');

    expect(errSpy).toHaveBeenCalledWith('Unknown option: --account');
    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
