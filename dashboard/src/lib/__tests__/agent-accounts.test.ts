import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-accounts-reports-'));
process.env.CTX_ROOT = root;

type Reports = typeof import('../data/reports');
let reports: Reports;

beforeAll(async () => {
  reports = await import('../data/reports');
});

afterAll(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

const usageDir = path.join(root, 'state', 'usage');
beforeEach(() => {
  fs.rmSync(usageDir, { recursive: true, force: true });
  fs.mkdirSync(usageDir, { recursive: true });
  fs.rmSync(path.join(root, 'state', 'usage-monitor'), { recursive: true, force: true });
});

describe('shortAgentName', () => {
  it('strips a leading the- prefix', () => {
    expect(reports.shortAgentName('the-orchestrator')).toBe('orchestrator');
  });

  it('strips a trailing -agent suffix', () => {
    expect(reports.shortAgentName('cro-agent')).toBe('cro');
  });

  it('strips suffix first and then prefix', () => {
    expect(reports.shortAgentName('the-cortextos-dev-agent')).toBe('cortextos-dev');
  });

  it('passes through names with neither marker', () => {
    expect(reports.shortAgentName('research')).toBe('research');
  });
});

describe('getAgentAccounts', () => {
  function writeSnapshot(
    agents: unknown[],
    generatedAt = new Date().toISOString(),
    promotionCandidates: unknown[] = [],
    snapshotIntervalMs?: number,
  ) {
    fs.writeFileSync(path.join(usageDir, 'agent-accounts.json'), JSON.stringify({
      generated_at: generatedAt,
      ...(snapshotIntervalMs ? { snapshot_interval_ms: snapshotIntervalMs } : {}),
      promotion_candidates: promotionCandidates,
      agents,
    }));
  }

  it('returns null when the snapshot is absent', () => {
    expect(reports.getAgentAccounts()).toBeNull();
  });

  it('groups sorted short names by account and surfaces unassigned agents', () => {
    writeSnapshot([
      { org: 'o1', agent: 'meta-ads-agent', account: 'B', source: 'token-match' },
      { org: 'o1', agent: 'the-orchestrator', account: null, source: null },
      { org: 'o1', agent: 'codex-dev-agent', account: null, source: 'runtime-excluded' },
      { org: 'o1', agent: 'cro-agent', account: 'A', source: 'login-marker' },
      { org: 'o1', agent: 'cortextos-dev-agent', account: 'A', source: 'login-marker' },
    ]);

    expect(reports.getAgentAccounts()).toMatchObject({
      byAccount: {
        A: ['cortextos-dev', 'cro'],
        B: ['meta-ads'],
      },
      unassigned: ['orchestrator'],
      codexAgents: ['codex-dev'],
      stale: false,
      promotionCandidates: [],
    });
  });

  it('parses tier metadata and surfaces weakest account tier with stale status', () => {
    const cronDir = path.join(root, 'state', 'usage-monitor');
    fs.mkdirSync(cronDir, { recursive: true });
    fs.writeFileSync(path.join(cronDir, 'crons.json'), JSON.stringify({
      crons: [{ name: 'usage-sync', schedule: '15m', prompt: 'cortextos bus check-all-usage' }],
    }));
    writeSnapshot([
      {
        org: 'o1',
        agent: 'meta-ads-agent',
        account: 'B',
        source: 'override',
        tier: 'ASSERTED',
        cluster_id: 'cluster-a',
        pending_restart: true,
        promotion_candidate: {
          cluster_id: 'cluster-a',
          target_account: 'B',
          seven_day_delta: 3,
          five_hour_pct: 20,
          spend_pct_or_extra_usage: 100,
          no_other_cluster_guard: 'pass',
        },
      },
      {
        org: 'o1',
        agent: 'analyst-agent',
        account: 'B',
        source: 'override',
        tier: 'UNVERIFIED',
        cluster_id: 'cluster-b',
      },
    ], '2026-06-12T12:00:00.000Z');

    const result = reports.getAgentAccounts();

    expect(result?.byAccount.B).toEqual(['analyst', 'meta-ads']);
    expect(result?.accounts.B.tier).toBe('UNVERIFIED');
    expect(result?.accounts.B.stale).toBe(true);
    expect(result?.accounts.B.pending_restart).toBe(true);
    expect(result?.accounts.B.source).toBe('conflicting-clusters');
    expect(result?.accounts.B.promotion_candidate?.seven_day_delta).toBe(3);
    expect(result?.agents['meta-ads']).toMatchObject({
      tier: 'ASSERTED',
      source: 'cluster',
      cluster_id: 'cluster-a',
      pending_restart: true,
    });
  });

  it('uses snapshot_interval_ms as the staleness cadence when present', () => {
    writeSnapshot([
      {
        org: 'o1',
        agent: 'meta-ads-agent',
        account: 'B',
        source: 'token-match',
        tier: 'ASSERTED',
      },
    ], '2026-06-12T12:00:00.000Z', [], 60_000);

    expect(reports.getAgentAccounts()?.stale).toBe(true);
  });
});
