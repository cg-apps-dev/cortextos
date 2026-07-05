import { describe, expect, it, vi } from 'vitest';
import {
  createAgentAccountsSnapshotLoop,
  getAgentPidMap,
} from '../../../src/daemon/agent-accounts-snapshot-loop';
import type { AgentStatus } from '../../../src/types/index';

function provider(statuses: AgentStatus[]) {
  return { getAllStatuses: () => statuses };
}

describe('agent accounts snapshot daemon loop', () => {
  it('builds the live PID map from running daemon AgentProcess statuses', () => {
    expect(getAgentPidMap(provider([
      { name: 'alpha-agent', status: 'running', pid: 111 },
      { name: 'beta-agent', status: 'stopped', pid: 222 },
      { name: 'gamma-agent', status: 'running' },
      { name: 'delta-agent', status: 'running', pid: 333 },
    ]))).toEqual({
      'alpha-agent': 111,
      'delta-agent': 333,
    });
  });

  it('passes daemon PIDs and snapshot cadence to the writer', () => {
    const writer = vi.fn(() => 2);
    const logs: string[] = [];
    const loop = createAgentAccountsSnapshotLoop({
      agentManager: provider([
        { name: 'alpha-agent', status: 'running', pid: 111 },
        { name: 'beta-agent', status: 'running', pid: 222 },
      ]),
      ctxRoot: '/ctx',
      frameworkRoot: '/framework',
      intervalMs: 45_000,
      writer,
      logger: (message) => logs.push(message),
    });

    loop.runOnce();

    expect(writer).toHaveBeenCalledWith('/ctx', '/framework', {
      agentPids: {
        'alpha-agent': 111,
        'beta-agent': 222,
      },
      snapshotIntervalMs: 45_000,
    });
    expect(logs).toEqual(['[agent-accounts-snapshot] wrote 2 agents']);
  });

  it('scrubs daemon error logs instead of emitting token bytes or ps buffers', () => {
    const token = 'sk-ant-daemon-live-token';
    const psBuffer = `node agent CLAUDE_CODE_OAUTH_TOKEN=${token} OTHER_SECRET=value`;
    const logs: string[] = [];
    const loop = createAgentAccountsSnapshotLoop({
      agentManager: provider([{ name: 'alpha-agent', status: 'running', pid: 111 }]),
      ctxRoot: '/ctx',
      frameworkRoot: '/framework',
      writer: () => {
        throw new Error(`ps failed: ${psBuffer}`);
      },
      logger: (message) => logs.push(message),
    });

    loop.runOnce();

    const joined = logs.join('\n');
    expect(joined).toBe('[agent-accounts-snapshot] write failed');
    expect(joined).not.toContain(token);
    expect(joined).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(joined).not.toContain('OTHER_SECRET=value');
    expect(joined).not.toContain(psBuffer);
  });
});
