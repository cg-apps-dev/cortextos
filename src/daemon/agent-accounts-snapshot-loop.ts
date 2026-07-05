import type { AgentStatus } from '../types/index.js';
import { writeAgentAccountsSnapshot } from '../bus/agent-accounts-snapshot.js';

export const AGENT_ACCOUNTS_SNAPSHOT_INTERVAL_MS = 15 * 60_000;

type Logger = (message: string) => void;
type Writer = typeof writeAgentAccountsSnapshot;

export interface AgentStatusProvider {
  getAllStatuses(): AgentStatus[];
}

export interface AgentAccountsSnapshotLoop {
  start(): void;
  stop(): void;
  runOnce(): void;
}

export interface AgentAccountsSnapshotLoopOptions {
  agentManager: AgentStatusProvider;
  ctxRoot: string;
  frameworkRoot: string;
  intervalMs?: number;
  writer?: Writer;
  logger?: Logger;
}

export function getAgentPidMap(agentManager: AgentStatusProvider): Record<string, number> {
  const pids: Record<string, number> = {};
  for (const status of agentManager.getAllStatuses()) {
    if (status.status !== 'running') continue;
    if (typeof status.pid !== 'number') continue;
    pids[status.name] = status.pid;
  }
  return pids;
}

export function createAgentAccountsSnapshotLoop(
  options: AgentAccountsSnapshotLoopOptions,
): AgentAccountsSnapshotLoop {
  const intervalMs = options.intervalMs ?? AGENT_ACCOUNTS_SNAPSHOT_INTERVAL_MS;
  const writer = options.writer ?? writeAgentAccountsSnapshot;
  const logger = options.logger ?? ((message: string) => console.log(message));
  let timer: ReturnType<typeof setInterval> | null = null;

  const runOnce = (): void => {
    try {
      const count = writer(options.ctxRoot, options.frameworkRoot, {
        agentPids: getAgentPidMap(options.agentManager),
        snapshotIntervalMs: intervalMs,
      });
      if (typeof count === 'number') {
        logger(`[agent-accounts-snapshot] wrote ${count} agents`);
      }
    } catch {
      // Do not include error text here. The daemon live path reads `ps eww`;
      // thrown errors can contain process output, including token bytes.
      logger('[agent-accounts-snapshot] write failed');
    }
  };

  return {
    start(): void {
      if (timer) return;
      runOnce();
      timer = setInterval(runOnce, intervalMs);
    },
    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    runOnce,
  };
}
