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
  delete process.env.TRUST_PROXY;
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

  it('accepts the captured Tailscale origin when trusted proxy headers match', async () => {
    process.env.TRUST_PROXY = 'true';
    const ops = makeOps({ uuid: 'tailscale-job' });

    const res = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'https://dashboard-host.tail0000.ts.net',
          forwardedHost: 'dashboard-host.tail0000.ts.net',
          forwardedProto: 'https',
        },
      ),
      admin('tailscale@example.test'),
      ops,
    );

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe('tailscale-job');
  });

  it('accepts direct localhost requests when TRUST_PROXY is set but no forwarded headers are present', async () => {
    process.env.TRUST_PROXY = 'true';
    const ops = makeOps({ uuid: 'direct-localhost-job' });

    const res = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        { origin: 'http://localhost:3000' },
      ),
      admin('direct-localhost@example.test'),
      ops,
    );

    expect(res.status).toBe(202);
    expect(res.body.jobId).toBe('direct-localhost-job');
  });

  it('fails closed for missing proxy host and missing browser origin context', async () => {
    process.env.TRUST_PROXY = 'true';
    const ops = makeOps();

    const missingProxyHost = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'https://dashboard-host.tail0000.ts.net',
          forwardedProto: 'https',
        },
      ),
      admin('missing-proxy@example.test'),
      ops,
    );
    expect(missingProxyHost.status).toBe(403);

    const missingBrowserOrigin = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          forwardedHost: 'dashboard-host.tail0000.ts.net',
          forwardedProto: 'https',
          includeOrigin: false,
          includeReferer: false,
        },
      ),
      admin('missing-origin@example.test'),
      ops,
    );
    expect(missingBrowserOrigin.status).toBe(403);
    expect(ops.spawnSwitch).not.toHaveBeenCalled();
  });

  it('keeps the no-proxy origin behavior unchanged', async () => {
    const ops = makeOps();

    const res = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'https://dashboard-host.tail0000.ts.net',
          forwardedHost: 'dashboard-host.tail0000.ts.net',
          forwardedProto: 'https',
        },
      ),
      admin('no-proxy@example.test'),
      ops,
    );

    expect(res.status).toBe(403);
    expect(ops.spawnSwitch).not.toHaveBeenCalled();
  });

  it('rejects forwarded-host injection, malformed host, and non-https forwarded proto', async () => {
    process.env.TRUST_PROXY = 'true';
    const ops = makeOps();

    const injectedHost = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'https://evil.example.com',
          forwardedHost: 'evil.example.com, dashboard-host.tail0000.ts.net',
          forwardedProto: 'https',
        },
      ),
      admin('inject@example.test'),
      ops,
    );
    expect(injectedHost.status).toBe(403);

    const malformedHost = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'https://evil.example.com',
          forwardedHost: 'evil/../x',
          forwardedProto: 'https',
        },
      ),
      admin('malformed@example.test'),
      ops,
    );
    expect(malformedHost.status).toBe(403);

    const insecureProto = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'https://dashboard-host.tail0000.ts.net',
          forwardedHost: 'dashboard-host.tail0000.ts.net',
          forwardedProto: 'http',
        },
      ),
      admin('proto@example.test'),
      ops,
    );
    expect(insecureProto.status).toBe(403);

    const partialForwarded = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'https://dashboard-host.tail0000.ts.net',
          forwardedHost: 'dashboard-host.tail0000.ts.net',
        },
      ),
      admin('partial-forwarded@example.test'),
      ops,
    );
    expect(partialForwarded.status).toBe(403);
    expect(ops.spawnSwitch).not.toHaveBeenCalled();
  });

  it('rejects headerless TRUST_PROXY fallback when the request URL is not loopback', async () => {
    process.env.TRUST_PROXY = 'true';
    const ops = makeOps();

    const res = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'http://dashboard-host.tail0000.ts.net',
          requestUrl: 'http://dashboard-host.tail0000.ts.net/api/accounts/switch',
        },
      ),
      admin('non-loopback@example.test'),
      ops,
    );

    expect(res.status).toBe(403);
    expect(ops.spawnSwitch).not.toHaveBeenCalled();
  });

  it('rejects headerless non-proxy direct hits when the request URL is not loopback', async () => {
    delete process.env.TRUST_PROXY;
    const ops = makeOps();

    const res = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'http://dashboard-host.tail0000.ts.net',
          requestUrl: 'http://dashboard-host.tail0000.ts.net/api/accounts/switch',
        },
      ),
      admin('direct-non-loopback@example.test'),
      ops,
    );

    expect(res.status).toBe(403);
    expect(ops.spawnSwitch).not.toHaveBeenCalled();
  });

  it('still rejects a matching proxy origin without a valid csrf token', async () => {
    process.env.TRUST_PROXY = 'true';
    const ops = makeOps();

    const res = await mod.startSwitchJob(
      makeRequest(
        { agent: 'a1', targetAccount: 'moonlight' },
        {
          origin: 'https://dashboard-host.tail0000.ts.net',
          forwardedHost: 'dashboard-host.tail0000.ts.net',
          forwardedProto: 'https',
          csrf: 'wrong-token',
        },
      ),
      admin('csrf-backstop@example.test'),
      ops,
    );

    expect(res.status).toBe(403);
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

  it('keeps a live long-running switch lock through the probe-primary window and reclaims only after the backstop', async () => {
    writeLock({ pid: 999, startedAtMs: 1_000 });

    const liveLong = await mod.startSwitchJob(
      makeRequest({ agent: 'a1', targetAccount: 'moonlight' }),
      admin('live-long@example.test'),
      makeOps({ now: 361_000, pidAlive: true }),
    );
    expect(liveLong.status).toBe(409);

    const expired = await mod.startSwitchJob(
      makeRequest({ agent: 'a1', targetAccount: 'moonlight' }),
      admin('expired@example.test'),
      makeOps({ now: 1_201_001, pidAlive: true, uuid: 'job-after-backstop' }),
    );
    expect(expired.status).toBe(202);
    expect(expired.body.jobId).toBe('job-after-backstop');
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
      jobId: 'lagging-attribution-job',
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
    fs.writeFileSync(mod.jobOutputPath('lagging-attribution-job'), JSON.stringify({
      status: 'success',
      message: 'auth flip verified; functional sweep pending',
    }));
    const laggingAttribution = mod.getSwitchJobStatus('lagging-attribution-job', makeOps({
      now: 20_000,
      pidAlive: false,
      agentRows: [{ agent: 'a1', account: 'me-com', source: 'live' }],
    }));
    expect(laggingAttribution.status).toBe('running');
    expect(laggingAttribution.attributionPending).toBe(true);
    expect(laggingAttribution.resultSummary).toContain('confirming live attribution');

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
      jobId: 'rollback-safe-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 1239,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('rollback-safe-job'), JSON.stringify({ ok: false, rolledBack: true, code: 'VERIFY_FAILED', error: 'verify failed' }));
    const rollbackSafe = mod.getSwitchJobStatus('rollback-safe-job', ops);
    expect(rollbackSafe.status).toBe('failed');
    expect(rollbackSafe.resultSummary).toBe('Switch failed; rolled back to me-com - agent restored.');
    expect(rollbackSafe.error).toBe('verify failed');

    writeRecord({
      jobId: 'rollback-bad-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 1240,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('rollback-bad-job'), JSON.stringify({ ok: false, rolledBack: false, code: 'ROLLBACK_FAILED', error: 'rollback failed' }));
    const rollbackBad = mod.getSwitchJobStatus('rollback-bad-job', ops);
    expect(rollbackBad.status).toBe('failed');
    expect(rollbackBad.resultSummary).toBe('Switch failed AND rollback failed - a1 may be down, manual check needed (ROLLBACK_FAILED).');
    expect(rollbackBad.error).toBe('Switch failed AND rollback failed - a1 may be down, manual check needed (ROLLBACK_FAILED).');

    writeRecord({
      jobId: 'preflip-failed-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 1241,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('preflip-failed-job'), JSON.stringify({ ok: false, rolledBack: false, code: 'PREFLIGHT_FAILED', error: 'preflight failed' }));
    const preflipFailed = mod.getSwitchJobStatus('preflip-failed-job', ops);
    expect(preflipFailed.status).toBe('failed');
    expect(preflipFailed.resultSummary).toBe('Switch failed before any change - a1 untouched.');
    expect(preflipFailed.error).toBe('preflight failed');

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
      jobId: 'long-live-job',
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
    const longLive = mod.getSwitchJobStatus('long-live-job', makeOps({ pidAlive: true, processStart: 2_000, now: 361_000 }));
    expect(longLive.status).toBe('running');

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
    const timedOut = mod.getSwitchJobStatus('timeout-job', makeOps({ pidAlive: true, processStart: 2_000, now: 1_201_001 }));
    expect(timedOut.status).toBe('crashed');
  });

  it('confirms CLI success after live attribution converges within the grace window', () => {
    let agentRows: AgentAccountOption[] = [{ agent: 'a1', account: 'me-com', source: 'live' }];
    const ops = makeOps({ now: 30_000, pidAlive: false });
    ops.readAgentAccounts = vi.fn(() => agentRows);
    writeRecord({
      jobId: 'converges-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 3001,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('converges-job'), JSON.stringify({
      status: 'success',
      message: 'auth flip verified; functional sweep pending',
    }));

    const pending = mod.getSwitchJobStatus('converges-job', ops);
    expect(pending.status).toBe('running');
    expect(pending.attributionPending).toBe(true);

    agentRows = [{ agent: 'a1', account: 'moonlight', source: 'live' }];
    const confirmed = mod.getSwitchJobStatus('converges-job', ops);
    expect(confirmed.status).toBe('succeeded');
    expect(confirmed.resultSummary).toBe('auth flip verified; functional sweep pending');
  });

  it('treats unreadable attribution as success with an unread note', () => {
    const ops = makeOps({ agentRows: null, now: 40_000, pidAlive: false });
    writeRecord({
      jobId: 'unread-attribution-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 3002,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('unread-attribution-job'), JSON.stringify({
      status: 'success',
      message: 'auth flip verified; functional sweep pending',
    }));

    const unread = mod.getSwitchJobStatus('unread-attribution-job', ops);
    expect(unread.status).toBe('succeeded');
    expect(unread.resultSummary).toContain('live attribution unreadable');
  });

  it('keeps success-with-mismatched-attribution non-terminal during grace before pid/crash checks', () => {
    const ops = makeOps({
      now: 50_000,
      pidAlive: false,
      agentRows: [{ agent: 'a1', account: 'me-com', source: 'live' }],
    });
    writeRecord({
      jobId: 'pending-dead-pid-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 3003,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('pending-dead-pid-job'), JSON.stringify({
      status: 'success',
      message: 'auth flip verified; functional sweep pending',
    }));

    const pending = mod.getSwitchJobStatus('pending-dead-pid-job', ops);
    expect(pending.status).toBe('running');
    expect(pending.attributionPending).toBe(true);
    expect(pending.resultSummary).toContain('confirming live attribution');
  });

  it('turns persistent readable mismatch into suspect after the immutable first-seen grace', () => {
    let now = 60_000;
    const ops = makeOps({
      pidAlive: false,
      agentRows: [{ agent: 'a1', account: 'me-com', source: 'live' }],
    });
    ops.now = () => now;
    writeRecord({
      jobId: 'persistent-mismatch-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin@example.test',
      pid: 3004,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('persistent-mismatch-job'), JSON.stringify({
      status: 'success',
      message: 'auth flip verified; functional sweep pending',
    }));

    const first = mod.getSwitchJobStatus('persistent-mismatch-job', ops);
    expect(first.status).toBe('running');
    const stamped = JSON.parse(fs.readFileSync(mod.jobRecordPath('persistent-mismatch-job'), 'utf-8')) as SwitchJobRecord;
    expect(stamped.successFirstSeenAtMs).toBe(60_000);

    now = 100_000;
    expect(mod.getSwitchJobStatus('persistent-mismatch-job', ops).status).toBe('running');
    const afterSecondPoll = JSON.parse(fs.readFileSync(mod.jobRecordPath('persistent-mismatch-job'), 'utf-8')) as SwitchJobRecord;
    expect(afterSecondPoll.successFirstSeenAtMs).toBe(60_000);

    now = 140_000;
    expect(mod.getSwitchJobStatus('persistent-mismatch-job', ops).status).toBe('running');
    const afterThirdPoll = JSON.parse(fs.readFileSync(mod.jobRecordPath('persistent-mismatch-job'), 'utf-8')) as SwitchJobRecord;
    expect(afterThirdPoll.successFirstSeenAtMs).toBe(60_000);

    now = 151_000;
    const suspect = mod.getSwitchJobStatus('persistent-mismatch-job', ops);
    expect(suspect.status).toBe('suspect');
    expect(suspect.resultSummary).toBe('switch tool reported success but live attribution = me-com, not moonlight - NOT confirmed');
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({
      result: 'suspect',
      agent: 'a1',
      targetAccount: 'moonlight',
      observedAttributionAccount: 'me-com',
      attributionAccount: 'me-com',
      jobId: 'persistent-mismatch-job',
      actor: 'admin@example.test',
      successFirstSeenAtMs: 60_000,
      graceExpiresAtMs: 150_000,
    }));
  });

  it('reconciles in-flight records from server render without a client poll', () => {
    writeRecord({
      jobId: 'dead-terminal-job',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 2001,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      processStartMs: 2_000,
      status: 'running',
    });
    fs.writeFileSync(mod.jobOutputPath('dead-terminal-job'), JSON.stringify({
      status: 'success',
      message: 'auth flip verified; functional sweep pending',
    }));
    writeRecord({
      jobId: 'live-running-job',
      agent: 'a2',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 2002,
      startedAt: new Date(5_000).toISOString(),
      startedAtMs: 5_000,
      processStartMs: 6_000,
      status: 'running',
    });

    const reconciled = mod.reconcileInFlightSwitchJobs(makeOps({
      now: 20_000,
      pidAlive: true,
      processStart: 6_000,
      agentRows: [{ agent: 'a1', account: 'moonlight', source: 'live' }],
    }));

    expect(reconciled.find((record) => record.jobId === 'dead-terminal-job')?.status).toBe('succeeded');
    expect(reconciled.find((record) => record.jobId === 'live-running-job')?.status).toBe('running');
    const latest = mod.getLatestSwitchJobsByAgent(makeOps({ now: 20_000, pidAlive: true, processStart: 6_000 }));
    expect(latest.a1.status).toBe('succeeded');
    expect(latest.a2.status).toBe('running');
  });
});

function makeRequest(
  body: Record<string, unknown>,
  options: {
    csrf?: string;
    forwardedHost?: string;
    forwardedProto?: string;
    includeOrigin?: boolean;
    includeReferer?: boolean;
    origin?: string;
    requestUrl?: string;
  } = {},
): NextRequest {
  const csrf = options.csrf ?? 'csrf-token';
  const origin = options.origin ?? 'http://localhost:3000';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    cookie: `authjs.csrf-token=${encodeURIComponent(`${csrf}|hash`)}`,
    'x-csrf-token': 'csrf-token',
  };
  if (options.includeOrigin !== false) headers.origin = origin;
  if (options.includeReferer !== false) headers.referer = `${origin}/accounts`;
  if (options.forwardedHost) headers['x-forwarded-host'] = options.forwardedHost;
  if (options.forwardedProto) headers['x-forwarded-proto'] = options.forwardedProto;
  return new NextRequest(options.requestUrl ?? 'http://localhost:3000/api/accounts/switch', {
    method: 'POST',
    headers,
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
    readAgentAccounts: vi.fn(() => Object.hasOwn(options, 'agentRows')
      ? options.agentRows ?? null
      : [{ agent: 'a1', account: 'me-com', source: 'live' }]),
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
