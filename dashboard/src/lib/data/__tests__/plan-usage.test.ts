import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// reports.ts reads CTX_ROOT at module-eval time — set it before importing.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-usage-'));
process.env.CTX_ROOT = root;

type Reports = typeof import('../reports');
let reports: Reports;
let dashboardDb: typeof import('../../db').db;

beforeAll(async () => {
  reports = await import('../reports');
  dashboardDb = (await import('../../db')).db;
});

afterAll(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

const usageDir = path.join(root, 'state', 'usage');
beforeEach(() => {
  fs.rmSync(usageDir, { recursive: true, force: true });
  fs.mkdirSync(usageDir, { recursive: true });
  dashboardDb.prepare('DELETE FROM cost_entries').run();
});

function insertCostEntry(entry: {
  timestamp: string;
  agent: string;
  model: string;
  totalTokens: number;
  costUsd: number;
  sourceFile: string;
}) {
  dashboardDb.prepare(`
    INSERT INTO cost_entries (
      timestamp, agent, org, model, input_tokens, output_tokens,
      total_tokens, cost_usd, source_file
    ) VALUES (?, ?, '', ?, 0, 0, ?, ?, ?)
  `).run(entry.timestamp, entry.agent, entry.model, entry.totalTokens, entry.costUsd, entry.sourceFile);
}

describe('getUsageHistory (5h/7d series)', () => {
  it('captures five_hour_pct / seven_day_pct from the daily JSONL', () => {
    const today = new Date().toISOString().split('T')[0];
    fs.writeFileSync(path.join(usageDir, `${today}.jsonl`),
      JSON.stringify({ timestamp: '2026-06-01T12:00:00Z', five_hour: { used_pct: 43 }, seven_day: { used_pct: 80 } }) + '\n');

    const history = reports.getUsageHistory(1);
    expect(history.length).toBe(1);
    expect(history[0].five_hour_pct).toBe(43);
    expect(history[0].seven_day_pct).toBe(80);
    // Legacy series default to 0 when absent.
    expect(history[0].session_pct).toBe(0);
  });
});

describe('getMultiAccountUsage (3-account subscription panel)', () => {
  function writeSnapshot(accounts: unknown[]) {
    fs.writeFileSync(path.join(usageDir, 'multi-account-usage.json'), JSON.stringify({
      generated_at: '2026-06-11T18:00:00.000Z', accounts,
    }));
  }

  it('returns null when the snapshot is absent', () => {
    expect(reports.getMultiAccountUsage()).toBeNull();
  });

  it('maps account keys to Adam-specified email + plan labels in primary-first order', () => {
    writeSnapshot([
      { account: 'icloud-max-20x', ok: true, five_hour_pct: 7, seven_day_pct: 4, extra_usage: { is_enabled: true, used_credits: 0 } },
      { account: 'me-com-max', ok: true, five_hour_pct: 8, seven_day_pct: 95, extra_usage: { is_enabled: true, used_credits: 537155 } },
      { account: 'cg-team-seat', ok: true, five_hour_pct: 22, seven_day_pct: 25, extra_usage: { is_enabled: true, used_credits: 24648 } },
    ]);
    const r = reports.getMultiAccountUsage()!;
    // Order: cg-team-seat (primary), me-com, icloud.
    expect(r.accounts.map((a) => a.account)).toEqual(['cg-team-seat', 'me-com-max', 'icloud-max-20x']);
    expect(r.accounts[0].email).toBe('adam@cleangreen.com');
    expect(r.accounts[0].plan).toBe('Teams Premium Seat Plan');
    expect(r.accounts[1].email).toBe('afolker@me.com');
    expect(r.accounts[1].plan).toBe('Personal Claude MAX Plan');
    expect(r.accounts[2].email).toBe('afolker@icloud.com');
  });

  it('enriches extra-usage with USD (100 credits = $1) and the me.com $10k cap', () => {
    writeSnapshot([
      { account: 'me-com-max', ok: true, extra_usage: { is_enabled: true, used_credits: 537155 } },
    ]);
    const me = reports.getMultiAccountUsage()!.accounts[0];
    expect(me.extra_usage!.used_usd).toBeCloseTo(5371.55, 2);
    expect(me.extra_usage!.cap_usd).toBe(10000);
  });

  it('handles a disabled meter (used_credits null -> 0) and a failed fetch', () => {
    writeSnapshot([
      { account: 'me-com-max', ok: true, extra_usage: { is_enabled: false, used_credits: null } },
      { account: 'icloud-max-20x', ok: false, error: 'HTTP 403' },
    ]);
    const r = reports.getMultiAccountUsage()!;
    const me = r.accounts.find((a) => a.account === 'me-com-max')!;
    expect(me.extra_usage!.is_enabled).toBe(false);
    expect(me.extra_usage!.used_credits).toBe(0);
    const ic = r.accounts.find((a) => a.account === 'icloud-max-20x')!;
    expect(ic.ok).toBe(false);
    expect(ic.status).toBe('fetch-fail');
    expect(ic.error).toBe('HTTP 403');
  });

  it('carries last_good usage through failed rows for stale rendering', () => {
    writeSnapshot([
      {
        account: 'me-com-max',
        ok: false,
        error: 'HTTP 403',
        last_good: {
          five_hour_pct: 0,
          seven_day_pct: 42,
          five_hour_resets: '2026-06-11T20:00:00.000Z',
          seven_day_resets: '2026-06-15T20:00:00.000Z',
          fetched_at: '2026-06-11T18:00:00.000Z',
        },
      },
    ]);

    const me = reports.getMultiAccountUsage()!.accounts[0];
    expect(me.ok).toBe(false);
    expect(me.error).toBe('HTTP 403');
    expect(me.last_good?.five_hour_pct).toBe(0);
    expect(me.last_good?.seven_day_pct).toBe(42);
    expect(me.last_good?.fetched_at).toBe('2026-06-11T18:00:00.000Z');
  });

  it('passes scoped weekly limits and last_good scoped limits through for dashboard rendering', () => {
    writeSnapshot([
      {
        account: 'me-com-max',
        ok: true,
        scoped_limits: [{
          model: 'Fable',
          percent: 100,
          severity: 'critical',
          resets_at: '2026-07-05T08:59:59.905554+00:00',
          is_active: true,
        }],
      },
      {
        account: 'icloud-max-20x',
        ok: false,
        error: 'HTTP 403',
        last_good: {
          scoped_limits: [{
            model: 'Fable',
            percent: 4,
            severity: 'normal',
            resets_at: '2026-07-05T08:59:59.905554+00:00',
            is_active: true,
          }],
          fetched_at: '2026-06-11T18:00:00.000Z',
        },
      },
    ]);

    const r = reports.getMultiAccountUsage()!;
    const me = r.accounts.find((a) => a.account === 'me-com-max')!;
    const icloud = r.accounts.find((a) => a.account === 'icloud-max-20x')!;
    expect(me.scoped_limits).toEqual([{
      model: 'Fable',
      percent: 100,
      severity: 'critical',
      resets_at: '2026-07-05T08:59:59.905554+00:00',
      is_active: true,
    }]);
    expect(icloud.last_good?.scoped_limits).toEqual([{
      model: 'Fable',
      percent: 4,
      severity: 'normal',
      resets_at: '2026-07-05T08:59:59.905554+00:00',
      is_active: true,
    }]);
  });

  it('renders an unknown account with a fallback label instead of dropping it', () => {
    writeSnapshot([{ account: 'future-acct', ok: true, five_hour_pct: 1 }]);
    const r = reports.getMultiAccountUsage()!;
    expect(r.accounts[0].email).toBe('future-acct');
    expect(r.accounts[0].plan).toBe('Claude Plan');
  });

  it('maps sampler status classes and strips current percentages from non-ok rows', () => {
    const now = Date.parse('2026-06-11T18:00:00.000Z');
    writeSnapshot([
      { account: 'cg-team-seat', ok: true, status: 'ok', five_hour_pct: 12, seven_day_pct: 34, fetched_at: '2026-06-11T17:59:00.000Z' },
      {
        account: 'me-com-max',
        ok: false,
        status: 'suspect',
        error: 'suspect-read: 7d=0 but $3228 attributed burn in last 24h - credential likely mis-scoped',
        five_hour_pct: 0,
        seven_day_pct: 0,
      },
      {
        account: 'icloud-max-20x',
        ok: false,
        status: 'impossible-read',
        error: 'five_hour utilization without resets_at',
        five_hour_pct: 44,
      },
      {
        account: 'moonlight-max',
        ok: false,
        status: 'fetch-fail',
        error: 'HTTP 503',
        seven_day_pct: 55,
      },
    ]);

    const r = reports.getMultiAccountUsage(now)!;
    const ok = r.accounts.find((a) => a.account === 'cg-team-seat')!;
    expect(ok.status).toBe('ok');
    expect(ok.five_hour_pct).toBe(12);

    for (const account of r.accounts.filter((a) => a.status !== 'ok' && a.status !== 'stale')) {
      expect(account.ok).toBe(false);
      expect(account.five_hour_pct).toBeUndefined();
      expect(account.seven_day_pct).toBeUndefined();
      expect(account.scoped_limits).toBeUndefined();
      expect(account.extra_usage).toBeUndefined();
      expect(account.suspectReason).toBeTruthy();
    }
    expect(r.accounts.find((a) => a.account === 'me-com-max')!.status).toBe('suspect');
    expect(r.accounts.find((a) => a.account === 'icloud-max-20x')!.status).toBe('impossible-read');
    expect(r.accounts.find((a) => a.account === 'moonlight-max')!.status).toBe('fetch-fail');
  });

  it('marks stale sampler rows with labeled stale values instead of confident fresh values', () => {
    const now = Date.parse('2026-06-11T19:00:00.000Z');
    writeSnapshot([
      {
        account: 'me-com-max',
        ok: true,
        five_hour_pct: 9,
        seven_day_pct: 56,
        fetched_at: '2026-06-11T18:00:00.000Z',
        last_good: { five_hour_pct: 9, seven_day_pct: 56, fetched_at: '2026-06-11T18:00:00.000Z' },
      },
    ]);

    const r = reports.getMultiAccountUsage(now)!;
    expect(r.stale).toBe(true);
    expect(r.newestFetchedAgeMs).toBe(60 * 60 * 1000);
    const me = r.accounts[0];
    expect(me.status).toBe('stale');
    expect(me.ok).toBe(false);
    expect(me.five_hour_pct).toBe(9);
    expect(me.seven_day_pct).toBe(56);
    expect(me.freshness?.ageMs).toBe(60 * 60 * 1000);
  });
});

describe('getAgentAccounts (live resolver matrix + burn)', () => {
  function writeAgentSnapshot() {
    fs.writeFileSync(path.join(usageDir, 'agent-accounts.json'), JSON.stringify({
      generated_at: '2026-06-11T18:00:00.000Z',
      snapshot_interval_ms: 15 * 60 * 1000,
      agents: [
        {
          agent: 'alpha-agent',
          account: 'old-account',
          source: 'cluster',
          tier: 'CONFIRMED-CORRELATION',
          pending_restart: true,
          cluster_id: 'old-cluster',
        },
      ],
    }));
  }

  it('uses live resolver rows for configured account mapping instead of the snapshot account', () => {
    writeAgentSnapshot();
    const first = reports.getAgentAccounts({
      nowMs: Date.parse('2026-06-11T18:05:00.000Z'),
      liveRows: [{ agent: 'alpha-agent', account: 'me-com-max', source: 'override' }],
    })!;
    expect(first.live).toBe(true);
    expect(first.liveSource).toBe('resolver');
    expect(first.byAccount['me-com-max']).toEqual(['alpha']);
    expect(first.byAccount['old-account']).toBeUndefined();
    expect(first.accounts['me-com-max'].pending_restart).toBe(true);

    const changed = reports.getAgentAccounts({
      nowMs: Date.parse('2026-06-11T18:05:00.000Z'),
      liveRows: [{ agent: 'alpha-agent', account: 'moonlight-max', source: 'override' }],
    })!;
    expect(changed.byAccount['moonlight-max']).toEqual(['alpha']);
    expect(changed.byAccount['me-com-max']).toBeUndefined();
  });

  it('falls back visibly to the snapshot mapping when live rows are unavailable', () => {
    writeAgentSnapshot();
    const matrix = reports.getAgentAccounts({
      nowMs: Date.parse('2026-06-11T18:05:00.000Z'),
      liveRows: null,
    })!;
    expect(matrix.live).toBe(false);
    expect(matrix.liveSource).toBe('snapshot-fallback');
    expect(matrix.byAccount['old-account']).toEqual(['alpha']);
  });

  it('returns null when the live resolver command throws', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/nonexistent';
    try {
      expect(reports.readLiveAgentAccountRows()).toBeNull();
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('aggregates per-account burn through the existing per-agent cost reader and keeps the dedup index present', () => {
    writeAgentSnapshot();
    const now = new Date().toISOString();
    insertCostEntry({ timestamp: now, agent: 'alpha-agent', model: 'claude-sonnet', totalTokens: 1000, costUsd: 1.25, sourceFile: '/tmp/a.jsonl' });
    insertCostEntry({ timestamp: now, agent: 'beta-agent', model: 'claude-sonnet', totalTokens: 1000, costUsd: 2.75, sourceFile: '/tmp/b.jsonl' });
    insertCostEntry({ timestamp: now, agent: 'gamma-agent', model: 'claude-sonnet', totalTokens: 1000, costUsd: 9, sourceFile: '/tmp/c.jsonl' });

    const matrix = reports.getAgentAccounts({
      liveRows: [
        { agent: 'alpha-agent', account: 'me-com-max', source: 'override' },
        { agent: 'beta-agent', account: 'me-com-max', source: 'override' },
        { agent: 'gamma-agent', account: 'icloud-max-20x', source: 'override' },
      ],
    })!;

    expect(matrix.accounts['me-com-max'].burn?.last24hUsd).toBeCloseTo(4, 6);
    expect(matrix.accounts['me-com-max'].burn?.last7dUsd).toBeCloseTo(4, 6);
    expect(matrix.accounts['icloud-max-20x'].burn?.last24hUsd).toBeCloseTo(9, 6);
    expect(reports.hasCostEntriesUniqueIndex()).toBe(true);
  });
});

describe('getCodexUsage (read-only codex card)', () => {
  it('returns null when codex-usage.json is absent', () => {
    expect(reports.getCodexUsage()).toBeNull();
  });

  it('reads + rounds the codex snapshot written by the 15-min sync', () => {
    fs.writeFileSync(path.join(usageDir, 'codex-usage.json'), JSON.stringify({
      generated_at: '2026-06-11T18:00:00.000Z',
      codex: {
        primary: { used_percent: 12.6, window_minutes: 300, resets_at: 1781153962 },
        secondary: { used_percent: 88, window_minutes: 10080, resets_at: 1781560275 },
        plan_type: 'pro', rate_limit_reached: false, as_of: '2026-06-11T00:44:38.391Z',
      },
    }));
    const c = reports.getCodexUsage()!;
    expect(c.primary!.used_pct).toBe(13); // rounded
    expect(c.secondary!.used_pct).toBe(88);
    expect(c.plan_type).toBe('pro');
    expect(c.as_of).toBe('2026-06-11T00:44:38.391Z');
  });
});

describe('getCodexActivity (7-day cost_entries window)', () => {
  it('sums only codex token rows inside the requested window', () => {
    const now = Date.now();
    const inside = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const outside = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();

    insertCostEntry({
      timestamp: inside,
      agent: 'codex-dev-agent',
      model: 'gpt-5-codex',
      totalTokens: 1_500_000,
      costUsd: 1.23,
      sourceFile: '/tmp/codex-dev-agent/codex-tokens.jsonl',
    });
    insertCostEntry({
      timestamp: outside,
      agent: 'codex-dev-agent',
      model: 'gpt-5-codex',
      totalTokens: 2_000_000,
      costUsd: 2.5,
      sourceFile: '/tmp/codex-dev-agent/codex-tokens.jsonl',
    });
    insertCostEntry({
      timestamp: inside,
      agent: 'claude-dev-agent',
      model: 'claude-sonnet',
      totalTokens: 9_000_000,
      costUsd: 9.99,
      sourceFile: '/tmp/claude-dev-agent/usage.jsonl',
    });

    const activity = reports.getCodexActivity(7);
    expect(activity.tokens).toBe(1_500_000);
    expect(activity.cost).toBeCloseTo(1.23, 6);
  });
});
