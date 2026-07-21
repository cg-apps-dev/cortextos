import { describe, expect, it, vi } from 'vitest';
import { getLiveAgentSetFromDaemon } from '../../../src/cli/list-agents';

describe('getLiveAgentSetFromDaemon', () => {
  it('returns daemon live agent names from IPC list-agents', async () => {
    const send = vi.fn().mockResolvedValue({
      success: true,
      data: ['codex-dev-agent', 'claude-dev-agent', 42, null],
    });

    const liveAgents = await getLiveAgentSetFromDaemon('test-instance', { send } as any, 25);

    expect(send).toHaveBeenCalledWith(
      { type: 'list-agents', source: 'cortextos list-agents' },
      25,
    );
    expect(liveAgents).toEqual(new Set(['codex-dev-agent', 'claude-dev-agent']));
  });

  it('returns undefined when daemon IPC is unreachable', async () => {
    const send = vi.fn().mockResolvedValue({
      success: false,
      error: 'Daemon is not running',
    });

    await expect(
      getLiveAgentSetFromDaemon('test-instance', { send } as any, 25),
    ).resolves.toBeUndefined();
  });

  it('returns undefined when daemon IPC times out or throws', async () => {
    const send = vi.fn().mockRejectedValue(new Error('IPC request timed out'));

    await expect(
      getLiveAgentSetFromDaemon('test-instance', { send } as any, 25),
    ).resolves.toBeUndefined();
  });
});
