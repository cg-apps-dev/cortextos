import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import type { ChildProcess } from 'child_process';
import type {
  AccountSwitchOps,
  AgentAccountOption,
  SwitchJobRecord,
  VaultAccountOption,
} from '../account-switch';

const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'account-switch-'));
process.env.CTX_ROOT = rootTmp;
process.env.CTX_FRAMEWORK_ROOT = path.join(rootTmp, 'framework');
process.env.ADMIN_USERNAME = 'admin';

type AccountSwitchModule = typeof import('../account-switch');
let mod: AccountSwitchModule;

beforeAll(async () => {
  mod = await import('../account-switch');
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

describe('account switch write path', () => {
  it('rejects unauthenticated and non-admin sessions', async () => {
    const ops = makeOps();

    const unauth = await mod.startSwitchJob(makeRequest({ agent: 'a1', targetAccount: 'moonlight' }), null, ops);
    expect(unauth.status).toBe(401);

    const forbidden = await mod.startSwitchJob(
      makeRequest({ agent: 'a1', targetAccount: 'moonlight' }),
      { user: { name: 'viewer' } },
      ops,
    );
    expect(forbidden.status).toBe(403);
  });

  it('rejects bad csrf, bad origin, invalid names, and out-of-set names before spawn', async () => {
    const ops = makeOps();

    expect((await mod.startSwitchJob(makeRequest({ agent: 'a1', targetAccount: 'moonlight' }, { csrf: 'bad' }), admin(), ops)).status)
      .toBe(403);
    expect((await mod.startSwitchJob(makeRequest({ agent: 'a1', targetAccount: 'moonlight' }, { origin: 'http://evil.test' }), admin(), ops)).status)
      .toBe(403);
    expect((await mod.startSwitchJob(makeRequest({ agent: '../a1', targetAccount: 'moonlight' }), admin(), ops)).status)
      .toBe(400);
    expect((await mod.startSwitchJob(makeRequest({ agent: 'missing', targetAccount: 'moonlight' }), admin('missing@example.test'), ops)).status)
      .toBe(400);
    expect((await mod.startSwitchJob(makeRequest({ agent: 'a1', targetAccount: 'missing' }), admin('target@example.test'), ops)).status)
      .toBe(400);
    expect(ops.spawnSwitch).not.toHaveBeenCalled();
  });

  it('creates a detached switch job with array args, labels only, and 0600 files', async () => {
    const ops = makeOps();
    const secret = 'sk-ant-oat01-SECRETabcdefghijklmnopqrstuvwxyz0123456789';

    const res = await mod.startSwitchJob(makeRequest({ agent: 'a1', targetAccount: 'moonlight' }), admin(), ops);

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe('job-1');
    expect(ops.spawnSwitch).toHaveBeenCalledWith(
      ['switch-agent-account', 'a1', 'moonlight', '--json'],
      expect.stringContaining('job-1.out'),
      expect.stringContaining('job-1.err'),
    );
    const recordRaw = fs.readFileSync(mod.jobRecordPath('job-1'), 'utf-8');
    expect(recordRaw).not.toContain(secret);
    const record = JSON.parse(recordRaw) as SwitchJobRecord;
    expect(record.actor).toBe('admin@example.test');
    expect(record.sourceAccount).toBe('me-com');
    expect(record.status).toBe('running');
    expect(fs.statSync(mod.jobRecordPath('job-1')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(mod.jobOutputPath('job-1')).mode & 0o777).toBe(0o600);
  });

  it('rejects active global lock and reclaims stale dead-pid lock', async () => {
    const activeOps = makeOps({ pidAlive: true });
    writeLock({ jobId: 'active', pid: 999, startedAtMs: 1_000 });

    const active = await mod.startSwitchJob(makeRequest({ agent: 'a1', targetAccount: 'moonlight' }), admin('active@example.test'), activeOps);
    expect(active.status).toBe(409);
    expect(activeOps.spawnSwitch).not.toHaveBeenCalled();

    const staleOps = makeOps({ now: 400_000, pidAlive: false, uuid: 'job-stale' });
    const stale = await mod.startSwitchJob(makeRequest({ agent: 'a1', targetAccount: 'moonlight' }), admin('stale@example.test'), staleOps);
    expect(stale.status).toBe(202);
    expect(stale.body.jobId).toBe('job-stale');
  });

  it('rejects traversal jobIds before path construction', () => {
    expect(() => mod.getSwitchJobStatus('../secret', makeOps())).toThrow('Invalid jobId');
  });

  it('derives running, succeeded, failed, and crashed status honestly', () => {
    const ops = makeOps({
      uuid: 'status-job',
      pidAlive: true,
      processStart: 2_000,
      now: 20_000,
      agentRows: [{ agent: 'a1', account: 'moonlight', source: 'live' }],
    });
    writeRecord({
      jobId: 'status-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 1234,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    expect(mod.getSwitchJobStatus('status-job', ops).status).toBe('running');
    fs.writeFileSync(mod.jobOutputPath('status-job'), '{');
    expect(mod.getSwitchJobStatus('status-job', ops).status).toBe('running');
    fs.writeFileSync(mod.jobOutputPath('status-job'), '');

    fs.writeFileSync(mod.jobOutputPath('status-job'), JSON.stringify({
      status: 'success',
      message: 'auth flip verified; functional sweep pending',
      functionalSweepTaskId: 'task_123',
    }));
    const success = mod.getSwitchJobStatus('status-job', ops);
    expect(success.status).toBe('succeeded');
    expect(success.resultSummary).toBe('auth flip verified; functional sweep pending');
    expect(JSON.stringify(success)).not.toContain('done');

    writeRecord({
      jobId: 'forged-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 1237,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('forged-job'), JSON.stringify({
      status: 'success',
      message: 'auth flip verified; functional sweep pending',
    }));
    const forged = mod.getSwitchJobStatus('forged-job', makeOps({ agentRows: [{ agent: 'a1', account: 'me-com', source: 'live' }] }));
    expect(forged.status).toBe('failed');

    writeRecord({
      jobId: 'failed-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 1235,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('failed-job'), JSON.stringify({ ok: false, error: 'rolled back' }));
    const failed = mod.getSwitchJobStatus('failed-job', ops);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('rolled back');

    writeRecord({
      jobId: 'crashed-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 1236,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    const crashed = mod.getSwitchJobStatus('crashed-job', makeOps({ pidAlive: false, now: 20_000 }));
    expect(crashed.status).toBe('crashed');

    writeRecord({
      jobId: 'timeout-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 1238,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    const timedOut = mod.getSwitchJobStatus('timeout-job', makeOps({ pidAlive: true, processStart: 2_000, now: 400_000 }));
    expect(timedOut.status).toBe('crashed');
  });
});

function makeRequest(
  body: Record<string, unknown>,
  options: { csrf?: string; origin?: string } = {},
): NextRequest {
  const csrf = options.csrf ?? 'csrf-token';
  const origin = options.origin ?? 'http://localhost:3000';
  return new NextRequest('http://localhost:3000/api/accounts/switch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      referer: `${origin}/accounts`,
      cookie: `authjs.csrf-token=${encodeURIComponent(`${csrf}|hash`)}`,
      'x-csrf-token': 'csrf-token',
    },
    body: JSON.stringify(body),
  });
}

function admin(email = 'admin@example.test') {
  return { user: { name: 'admin', email } };
}

function makeOps(options: {
  now?: number;
  uuid?: string;
  pidAlive?: boolean;
  processStart?: number;
  agentRows?: AgentAccountOption[] | null;
  vaultRows?: VaultAccountOption[] | null;
} = {}): AccountSwitchOps {
  return {
    now: () => options.now ?? 10_000,
    uuid: () => options.uuid ?? 'job-1',
    readAgentAccounts: vi.fn(() => options.agentRows ?? [{ agent: 'a1', account: 'me-com', source: 'live' }]),
    readVaultAccounts: vi.fn(() => options.vaultRows ?? [{ account: 'moonlight', hasToken: true as const }]),
    spawnSwitch: vi.fn(() => ({ pid: 1234, unref: vi.fn() }) as unknown as ChildProcess),
    isPidAlive: vi.fn(() => options.pidAlive ?? true),
    processStartMs: vi.fn(() => options.processStart ?? 2_000),
    audit: vi.fn(),
  };
}

function writeLock(value: Record<string, unknown>) {
  const dir = path.join(rootTmp, 'state', 'switch-jobs', 'locks');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'global.lock'), JSON.stringify(value), { mode: 0o600 });
}

function writeRecord(record: SwitchJobRecord) {
  fs.mkdirSync(path.join(rootTmp, 'state', 'switch-jobs'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(rootTmp, 'state', 'switch-jobs', `${record.jobId}.json`), JSON.stringify(record), { mode: 0o600 });
  fs.writeFileSync(path.join(rootTmp, 'state', 'switch-jobs', `${record.jobId}.out`), '', { mode: 0o600 });
}
