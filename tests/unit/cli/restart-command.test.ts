/**
 * Unit-test parity for the `cortextos restart <agent>` subcommand
 * (issue #328). Companion to lifecycle-markers.test.ts which already
 * covers writeStopMarker — restart re-uses that helper, so this file
 * pins the command-level wiring (name, required argument, --instance
 * option, description) instead of duplicating the marker-write tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockIpcSend,
  mockIpcIsDaemonRunning,
  mockWriteStopMarker,
} = vi.hoisted(() => ({
  mockIpcSend: vi.fn(),
  mockIpcIsDaemonRunning: vi.fn(),
  mockWriteStopMarker: vi.fn(),
}));

vi.mock('../../../src/daemon/ipc-server.js', () => {
  class MockIPCClient {
    send = mockIpcSend;
    isDaemonRunning = mockIpcIsDaemonRunning;
  }
  return { IPCClient: MockIPCClient };
});

vi.mock('../../../src/cli/stop.js', () => ({
  writeStopMarker: mockWriteStopMarker,
}));

import { restartCommand } from '../../../src/cli/restart';

describe('issue #328: cortextos restart <agent>', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockIpcSend.mockReset();
    mockIpcIsDaemonRunning.mockReset().mockResolvedValue(true);
    mockWriteStopMarker.mockReset();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('is registered as `restart`', () => {
    expect(restartCommand.name()).toBe('restart');
  });

  it('requires the <agent> positional argument', () => {
    // commander stores arg metadata on _args / registeredArguments depending on
    // version; both expose .required on the registered argument.
    const args = (restartCommand as unknown as { registeredArguments: { required: boolean; name: () => string }[] }).registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0].required).toBe(true);
    expect(args[0].name()).toBe('agent');
  });

  it('accepts --instance with a default of "default"', () => {
    const opts = restartCommand.opts();
    expect(opts.instance).toBe('default');
  });

  it('describes itself as a stop+start (not a daemon restart)', () => {
    // The description must make clear this does NOT bounce the daemon —
    // operator-facing UX guard so users don't reach for this when they
    // actually need `pm2 restart cortextos-daemon`.
    const desc = restartCommand.description().toLowerCase();
    expect(desc).toContain('stop');
    expect(desc).toContain('start');
    expect(desc).toContain('daemon');
  });

  it('treats QUEUED_BEHIND_STOP from the start phase as a successful queued restart', async () => {
    mockIpcSend
      .mockResolvedValueOnce({ success: true, data: 'Stopping alice' })
      .mockResolvedValueOnce({
        success: false,
        code: 'QUEUED_BEHIND_STOP',
        error: 'start request for "alice" queued behind an in-flight stop; agent will restart shortly',
      });

    await restartCommand.parseAsync(['node', 'restart', 'alice'], { from: 'node' });

    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Start failed'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Agent is now stopped'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('queued behind an in-flight stop'));
    expect(mockIpcSend).toHaveBeenNthCalledWith(
      1,
      { type: 'stop-agent', agent: 'alice', source: 'cortextos restart' },
    );
    expect(mockIpcSend).toHaveBeenNthCalledWith(
      2,
      { type: 'start-agent', agent: 'alice', source: 'cortextos restart' },
    );
  });
});
