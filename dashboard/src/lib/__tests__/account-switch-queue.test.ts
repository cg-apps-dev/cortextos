import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { execFileSync, type ChildProcess } from 'child_process';
import type { AgentAccountOption, VaultAccountOption } from '../account-switch';
import type { QueueEntryRecord, SwitchQueueOps } from '../account-switch-queue';

const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'account-switch-queue-'));
process.env.CTX_ROOT = rootTmp;
process.env.CTX_FRAMEWORK_ROOT = path.join(rootTmp, 'framework');
process.env.ADMIN_USERNAME = 'admin';

type QueueModule = typeof import('../account-switch-queue');
let mod: QueueModule;
type CliDrainModule = typeof import('../../../../src/cli/drain-switch-queue');
let cliDrain: CliDrainModule;

beforeAll(async () => {
  mod = await import('../account-switch-queue');
  cliDrain = await import('../../../../src/cli/drain-switch-queue');
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

describe('switch queue v2', () => {
  it('enqueues instead of 409ing when a switch is busy', async () => {
    const ops = makeOps();
    writeLock({ jobId: 'busy-job', pid: 999, startedAtMs: 1_000 });

    const res = await mod.enqueueSwitchRequest(
      makeRequest({ agent: 'a1', targetAccount: 'moonlight' }),
      admin('busy@example.test'),
      ops,
    );

    expect(res.status).toBe(202);
    expect(res.body.position).toBe(1);
    expect(ops.spawnSwitch).not.toHaveBeenCalled();
    expect(ops.spawnQueueWorker).toHaveBeenCalledTimes(1);
  });

  it('keeps FIFO order and drains entries one at a time', async () => {
    const ops = makeOps({ uuids: ['q-a', 'q-b', 'q-c', 'job-a', 'job-b', 'job-c'] });
    await enqueue('a1', 'moonlight', 'fifo-a@example.test', ops);
    await enqueue('a2', 'moonlight', 'fifo-b@example.test', ops);
    await enqueue('a3', 'moonlight', 'fifo-c@example.test', ops);

    const drained = await mod.drainSwitchQueue(ops);

    expect(drained.map((entry) => entry.agent)).toEqual(['a1', 'a2', 'a3']);
    expect(drained.every((entry) => entry.status === 'succeeded')).toBe(true);
    expect(ops.calls.filter((call) => call.startsWith('spawnSwitch:'))).toEqual([
      'spawnSwitch:a1->moonlight',
      'spawnSwitch:a2->moonlight',
      'spawnSwitch:a3->moonlight',
    ]);
  });

  it('drains through the CLI worker shell using the shared queue core', async () => {
    const ops = makeOps({ uuids: ['q-cli', 'job-cli'] });
    await enqueue('a1', 'moonlight', 'cli@example.test', ops);

    const drained = await cliDrain.drainSwitchQueueCli({ ctxRoot: rootTmp }, ops);

    expect(drained.map((entry) => entry.status)).toEqual(['succeeded']);
    expect(ops.calls.filter((call) => call.startsWith('spawnSwitch:'))).toEqual([
      'spawnSwitch:a1->moonlight',
    ]);
  });

  it('executes the real CLI drain command through the shared core path', () => {
    const fixtureDir = path.join(rootTmp, 'cli-fixture');
    fs.mkdirSync(fixtureDir, { recursive: true, mode: 0o700 });
    writeQueueEntry(makeEntry({ queueId: 'q-live', seq: 0, agent: 'a1', targetAccount: 'moonlight', status: 'pending' }));
    const shimPath = writeCortextosShim(fixtureDir);

    const output = execFileSync(shimPath, ['switch-agent-account', '--drain-switch-queue', '--json'], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${fixtureDir}:${process.env.PATH ?? ''}`,
        CTX_ROOT: rootTmp,
        CTX_FRAMEWORK_ROOT: path.resolve('.'),
        CTX_PROJECT_ROOT: path.resolve('.'),
        CTX_INSTANCE_ID: 'queue-v2-test',
        CTX_AGENT_NAME: 'dashboard-test',
        CTX_ORG: 'clean-green-marketing',
        TEST_TSX_CLI: path.resolve('node_modules/tsx/dist/cli.mjs'),
        TEST_CLI_TS: path.resolve('src/cli/index.ts'),
        TEST_FIXTURE_DIR: fixtureDir,
      },
      timeout: 20_000,
    });

    const parsed = JSON.parse(output) as { ok?: boolean; drained?: number };
    expect(parsed.ok).toBe(true);
    expect(parsed.drained).toBe(1);
    const terminal = readQueueEntries().find((entry) => entry.queueId === 'q-live');
    expect(terminal?.status).toBe('succeeded');
    expect(fs.existsSync(path.join(fixtureDir, 'global-lock-seen'))).toBe(true);
    expect(fs.existsSync(path.join(rootTmp, 'state', 'switch-jobs', 'locks', 'global.lock'))).toBe(false);
    const calls = fs.readFileSync(path.join(fixtureDir, 'calls.log'), 'utf-8').trim().split('\n');
    expect(calls).toContain('switch-agent-account --drain-switch-queue --json');
    expect(calls).toContain('switch-agent-account a1 moonlight --json');
    expect(calls.filter((line) => line === 'bus list-agent-accounts --json').length).toBeGreaterThanOrEqual(3);
  });

  it('replaces only pending entries, preserving seq and auditing replaced', async () => {
    const ops = makeOps({ uuids: ['q-x'] });
    await enqueue('a1', 'moonlight', 'replace-1@example.test', ops);
    await enqueue('a1', 'deepseek', 'replace-2@example.test', ops);

    const entries = readQueueEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].seq).toBe(0);
    expect(entries[0].targetAccount).toBe('deepseek');
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'a1',
      from: 'moonlight',
      to: 'deepseek',
      outcome: 'replaced',
    }));
  });

  it('never mutates a draining entry when a new target is queued for the same agent', async () => {
    const ops = makeOps({ uuids: ['q-x', 'job-x', 'q-next'] });
    await enqueue('a1', 'moonlight', 'drain-1@example.test', ops);
    const first = readQueueEntries()[0];
    writeQueueEntry({ ...first, status: 'draining', jobId: 'job-x' });

    const res = await enqueue('a1', 'deepseek', 'drain-2@example.test', ops);

    expect(res.status).toBe(202);
    const entries = readQueueEntries().sort((a, b) => a.seq - b.seq);
    expect(entries).toHaveLength(2);
    expect(entries[0].status).toBe('draining');
    expect(entries[0].targetAccount).toBe('moonlight');
    expect(entries[1].status).toBe('pending');
    expect(entries[1].targetAccount).toBe('deepseek');
  });

  it('uses live drain-time validation, not the enqueued snapshot', async () => {
    const targetOps = makeOps({ uuids: ['q-target'] });
    await enqueue('a1', 'moonlight', 'target@example.test', targetOps);
    targetOps.vaultRows = [];
    const targetGone = await mod.drainSwitchQueue(targetOps);
    expect(targetGone.map((entry) => entry.status)).toEqual(['target-gone']);
    expect(targetOps.spawnSwitch).not.toHaveBeenCalled();

    const ops = makeOps({ uuids: ['q-agent', 'q-noop'] });
    await enqueue('a1', 'moonlight', 'agent-gone@example.test', ops);
    await enqueue('a2', 'moonlight', 'agent@example.test', ops);

    ops.agentRows = [{ agent: 'a2', account: 'moonlight', source: 'live' }];
    const drained = await mod.drainSwitchQueue(ops);
    expect(drained.map((entry) => entry.status)).toEqual(['agent-gone', 'already-at-target']);
    expect(ops.spawnSwitch).not.toHaveBeenCalled();
  });

  it('leaves entries pending when live resolvers are temporarily unavailable', async () => {
    const agentOps = makeOps({ uuids: ['q-agent'] });
    await enqueue('a1', 'moonlight', 'agent-unavailable@example.test', agentOps);
    agentOps.agentRows = null;
    const agentUnavailable = await mod.drainSwitchQueue(agentOps);
    expect(agentUnavailable).toHaveLength(1);
    expect(agentUnavailable[0].status).toBe('pending');
    expect(readQueueEntries().find((entry) => entry.queueId === 'q-agent')?.status).toBe('pending');
    expect(agentOps.spawnSwitch).not.toHaveBeenCalled();
    fs.rmSync(path.join(rootTmp, 'state', 'switch-jobs', 'queue'), { recursive: true, force: true });

    const vaultOps = makeOps({ uuids: ['q-vault'] });
    await enqueue('a1', 'moonlight', 'vault-unavailable@example.test', vaultOps);
    vaultOps.vaultRows = null;
    const vaultUnavailable = await mod.drainSwitchQueue(vaultOps);
    expect(vaultUnavailable).toHaveLength(1);
    expect(vaultUnavailable[0].status).toBe('pending');
    expect(readQueueEntries().find((entry) => entry.queueId === 'q-vault')?.status).toBe('pending');
    expect(vaultOps.spawnSwitch).not.toHaveBeenCalled();
  });

  it('cancels pending entries but not draining entries', () => {
    const ops = makeOps({ uuids: ['q-cancel', 'q-run'] });
    const pending = writeQueueEntry(makeEntry({ queueId: 'q-cancel', seq: 0, status: 'pending' }));
    writeQueueEntry(makeEntry({ queueId: 'q-run', seq: 1, status: 'draining', jobId: 'job-run' }));

    const cancelled = mod.cancelSwitchQueueEntry(makeDeleteRequest('q-cancel'), pending.queueId, admin('cancel@example.test'), ops);
    expect(cancelled.status).toBe(200);
    expect(readQueueEntries().find((entry) => entry.queueId === 'q-cancel')?.status).toBe('cancelled');

    const running = mod.cancelSwitchQueueEntry(makeDeleteRequest('q-run'), 'q-run', admin('run@example.test'), ops);
    expect(running.status).toBe(409);
    expect(readQueueEntries().find((entry) => entry.queueId === 'q-run')?.status).toBe('draining');

    const missing = mod.cancelSwitchQueueEntry(makeDeleteRequest('missing'), 'missing', admin('missing@example.test'), ops);
    expect(missing.status).toBe(404);
  });

  it('rejects auth, csrf, and traversal before enqueue or cancel side effects while auditing outcomes', async () => {
    const ops = makeOps();

    const unauth = await mod.enqueueSwitchRequest(makeRequest({ agent: 'a1', targetAccount: 'moonlight' }), null, ops);
    expect(unauth.status).toBe(401);

    const forbidden = await mod.enqueueSwitchRequest(makeRequest({ agent: 'a1', targetAccount: 'moonlight' }), { user: { name: 'viewer', email: 'viewer@example.test' } }, ops);
    expect(forbidden.status).toBe(403);

    const badCsrf = await mod.enqueueSwitchRequest(makeRequest({ agent: 'a1', targetAccount: 'moonlight' }, { csrf: 'wrong' }), admin('csrf@example.test'), ops);
    expect(badCsrf.status).toBe(403);

    const invalid = await mod.enqueueSwitchRequest(makeRequest({ agent: '../a1', targetAccount: 'moonlight' }), admin('invalid@example.test'), ops);
    expect(invalid.status).toBe(400);

    expect(readQueueEntries()).toEqual([]);
    expect(ops.spawnQueueWorker).not.toHaveBeenCalled();
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'UNAUTHENTICATED' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'FORBIDDEN' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'BAD_CSRF' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'INVALID_INPUT' }));
  });

  it('reconciles stale locks, orphaned draining entries, and respawns a worker for pending entries', () => {
    const ops = makeOps({ pidAlive: false });
    fs.mkdirSync(path.join(rootTmp, 'state', 'switch-jobs', 'locks'), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(rootTmp, 'state', 'switch-jobs', 'locks', 'queue-worker.lock'), JSON.stringify({ pid: 999, startedAtMs: 1_000 }), { mode: 0o600 });
    writeQueueEntry(makeEntry({ queueId: 'q-orphan', seq: 0, status: 'draining', jobId: 'job-terminal' }));
    writeRecord({
      jobId: 'job-terminal',
      agent: 'a1',
      targetAccount: 'moonlight',
      sourceAccount: 'me-com',
      actor: 'admin',
      pid: 123,
      startedAt: new Date(1_000).toISOString(),
      startedAtMs: 1_000,
      status: 'succeeded',
      resultSummary: 'done',
    });
    writeQueueEntry(makeEntry({ queueId: 'q-pending', seq: 1, status: 'pending', agent: 'a2' }));

    const status = mod.reconcileSwitchQueue(ops);

    expect(status.recent.find((entry) => entry.queueId === 'q-orphan')?.status).toBe('succeeded');
    expect(ops.spawnQueueWorker).toHaveBeenCalledTimes(1);
  });
});

async function enqueue(agent: string, targetAccount: string, email: string, ops: TestQueueOps) {
  return mod.enqueueSwitchRequest(makeRequest({ agent, targetAccount }), admin(email), ops);
}

function makeRequest(
  body: Record<string, unknown>,
  options: { csrf?: string; origin?: string } = {},
): NextRequest {
  const csrf = options.csrf ?? 'csrf-token';
  const origin = options.origin ?? 'http://localhost:3000';
  return new NextRequest('http://localhost:3000/api/accounts/switch/queue', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `authjs.csrf-token=${encodeURIComponent('csrf-token|hash')}`,
      'x-csrf-token': csrf,
      origin,
      referer: `${origin}/accounts`,
    },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(queueId: string): NextRequest {
  const origin = 'http://localhost:3000';
  return new NextRequest(`http://localhost:3000/api/accounts/switch/queue/${queueId}`, {
    method: 'DELETE',
    headers: {
      cookie: `authjs.csrf-token=${encodeURIComponent('csrf-token|hash')}`,
      'x-csrf-token': 'csrf-token',
      origin,
      referer: `${origin}/accounts`,
    },
  });
}

function admin(email = 'admin@example.test') {
  return { user: { name: 'admin', email } };
}

interface TestQueueOps extends SwitchQueueOps {
  calls: string[];
  agentRows: AgentAccountOption[] | null;
  vaultRows: VaultAccountOption[] | null;
}

function makeOps(options: {
  now?: number;
  uuids?: string[];
  pidAlive?: boolean;
  agentRows?: AgentAccountOption[] | null;
  vaultRows?: VaultAccountOption[] | null;
} = {}): TestQueueOps {
  const calls: string[] = [];
  const uuids = [...(options.uuids ?? [])];
  let now = options.now ?? 100_000;
  const ops: TestQueueOps = {
    calls,
    agentRows: options.agentRows ?? [
      { agent: 'a1', account: 'me-com', source: 'live' },
      { agent: 'a2', account: 'me-com', source: 'live' },
      { agent: 'a3', account: 'me-com', source: 'live' },
    ],
    vaultRows: options.vaultRows ?? [
      { account: 'moonlight', hasToken: true },
      { account: 'deepseek', hasToken: true },
    ],
    now: () => {
      now += 11_000;
      return now;
    },
    uuid: () => uuids.shift() ?? `id-${calls.length + 1}`,
    readAgentAccounts: vi.fn(() => ops.agentRows),
    readVaultAccounts: vi.fn(() => ops.vaultRows),
    spawnSwitch: vi.fn((args, stdoutPath) => {
      calls.push(`spawnSwitch:${args[1]}->${args[2]}`);
      const agent = String(args[1]);
      const targetAccount = String(args[2]);
      ops.agentRows = (ops.agentRows ?? []).map((row) => row.agent === agent
        ? { ...row, account: targetAccount }
        : row);
      fs.writeFileSync(stdoutPath, JSON.stringify({ status: 'success', message: `switched ${args[1]}` }));
      return { pid: 1234, unref: vi.fn() } as unknown as ChildProcess;
    }),
    spawnQueueWorker: vi.fn(() => {
      calls.push('spawnQueueWorker');
      return { pid: 4321, unref: vi.fn() } as unknown as ChildProcess;
    }),
    isPidAlive: vi.fn(() => options.pidAlive ?? true),
    processStartMs: vi.fn(() => 2_000),
    audit: vi.fn(),
  };
  return ops;
}

function makeEntry(overrides: Partial<QueueEntryRecord>): QueueEntryRecord {
  return {
    queueId: 'q',
    seq: 0,
    agent: 'a1',
    targetAccount: 'moonlight',
    actor: 'admin@example.test',
    enqueuedAt: new Date(1_000).toISOString(),
    enqueuedAtMs: 1_000,
    status: 'pending',
    ...overrides,
  };
}

function writeQueueEntry(entry: QueueEntryRecord): QueueEntryRecord {
  const dir = path.join(rootTmp, 'state', 'switch-jobs', 'queue');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, `${entry.seq}-${entry.agent}.json`), JSON.stringify(entry), { mode: 0o600 });
  return entry;
}

function readQueueEntries(): QueueEntryRecord[] {
  const dir = path.join(rootTmp, 'state', 'switch-jobs', 'queue');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8')) as QueueEntryRecord);
}

function writeLock(value: Record<string, unknown>) {
  const dir = path.join(rootTmp, 'state', 'switch-jobs', 'locks');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'global.lock'), JSON.stringify(value), { mode: 0o600 });
}

function writeRecord(record: Record<string, unknown>) {
  const dir = path.join(rootTmp, 'state', 'switch-jobs');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, `${record.jobId}.json`), JSON.stringify(record), { mode: 0o600 });
}

function writeCortextosShim(dir: string): string {
  const shimPath = path.join(dir, 'cortextos');
  fs.writeFileSync(shimPath, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
const fixtureDir = process.env.TEST_FIXTURE_DIR;
const ctxRoot = process.env.CTX_ROOT;
function appendCall() {
  fs.appendFileSync(path.join(fixtureDir, 'calls.log'), args.join(' ') + '\\n');
}
function readCount() {
  const file = path.join(fixtureDir, 'agent-count');
  try { return Number(fs.readFileSync(file, 'utf-8')) || 0; } catch { return 0; }
}
function writeCount(value) {
  fs.writeFileSync(path.join(fixtureDir, 'agent-count'), String(value));
}
appendCall();
if (args[0] === 'switch-agent-account' && args[1] === '--drain-switch-queue') {
  const result = spawnSync(process.execPath, [process.env.TEST_TSX_CLI, process.env.TEST_CLI_TS, ...args], {
    encoding: 'utf-8',
    env: process.env,
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.exit(result.status == null ? 1 : result.status);
}
if (args[0] === 'bus' && args[1] === 'list-agent-accounts' && args[2] === '--json') {
  const count = readCount() + 1;
  writeCount(count);
  const switched = fs.existsSync(path.join(fixtureDir, 'switched'));
  const account = switched && count >= 3 ? 'moonlight' : 'me-com';
  console.log(JSON.stringify([{ agent: 'a1', account, source: 'fixture' }]));
  process.exit(0);
}
if (args[0] === 'list-vault-accounts' && args[1] === '--json') {
  console.log(JSON.stringify([{ account: 'moonlight', hasToken: true }]));
  process.exit(0);
}
if (args[0] === 'bus' && args[1] === 'log-event') {
  process.exit(0);
}
if (args[0] === 'switch-agent-account' && args[1] === 'a1' && args[2] === 'moonlight' && args[3] === '--json') {
  const globalLock = path.join(ctxRoot, 'state', 'switch-jobs', 'locks', 'global.lock');
  if (fs.existsSync(globalLock)) fs.writeFileSync(path.join(fixtureDir, 'global-lock-seen'), 'yes');
  fs.writeFileSync(path.join(fixtureDir, 'switched'), 'yes');
  console.log(JSON.stringify({ ok: true, status: 'success', message: 'fixture switch success' }));
  process.exit(0);
}
console.error('unexpected cortextos fixture call: ' + args.join(' '));
process.exit(9);
`, { mode: 0o700 });
  fs.chmodSync(shimPath, 0o700);
  return shimPath;
}
