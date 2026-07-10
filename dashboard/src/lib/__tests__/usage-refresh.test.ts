import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import type { UsageRefreshOps } from '../usage-refresh';

const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-refresh-'));
process.env.CTX_ROOT = rootTmp;
process.env.CTX_FRAMEWORK_ROOT = path.join(rootTmp, 'framework');
process.env.ADMIN_USERNAME = 'admin';

type UsageRefreshModule = typeof import('../usage-refresh');
let mod: UsageRefreshModule;

beforeAll(async () => {
  mod = await import('../usage-refresh');
});

afterAll(() => {
  fs.rmSync(rootTmp, { recursive: true, force: true });
});

beforeEach(() => {
  for (const entry of fs.readdirSync(rootTmp)) {
    fs.rmSync(path.join(rootTmp, entry), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(rootTmp, 'framework'), { recursive: true });
});

describe('usage refresh route helper', () => {
  it('rate-limits forced pulls and returns the unchanged sampler as-of without executing the CLI', async () => {
    writeUsage('2026-07-10T05:00:00.000Z');
    writeRefreshState({ lastForcedAtMs: 50_000, lastAsOf: '2026-07-10T05:00:00.000Z' });
    const ops = makeOps({ now: 100_000 });

    const res = await mod.refreshUsageSnapshot(makeRequest(), admin(), ops);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      refreshed: false,
      asOf: '2026-07-10T05:00:00.000Z',
      nextAllowedInMs: 40_000,
    });
    expect(ops.runSampler).not.toHaveBeenCalled();
  });

  it('runs check-all-usage once past the floor and returns the advanced sampler as-of', async () => {
    writeUsage('2026-07-10T05:00:00.000Z');
    writeRefreshState({ lastForcedAtMs: 0, lastAsOf: '2026-07-10T05:00:00.000Z' });
    const ops = makeOps({
      now: 200_000,
      runSampler: () => writeUsage('2026-07-10T05:15:00.000Z'),
    });

    const res = await mod.refreshUsageSnapshot(makeRequest(), admin(), ops);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ refreshed: true, asOf: '2026-07-10T05:15:00.000Z' });
    expect(ops.runSampler).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(mod.usageRefreshStatePath(), 'utf-8'))).toMatchObject({
      lastForcedAtMs: 200_000,
      lastAsOf: '2026-07-10T05:15:00.000Z',
    });
  });

  it('returns a soft error when the sampler execution fails', async () => {
    writeUsage('2026-07-10T05:00:00.000Z');
    const ops = makeOps({
      now: 200_000,
      runSampler: () => {
        throw new Error('timeout');
      },
    });

    const res = await mod.refreshUsageSnapshot(makeRequest(), admin(), ops);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      refreshed: false,
      asOf: '2026-07-10T05:00:00.000Z',
      error: 'Usage refresh failed. Existing sampler data is still shown.',
    });
  });

  it('rejects non-admin and bad-CSRF requests before executing the CLI', async () => {
    const ops = makeOps();

    expect((await mod.refreshUsageSnapshot(makeRequest(), null, ops)).status).toBe(401);
    expect((await mod.refreshUsageSnapshot(makeRequest(), { user: { name: 'viewer' } }, ops)).status).toBe(403);
    expect((await mod.refreshUsageSnapshot(makeRequest({ csrf: 'bad-token' }), admin(), ops)).status).toBe(403);
    expect(ops.runSampler).not.toHaveBeenCalled();
  });
});

function makeRequest(options: { csrf?: string } = {}): NextRequest {
  const csrf = options.csrf ?? 'csrf-token';
  const origin = 'http://localhost:3000';
  return new NextRequest('http://localhost:3000/api/usage/refresh', {
    method: 'POST',
    headers: {
      cookie: `authjs.csrf-token=${encodeURIComponent(`${csrf}|hash`)}`,
      'x-csrf-token': 'csrf-token',
      origin,
      referer: `${origin}/accounts`,
    },
  });
}

function admin(email = 'admin@example.test') {
  return { user: { name: 'admin', email } };
}

function makeOps(options: { now?: number; runSampler?: () => void } = {}): UsageRefreshOps {
  return {
    now: () => options.now ?? 100_000,
    runSampler: vi.fn(options.runSampler ?? (() => undefined)),
  };
}

function writeUsage(fetchedAt: string) {
  const dir = path.join(rootTmp, 'state', 'usage');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'multi-account-usage.json'), JSON.stringify({
    generated_at: fetchedAt,
    accounts: [
      {
        account: 'moonlight-max',
        ok: true,
        five_hour_pct: 12,
        seven_day_pct: 34,
        fetched_at: fetchedAt,
      },
    ],
  }));
}

function writeRefreshState(state: Record<string, unknown>) {
  const dir = path.join(rootTmp, 'state', 'usage');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'forced-refresh.json'), JSON.stringify(state));
}
