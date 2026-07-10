import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import type { NextRequest } from 'next/server';
import { getCTXRoot, getFrameworkRoot } from '@/lib/config';

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const JOB_ID_RE = /^[A-Za-z0-9-]+$/;
const LOCK_TIMEOUT_MS = 5 * 60_000;
const POST_RATE_LIMIT_MS = 10_000;
const SWITCH_JOB_DIR_MODE = 0o700;
const SWITCH_JOB_FILE_MODE = 0o600;
const SWITCH_CLI = 'cortextos';

export interface SwitchSession {
  user?: {
    name?: string | null;
    email?: string | null;
  } | null;
}

export interface AgentAccountOption {
  org?: string;
  agent: string;
  account: string | null;
  source: string | null;
}

export interface VaultAccountOption {
  account: string;
  hasToken: true;
  metered?: boolean;
  tier?: string;
}

export interface SwitchJobRecord {
  jobId: string;
  agent: string;
  targetAccount: string;
  sourceAccount: string | null;
  actor: string;
  pid: number;
  startedAt: string;
  startedAtMs: number;
  status: 'running' | 'succeeded' | 'failed' | 'crashed';
  processStartMs?: number | null;
  endedAt?: string;
  resultSummary?: string;
  functionalSweepTaskId?: string;
  error?: string;
}

export interface SwitchStatusResponse {
  jobId: string;
  agent: string;
  targetAccount: string;
  sourceAccount: string | null;
  actor: string;
  status: SwitchJobRecord['status'];
  startedAt: string;
  endedAt?: string;
  elapsedMs: number;
  resultSummary?: string;
  functionalSweepTaskId?: string;
  error?: string;
  attributionAccount?: string | null;
}

export interface AccountSwitchOps {
  now(): number;
  uuid(): string;
  readAgentAccounts(): AgentAccountOption[] | null;
  readVaultAccounts(): VaultAccountOption[] | null;
  spawnSwitch(args: string[], stdoutPath: string, stderrPath: string): ChildProcess;
  isPidAlive(pid: number): boolean;
  processStartMs(pid: number): number | null;
  audit(event: Record<string, unknown>): void;
}

export class AccountSwitchHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

const actorAttempts = new Map<string, number>();

export const defaultAccountSwitchOps: AccountSwitchOps = {
  now: () => Date.now(),
  uuid: () => randomUUID(),
  readAgentAccounts,
  readVaultAccounts,
  spawnSwitch(args, stdoutPath, stderrPath) {
    const stdout = fs.openSync(stdoutPath, 'a', SWITCH_JOB_FILE_MODE);
    const stderr = fs.openSync(stderrPath, 'a', SWITCH_JOB_FILE_MODE);
    try {
      const child = spawn(SWITCH_CLI, args, {
        detached: true,
        stdio: ['ignore', stdout, stderr],
        env: switchCliEnv(),
      });
      child.unref();
      return child;
    } finally {
      fs.closeSync(stdout);
      fs.closeSync(stderr);
    }
  },
  isPidAlive,
  processStartMs,
  audit: auditSwitchAttempt,
};

export function jobsDir(): string {
  return path.join(getCTXRoot(), 'state', 'switch-jobs');
}

export function locksDir(): string {
  return path.join(jobsDir(), 'locks');
}

export function jobRecordPath(jobId: string): string {
  assertValidJobId(jobId);
  return path.join(jobsDir(), `${jobId}.json`);
}

export function jobOutputPath(jobId: string): string {
  assertValidJobId(jobId);
  return path.join(jobsDir(), `${jobId}.out`);
}

export function jobErrorPath(jobId: string): string {
  assertValidJobId(jobId);
  return path.join(jobsDir(), `${jobId}.err`);
}

export function assertValidJobId(jobId: string): void {
  if (!JOB_ID_RE.test(jobId) || jobId.includes('..')) {
    throw new AccountSwitchHttpError(400, 'Invalid jobId', 'INVALID_JOB_ID');
  }
}

export function isValidName(value: string): boolean {
  return NAME_RE.test(value);
}

export function isAdminSession(session: SwitchSession | null | undefined): boolean {
  const admin = process.env.ADMIN_USERNAME ?? 'admin';
  const name = session?.user?.name;
  return typeof name === 'string' && name === admin;
}

export function actorFromSession(session: SwitchSession): string {
  return session.user?.email ?? session.user?.name ?? 'unknown';
}

export function verifyCsrfAndOrigin(request: NextRequest): void {
  let requestOrigin = new URL(request.url).origin;
  if (process.env.TRUST_PROXY === 'true') {
    const forwardedProto = request.headers.get('x-forwarded-proto')?.trim().toLowerCase();
    const forwardedHost = request.headers.get('x-forwarded-host')?.trim();
    const host = forwardedHost ?? request.headers.get('host')?.trim();
    if (forwardedProto !== 'https' || !host || host.includes(',')) {
      throw new AccountSwitchHttpError(403, 'Same-origin check failed', 'BAD_ORIGIN');
    }
    if (!/^[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/.test(host)) {
      throw new AccountSwitchHttpError(403, 'Same-origin check failed', 'BAD_ORIGIN');
    }
    requestOrigin = `https://${host}`;
  }
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const refererOrigin = referer ? safeOrigin(referer) : null;
  if (!origin && !refererOrigin) {
    throw new AccountSwitchHttpError(403, 'Same-origin check failed', 'BAD_ORIGIN');
  }
  if ((origin && origin !== requestOrigin) || (refererOrigin && refererOrigin !== requestOrigin)) {
    throw new AccountSwitchHttpError(403, 'Same-origin check failed', 'BAD_ORIGIN');
  }

  const headerToken = request.headers.get('x-csrf-token') ?? request.headers.get('x-authjs-csrf-token');
  const cookieToken = csrfCookieToken(request);
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    throw new AccountSwitchHttpError(403, 'CSRF check failed', 'BAD_CSRF');
  }
}

export function csrfCookieToken(request: NextRequest): string | null {
  const value = request.cookies.get('authjs.csrf-token')?.value;
  if (!value) return null;
  const decoded = decodeURIComponent(value);
  const token = decoded.split('|')[0];
  return token.length > 0 ? token : null;
}

export function rateLimitActor(actor: string, now: number, attempts = actorAttempts): boolean {
  const last = attempts.get(actor);
  if (last !== undefined && now - last < POST_RATE_LIMIT_MS) return false;
  attempts.set(actor, now);
  return true;
}

export async function startSwitchJob(
  request: NextRequest,
  session: SwitchSession | null | undefined,
  ops: AccountSwitchOps = defaultAccountSwitchOps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const actor = session ? actorFromSession(session) : 'anonymous';
  let agent = '';
  let targetAccount = '';
  try {
    if (!session) throw new AccountSwitchHttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    if (!isAdminSession(session)) throw new AccountSwitchHttpError(403, 'Admin access required', 'FORBIDDEN');
    verifyCsrfAndOrigin(request);

    const body = await readJsonBody(request);
    agent = typeof body.agent === 'string' ? body.agent : '';
    targetAccount = typeof body.targetAccount === 'string' ? body.targetAccount : '';
    if (!isValidName(agent) || !isValidName(targetAccount)) {
      throw new AccountSwitchHttpError(400, 'Invalid agent or targetAccount', 'INVALID_INPUT');
    }
    if (!rateLimitActor(actor, ops.now())) {
      throw new AccountSwitchHttpError(429, 'Switch request rate limit exceeded', 'RATE_LIMITED');
    }

    const agentRows = ops.readAgentAccounts();
    const vaultRows = ops.readVaultAccounts();
    if (!agentRows) throw new AccountSwitchHttpError(503, 'agent account resolver unavailable', 'AGENT_RESOLVER_UNAVAILABLE');
    if (!vaultRows) throw new AccountSwitchHttpError(503, 'switch CLI unavailable', 'VAULT_ACCOUNTS_UNAVAILABLE');
    const source = agentRows.find((row) => row.agent === agent);
    if (!source) throw new AccountSwitchHttpError(400, 'Unknown agent', 'UNKNOWN_AGENT');
    if (!vaultRows.some((row) => row.account === targetAccount && row.hasToken === true)) {
      throw new AccountSwitchHttpError(400, 'Unknown target account', 'UNKNOWN_TARGET');
    }

    const jobId = ops.uuid();
    assertValidJobId(jobId);
    const startedAtMs = ops.now();
    ensureJobDirs();
    acquireGlobalLock(ops, { jobId, startedAtMs });
    const outPath = jobOutputPath(jobId);
    const errPath = jobErrorPath(jobId);
    fs.writeFileSync(outPath, '', { mode: SWITCH_JOB_FILE_MODE });
    fs.writeFileSync(errPath, '', { mode: SWITCH_JOB_FILE_MODE });
    const args = ['switch-agent-account', agent, targetAccount, '--json'];
    let child: ChildProcess;
    try {
      child = ops.spawnSwitch(args, outPath, errPath);
    } catch {
      releaseGlobalLock(jobId);
      throw new AccountSwitchHttpError(503, 'switch CLI unavailable', 'SPAWN_FAILED');
    }
    const pid = child.pid;
    if (!pid || pid <= 0) {
      releaseGlobalLock(jobId);
      throw new AccountSwitchHttpError(503, 'switch CLI unavailable', 'SPAWN_FAILED');
    }
    const processStart = ops.processStartMs(pid);
    const record: SwitchJobRecord = {
      jobId,
      agent,
      targetAccount,
      sourceAccount: source.account,
      actor,
      pid,
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      status: 'running',
      processStartMs: processStart,
    };
    writeJson0600(jobRecordPath(jobId), record);
    writeJson0600(globalLockPath(), { jobId, pid, startedAtMs });
    ops.audit({ actor, agent, from: source.account, to: targetAccount, jobId, outcome: 'started' });
    return { status: 202, body: { jobId } };
  } catch (err) {
    const http = toHttpError(err);
    ops.audit({ actor, agent: agent || undefined, to: targetAccount || undefined, outcome: http.code });
    return { status: http.status, body: { error: http.message, code: http.code } };
  }
}

export function getSwitchJobStatus(
  jobId: string,
  ops: AccountSwitchOps = defaultAccountSwitchOps,
): SwitchStatusResponse {
  assertValidJobId(jobId);
  const record = readJobRecord(jobId);
  if (!record) throw new AccountSwitchHttpError(404, 'Switch job not found', 'JOB_NOT_FOUND');
  const derived = deriveSwitchStatus(record, ops);
  return toStatusResponse(derived, ops.now(), ops);
}

export function deriveSwitchStatus(record: SwitchJobRecord, ops: AccountSwitchOps): SwitchJobRecord {
  if (record.status !== 'running') return record;
  const now = ops.now();
  const output = readTextIfPresent(jobOutputPath(record.jobId));
  const parsed = parseCliResult(output);
  const attribution = ops.readAgentAccounts()?.find((row) => row.agent === record.agent);
  const matchesTarget = attribution?.account === record.targetAccount;

  if (parsed) {
    const ok = parsed.ok !== false && parsed.status === 'success' && matchesTarget;
    const updated: SwitchJobRecord = {
      ...record,
      status: ok ? 'succeeded' : 'failed',
      endedAt: new Date(now).toISOString(),
      resultSummary: parsed.message ?? (ok ? 'auth flip verified; functional sweep pending' : 'switch failed'),
      functionalSweepTaskId: parsed.functionalSweepTaskId,
      ...(ok ? {} : { error: parsed.error ?? parsed.message ?? 'switch failed' }),
    };
    writeJson0600(jobRecordPath(record.jobId), updated);
    releaseGlobalLock(record.jobId);
    return updated;
  }

  const alive = ops.isPidAlive(record.pid);
  const startMs = alive ? ops.processStartMs(record.pid) : null;
  const startMatches = alive &&
    startMs !== null &&
    typeof record.processStartMs === 'number' &&
    Math.abs(startMs - record.processStartMs) < 1000;
  const startMismatches = alive &&
    startMs !== null &&
    typeof record.processStartMs === 'number' &&
    !startMatches;
  if (alive && !startMismatches && now - record.startedAtMs <= LOCK_TIMEOUT_MS) return record;

  const updated: SwitchJobRecord = {
    ...record,
    status: 'crashed',
    endedAt: new Date(now).toISOString(),
    error: alive ? 'switch timed out or no longer matches the original process' : 'switch process exited without a final result',
  };
  writeJson0600(jobRecordPath(record.jobId), updated);
  releaseGlobalLock(record.jobId);
  return updated;
}

export function readAgentAccounts(): AgentAccountOption[] | null {
  try {
    const output = execFileSync(SWITCH_CLI, ['bus', 'list-agent-accounts', '--json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      env: switchCliEnv(),
    });
    const parsed = JSON.parse(output) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((row): AgentAccountOption[] => {
      if (!row || typeof row !== 'object') return [];
      const r = row as Record<string, unknown>;
      if (typeof r.agent !== 'string') return [];
      return [{
        ...(typeof r.org === 'string' ? { org: r.org } : {}),
        agent: r.agent,
        account: typeof r.account === 'string' ? r.account : null,
        source: typeof r.source === 'string' ? r.source : null,
      }];
    });
  } catch {
    return null;
  }
}

export function readVaultAccounts(): VaultAccountOption[] | null {
  try {
    const output = execFileSync(SWITCH_CLI, ['list-vault-accounts', '--json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      env: switchCliEnv(),
    });
    const parsed = JSON.parse(output) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((row): VaultAccountOption[] => {
      if (!row || typeof row !== 'object') return [];
      const r = row as Record<string, unknown>;
      if (typeof r.account !== 'string' || r.hasToken !== true) return [];
      return [{
        account: r.account,
        hasToken: true,
        ...(typeof r.metered === 'boolean' ? { metered: r.metered } : {}),
        ...(typeof r.tier === 'string' ? { tier: r.tier } : {}),
      }];
    });
  } catch {
    return null;
  }
}

function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  return request.json().then((body: unknown) => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AccountSwitchHttpError(400, 'Invalid JSON body', 'INVALID_JSON');
    }
    return body as Record<string, unknown>;
  }).catch((err) => {
    if (err instanceof AccountSwitchHttpError) throw err;
    throw new AccountSwitchHttpError(400, 'Invalid JSON body', 'INVALID_JSON');
  });
}

function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function ensureJobDirs(): void {
  fs.mkdirSync(jobsDir(), { recursive: true, mode: SWITCH_JOB_DIR_MODE });
  fs.chmodSync(jobsDir(), SWITCH_JOB_DIR_MODE);
  fs.mkdirSync(locksDir(), { recursive: true, mode: SWITCH_JOB_DIR_MODE });
  fs.chmodSync(locksDir(), SWITCH_JOB_DIR_MODE);
}

function globalLockPath(): string {
  return path.join(locksDir(), 'global.lock');
}

function acquireGlobalLock(ops: AccountSwitchOps, reservation: { jobId: string; startedAtMs: number }): void {
  ensureJobDirs();
  const lockPath = globalLockPath();
  try {
    writeJsonNew0600(lockPath, { jobId: reservation.jobId, startedAtMs: reservation.startedAtMs });
    return;
  } catch {
    // Fall through to stale-lock evaluation.
  }
  if (fs.existsSync(lockPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { jobId?: string; pid?: number; startedAtMs?: number };
      if (typeof raw.jobId === 'string') {
        const record = readJobRecord(raw.jobId);
        if (record && deriveSwitchStatus(record, ops).status === 'running') {
          throw new AccountSwitchHttpError(409, 'switch already in progress', 'SWITCH_IN_PROGRESS');
        }
      }
      if (typeof raw.pid === 'number' && ops.isPidAlive(raw.pid) && typeof raw.startedAtMs === 'number' && ops.now() - raw.startedAtMs <= LOCK_TIMEOUT_MS) {
        throw new AccountSwitchHttpError(409, 'switch already in progress', 'SWITCH_IN_PROGRESS');
      }
      fs.rmSync(lockPath, { force: true });
    } catch (err) {
      if (err instanceof AccountSwitchHttpError) throw err;
      fs.rmSync(lockPath, { force: true });
    }
  }
  writeJsonNew0600(lockPath, { jobId: reservation.jobId, startedAtMs: reservation.startedAtMs });
}

function releaseGlobalLock(jobId?: string): void {
  const lockPath = globalLockPath();
  if (!fs.existsSync(lockPath)) return;
  if (jobId) {
    try {
      const raw = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { jobId?: string };
      if (raw.jobId !== jobId) return;
    } catch {
      return;
    }
  }
  fs.rmSync(lockPath, { force: true });
}

function readJobRecord(jobId: string): SwitchJobRecord | null {
  try {
    return JSON.parse(fs.readFileSync(jobRecordPath(jobId), 'utf-8')) as SwitchJobRecord;
  } catch {
    return null;
  }
}

function writeJson0600(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { mode: SWITCH_JOB_FILE_MODE });
  fs.chmodSync(filePath, SWITCH_JOB_FILE_MODE);
}

function writeJsonNew0600(filePath: string, value: unknown): void {
  const fd = fs.openSync(filePath, 'wx', SWITCH_JOB_FILE_MODE);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(filePath, SWITCH_JOB_FILE_MODE);
}

function readTextIfPresent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function parseCliResult(output: string): { ok?: boolean; status?: string; message?: string; error?: string; functionalSweepTaskId?: string } | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return {
      ...(typeof parsed.ok === 'boolean' ? { ok: parsed.ok } : {}),
      ...(typeof parsed.status === 'string' ? { status: parsed.status } : {}),
      ...(typeof parsed.message === 'string' ? { message: parsed.message } : {}),
      ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
      ...(typeof parsed.functionalSweepTaskId === 'string' ? { functionalSweepTaskId: parsed.functionalSweepTaskId } : {}),
    };
  } catch {
    return null;
  }
}

function toStatusResponse(record: SwitchJobRecord, now: number, ops: AccountSwitchOps): SwitchStatusResponse {
  const attribution = ops.readAgentAccounts()?.find((row) => row.agent === record.agent);
  return {
    jobId: record.jobId,
    agent: record.agent,
    targetAccount: record.targetAccount,
    sourceAccount: record.sourceAccount,
    actor: record.actor,
    status: record.status,
    startedAt: record.startedAt,
    ...(record.endedAt ? { endedAt: record.endedAt } : {}),
    elapsedMs: Math.max(0, now - record.startedAtMs),
    ...(record.resultSummary ? { resultSummary: record.resultSummary } : {}),
    ...(record.functionalSweepTaskId ? { functionalSweepTaskId: record.functionalSweepTaskId } : {}),
    ...(record.error ? { error: record.error } : {}),
    ...(attribution ? { attributionAccount: attribution.account } : {}),
  };
}

function toHttpError(err: unknown): AccountSwitchHttpError {
  if (err instanceof AccountSwitchHttpError) return err;
  return new AccountSwitchHttpError(500, 'Switch request failed', 'SWITCH_REQUEST_FAILED');
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processStartMs(pid: number): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const output = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    const parsed = Date.parse(output);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

function switchCliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CTX_ROOT: getCTXRoot(),
    CTX_FRAMEWORK_ROOT: getFrameworkRoot(),
    CTX_PROJECT_ROOT: getFrameworkRoot(),
    CTX_INSTANCE_ID: process.env.CTX_INSTANCE_ID ?? 'default',
    CTX_AGENT_NAME: process.env.CTX_AGENT_NAME ?? 'dashboard',
  };
}

function auditSwitchAttempt(event: Record<string, unknown>): void {
  try {
    execFileSync(SWITCH_CLI, ['bus', 'log-event', 'action', 'account_switch_attempt', 'info', '--meta', JSON.stringify(event)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
      env: switchCliEnv(),
    });
  } catch {
    // Audit is best-effort; route responses are still governed by the checks above.
  }
}
