import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// reports.ts reads CTX_ROOT at module-eval time — set it before importing.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-usage-'));
process.env.CTX_ROOT = root;

type Reports = typeof import('../reports');
let reports: Reports;

beforeAll(async () => {
  reports = await import('../reports');
});

afterAll(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

const usageDir = path.join(root, 'state', 'usage');
beforeEach(() => {
  fs.rmSync(usageDir, { recursive: true, force: true });
  fs.mkdirSync(usageDir, { recursive: true });
});

describe('getPlanUsage (live 5h/7d shape)', () => {
  it('returns null when latest.json is absent', () => {
    expect(reports.getPlanUsage()).toBeNull();
  });

  it('reads the live 5h/7d snapshot written by refresh-usage', () => {
    fs.writeFileSync(path.join(usageDir, 'latest.json'), JSON.stringify({
      account: 'keychain',
      timestamp: '2026-06-01T12:00:00.000Z',
      five_hour: { used_pct: 43, resets: '2026-06-01T17:00:00Z' },
      seven_day: { used_pct: 80, resets: '2026-06-08T00:00:00Z' },
    }));

    const usage = reports.getPlanUsage();
    expect(usage?.account).toBe('keychain');
    expect(usage?.five_hour?.used_pct).toBe(43);
    expect(usage?.seven_day?.used_pct).toBe(80);
    expect(usage?.seven_day?.resets).toBe('2026-06-08T00:00:00Z');
    // Legacy fields are optional and absent here.
    expect(usage?.session).toBeUndefined();
  });

  it('still reads a legacy scrape-usage snapshot (session/week)', () => {
    fs.writeFileSync(path.join(usageDir, 'latest.json'), JSON.stringify({
      agent: 'the-analyst',
      timestamp: '2026-06-01T12:00:00.000Z',
      session: { used_pct: 12, resets: '5pm' },
      week_all_models: { used_pct: 34, resets: 'Sun' },
      week_sonnet: { used_pct: 7 },
    }));
    const usage = reports.getPlanUsage();
    expect(usage?.session?.used_pct).toBe(12);
    expect(usage?.five_hour).toBeUndefined();
  });
});

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
    expect(ic.error).toBe('HTTP 403');
  });

  it('renders an unknown account with a fallback label instead of dropping it', () => {
    writeSnapshot([{ account: 'future-acct', ok: true, five_hour_pct: 1 }]);
    const r = reports.getMultiAccountUsage()!;
    expect(r.accounts[0].email).toBe('future-acct');
    expect(r.accounts[0].plan).toBe('Claude Plan');
  });
});
