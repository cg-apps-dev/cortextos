import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync, ensureDir } from '../utils/atomic.js';
import { resolveAgentAccount } from '../daemon/cron-capacity-gate.js';

export interface AgentAccountEntry {
  org: string;
  agent: string;
  account: string | null;
  source: string | null;
}

export function writeAgentAccountsSnapshot(ctxRoot: string, frameworkRoot: string): number | null {
  try {
    const orgsDir = join(frameworkRoot, 'orgs');
    const agents: AgentAccountEntry[] = [];

    for (const org of readdirSync(orgsDir)) {
      const agentsDir = join(orgsDir, org, 'agents');
      if (!existsSync(agentsDir)) continue;
      if (!statSync(agentsDir).isDirectory()) continue;

      for (const agent of readdirSync(agentsDir)) {
        const agentDir = join(agentsDir, agent);
        if (!statSync(agentDir).isDirectory()) continue;

        const resolution = resolveAgentAccount(agentDir, ctxRoot);
        agents.push({
          org,
          agent,
          account: resolution.label,
          source: resolution.label ? (resolution.source ?? null) : null,
        });
      }
    }

    const usageDir = join(ctxRoot, 'state', 'usage');
    ensureDir(usageDir);
    atomicWriteSync(join(usageDir, 'agent-accounts.json'), JSON.stringify({
      generated_at: new Date().toISOString(),
      agents,
    }, null, 2));
    return agents.length;
  } catch {
    return null;
  }
}
