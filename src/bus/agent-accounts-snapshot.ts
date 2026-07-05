import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync, ensureDir } from '../utils/atomic.js';
import {
  hashAgentEnvToken,
  resolveAgentAccount,
  resolveOAuthAccountByTokenHash,
} from '../daemon/cron-capacity-gate.js';
import { hashLiveProcessToken } from '../utils/live-token-hash.js';
import {
  type AgentClusterRow,
  type CandidateMap,
  computePromotionCandidates,
  deriveTiers,
  type OverrideMap,
  type PromotionCandidate,
  type PromotionUsageRow,
  type Tier,
} from './account-tiers.js';

export interface AgentAccountEntry {
  org: string;
  agent: string;
  account: string | null;
  source: string | null;
  reason?: string;
  env_cluster_id: string | null;
  live_cluster_id: string | null;
  pending_restart: boolean;
  pkce_match: boolean;
  cluster_id: string | null;
  cluster_size: number;
  label_consistent: boolean;
  tier: Tier;
  billing_account?: string;
  override_note?: string;
  promotion_candidate?: PromotionCandidate;
}

export interface AgentAccountsSnapshotOptions {
  agentPids?: Record<string, number | undefined>;
  securityOverridePath?: string;
  snapshotIntervalMs?: number;
}

interface RawOverrideFile {
  generated_at?: string;
  overrides?: OverrideMap;
}

type OverrideReadResult =
  | { source: 'absent'; overrides: OverrideMap }
  | { source: 'ok'; overrides: OverrideMap }
  | { source: 'error'; overrides: OverrideMap };

interface RawUsageSnapshot {
  accounts?: PromotionUsageRow[];
}

const DEFAULT_SECURITY_OVERRIDE_RELATIVE_PATH = join(
  'orgs',
  'clean-green-marketing',
  'agents',
  'security-agent',
  'account-label-overrides.json',
);

const TOKEN_SHAPED_OUTPUT = /sk-ant-(?:oat01|api03|sid01)-|[A-Za-z0-9_-]{40,}/;

export class AgentAccountsSnapshotLeakError extends Error {
  constructor() {
    super('agent accounts snapshot refused unsafe token-shaped output');
    this.name = 'AgentAccountsSnapshotLeakError';
  }
}

export function assertAgentAccountsSnapshotOutputSafe(serialized: string): void {
  if (TOKEN_SHAPED_OUTPUT.test(serialized)) {
    throw new AgentAccountsSnapshotLeakError();
  }
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOverrides(path: string): OverrideReadResult {
  if (!existsSync(path)) return { source: 'absent', overrides: {} };
  try {
    const raw = readJson(path) as RawOverrideFile;
    if (!isRecord(raw) || !isRecord(raw.overrides)) return { source: 'error', overrides: {} };
    const overrides: OverrideMap = {};
    for (const [key, value] of Object.entries(raw.overrides)) {
      if (key.startsWith('_')) continue;
      if (!isRecord(value)) continue;
      const tier = value.tier;
      const billingAccount = value.billing_account;
      const note = value.note;
      const setAt = value.set_at;
      overrides[key] = {
        ...(tier === 'CONFIRMED-PKCE' || tier === 'CONFIRMED-CORRELATION' || tier === 'ASSERTED' || tier === 'UNVERIFIED'
          ? { tier }
          : {}),
        ...(typeof billingAccount === 'string' ? { billing_account: billingAccount } : {}),
        ...(typeof note === 'string' ? { note } : {}),
        ...(typeof setAt === 'string' ? { set_at: setAt } : {}),
      };
    }
    return { source: 'ok', overrides };
  } catch {
    return { source: 'error', overrides: {} };
  }
}

function readPromotionUsage(path: string): PromotionUsageRow[] {
  try {
    const raw = readJson(path) as RawUsageSnapshot;
    if (!isRecord(raw) || !Array.isArray(raw.accounts)) return [];
    return raw.accounts.filter((row): row is PromotionUsageRow => isRecord(row) && typeof row.account === 'string');
  } catch {
    return [];
  }
}

function candidateMap(candidates: PromotionCandidate[]): CandidateMap {
  const map: CandidateMap = {};
  for (const candidate of candidates) {
    map[candidate.cluster_id] = candidate;
  }
  return map;
}

export function isPendingRestart(liveClusterId: string | null, envClusterId: string | null): boolean {
  return liveClusterId !== null && envClusterId !== null && liveClusterId !== envClusterId;
}

export function writeAgentAccountsSnapshot(
  ctxRoot: string,
  frameworkRoot: string,
  options: AgentAccountsSnapshotOptions = {},
): number | null {
  try {
    const orgsDir = join(frameworkRoot, 'orgs');
    const baseEntries: Array<{
      org: string;
      agent: string;
      account: string | null;
      source: string | null;
      reason?: string;
      env_cluster_id: string | null;
      live_cluster_id: string | null;
      pending_restart: boolean;
      pkce_match: boolean;
      cluster_id: string | null;
    }> = [];

    for (const org of readdirSync(orgsDir)) {
      const agentsDir = join(orgsDir, org, 'agents');
      if (!existsSync(agentsDir)) continue;
      if (!statSync(agentsDir).isDirectory()) continue;

      for (const agent of readdirSync(agentsDir)) {
        const agentDir = join(agentsDir, agent);
        if (!statSync(agentDir).isDirectory()) continue;

        const resolution = resolveAgentAccount(agentDir, ctxRoot);
        const env_cluster_id = hashAgentEnvToken(agentDir);
        const pid = options.agentPids?.[agent];
        const live_cluster_id = typeof pid === 'number' ? hashLiveProcessToken(pid) : null;
        const cluster_id = live_cluster_id ?? env_cluster_id;
        const livePkceAccount = resolveOAuthAccountByTokenHash(ctxRoot, live_cluster_id);
        baseEntries.push({
          org,
          agent,
          account: livePkceAccount ?? resolution.label,
          source: resolution.source ?? null,
          ...(resolution.reason ? { reason: resolution.reason } : {}),
          env_cluster_id,
          live_cluster_id,
          pending_restart: isPendingRestart(live_cluster_id, env_cluster_id),
          pkce_match: livePkceAccount !== null,
          cluster_id,
        });
      }
    }

    const rows: AgentClusterRow[] = baseEntries.map((entry) => ({
      agent: entry.agent,
      account: entry.account,
      cluster_id: entry.cluster_id,
      pkce_match: entry.pkce_match,
      source: entry.source,
    }));
    const currentUsage = readPromotionUsage(join(ctxRoot, 'state', 'usage', 'multi-account-usage.json'));
    const priorUsage = readPromotionUsage(join(ctxRoot, 'state', 'usage', 'multi-account-usage.previous.json'));
    const promotion_candidates = computePromotionCandidates(rows, currentUsage, priorUsage);
    const overrideRead = readOverrides(options.securityOverridePath ?? join(frameworkRoot, DEFAULT_SECURITY_OVERRIDE_RELATIVE_PATH));
    const tierResults = deriveTiers(rows, overrideRead.overrides, candidateMap(promotion_candidates));
    const tierByAgent = new Map(tierResults.map((result) => [result.agent, result]));
    const agents: AgentAccountEntry[] = baseEntries.map((entry) => {
      const tier = tierByAgent.get(entry.agent);
      return {
        ...entry,
        account: tier?.account ?? entry.account,
        tier: tier?.tier ?? 'UNVERIFIED',
        cluster_size: tier?.cluster_size ?? 1,
        label_consistent: tier?.label_consistent ?? true,
        ...(tier?.override?.billing_account ? { billing_account: tier.override.billing_account } : {}),
        ...(tier?.override?.note ? { override_note: tier.override.note } : {}),
        ...(tier?.promotion_candidate ? { promotion_candidate: tier.promotion_candidate } : {}),
      };
    });

    const usageDir = join(ctxRoot, 'state', 'usage');
    ensureDir(usageDir);
    const serialized = JSON.stringify({
      generated_at: new Date().toISOString(),
      ...(typeof options.snapshotIntervalMs === 'number' ? { snapshot_interval_ms: options.snapshotIntervalMs } : {}),
      ...(overrideRead.source === 'error' ? { override_source: 'error', override_unreadable: true } : {}),
      promotion_candidates,
      agents,
    }, null, 2);
    assertAgentAccountsSnapshotOutputSafe(serialized);
    atomicWriteSync(join(usageDir, 'agent-accounts.json'), serialized);
    return agents.length;
  } catch (err) {
    if (err instanceof AgentAccountsSnapshotLeakError) throw err;
    return null;
  }
}
