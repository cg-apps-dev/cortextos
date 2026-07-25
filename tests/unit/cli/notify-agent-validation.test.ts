import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { busCommand } from '../../../src/cli/bus';

let frameworkRoot: string;
let instanceId: string;
let originalFrameworkRoot: string | undefined;
let originalProjectRoot: string | undefined;
let originalInstanceId: string | undefined;
let originalAgentName: string | undefined;
let originalOrg: string | undefined;

function mockExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__PROCESS_EXIT_${code}__`);
  }) as never);
}

beforeEach(() => {
  frameworkRoot = mkdtempSync(join(tmpdir(), 'notify-agent-fw-'));
  instanceId = `notify-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  originalFrameworkRoot = process.env.CTX_FRAMEWORK_ROOT;
  originalProjectRoot = process.env.CTX_PROJECT_ROOT;
  originalInstanceId = process.env.CTX_INSTANCE_ID;
  originalAgentName = process.env.CTX_AGENT_NAME;
  originalOrg = process.env.CTX_ORG;

  process.env.CTX_FRAMEWORK_ROOT = frameworkRoot;
  process.env.CTX_PROJECT_ROOT = frameworkRoot;
  process.env.CTX_INSTANCE_ID = instanceId;
  process.env.CTX_AGENT_NAME = 'codex-dev-agent';
  process.env.CTX_ORG = 'clean-green-marketing';
  mkdirSync(join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents', 'codex-dev-agent'), { recursive: true });
  mkdirSync(join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents', 'the-orchestrator'), { recursive: true });

  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  if (originalFrameworkRoot === undefined) delete process.env.CTX_FRAMEWORK_ROOT;
  else process.env.CTX_FRAMEWORK_ROOT = originalFrameworkRoot;
  if (originalProjectRoot === undefined) delete process.env.CTX_PROJECT_ROOT;
  else process.env.CTX_PROJECT_ROOT = originalProjectRoot;
  if (originalInstanceId === undefined) delete process.env.CTX_INSTANCE_ID;
  else process.env.CTX_INSTANCE_ID = originalInstanceId;
  if (originalAgentName === undefined) delete process.env.CTX_AGENT_NAME;
  else process.env.CTX_AGENT_NAME = originalAgentName;
  if (originalOrg === undefined) delete process.env.CTX_ORG;
  else process.env.CTX_ORG = originalOrg;

  rmSync(frameworkRoot, { recursive: true, force: true });
  rmSync(join(homedir(), '.cortextos', instanceId), { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('bus notify-agent target validation', () => {
  it('hard-fails unknown target agents before creating a state directory', async () => {
    const exitSpy = mockExit();

    await expect(busCommand.parseAsync([
      'node', 'bus', 'notify-agent', 'ghost-agent', 'wake up',
    ])).rejects.toThrow('__PROCESS_EXIT_1__');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(existsSync(join(homedir(), '.cortextos', instanceId, 'state', 'ghost-agent'))).toBe(false);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Invalid target agent 'ghost-agent'"));
  });

  it('hard-fails unsafe target names before filesystem writes', async () => {
    const exitSpy = mockExit();

    await expect(busCommand.parseAsync([
      'node', 'bus', 'notify-agent', '../ghost', 'wake up',
    ])).rejects.toThrow('__PROCESS_EXIT_1__');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(existsSync(join(homedir(), '.cortextos', instanceId, 'state', '..', 'ghost'))).toBe(false);
  });
});
