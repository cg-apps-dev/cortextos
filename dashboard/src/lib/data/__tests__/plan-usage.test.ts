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
