import { drainSwitchQueue, type QueueEntryRecord, type SwitchQueueOps } from '../bus/switch-queue-core';

interface DrainOptions {
  ctxRoot: string;
  json?: boolean;
}

export async function drainSwitchQueueCli(options: DrainOptions, ops?: SwitchQueueOps): Promise<QueueEntryRecord[]> {
  const previousCtxRoot = process.env.CTX_ROOT;
  process.env.CTX_ROOT = options.ctxRoot;
  try {
    return await drainSwitchQueue(ops);
  } finally {
    if (previousCtxRoot === undefined) {
      delete process.env.CTX_ROOT;
    } else {
      process.env.CTX_ROOT = previousCtxRoot;
    }
  }
}
