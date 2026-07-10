import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import {
  AccountSwitchHttpError,
  actorFromSession,
  acquireExclusiveLock,
  defaultAccountSwitchOps,
  deriveSwitchStatus,
  ensureJobDirs,
  isAdminSession,
  isValidName,
  jobsDir,
  locksDir,
  rateLimitActor,
  readJobRecord,
  runOneSwitch,
  SWITCH_JOB_DIR_MODE,
  SWITCH_JOB_FILE_MODE,
  SWITCH_JOB_MAX_MS,
  validateSwitchTarget,
  validationToHttpError,
  verifyCsrfAndOrigin,
  writeJson0600,
  writeJsonNew0600,
  type AccountSwitchRequestLike,
  type AccountSwitchOps,
  type SwitchJobRecord,
  type SwitchSession,
} from './account-switch-core';

export type QueueEntryStatus =
  | 'pending'
  | 'draining'
  | 'succeeded'
  | 'failed'
  | 'crashed'
  | 'suspect'
  | 'agent-gone'
  | 'target-gone'
  | 'already-at-target'
  | 'cancelled'
  | 'superseded';

export interface QueueEntryRecord {
  queueId: string;
  seq: number;
  agent: string;
  targetAccount: string;
  actor: string;
  enqueuedAt: string;
  enqueuedAtMs: number;
  status: QueueEntryStatus;
  jobId?: string;
  supersededBy?: string;
  cancelledAt?: string;
  endedAt?: string;
  resultSummary?: string;
  error?: string;
}

export interface SwitchQueueStatus {
  pending: QueueEntryRecord[];
  draining: QueueEntryRecord | null;
  recent: QueueEntryRecord[];
}

export interface SwitchQueueOps extends AccountSwitchOps {
  spawnQueueWorker(): ChildProcess;
}

export const defaultSwitchQueueOps: SwitchQueueOps = {
  ...defaultAccountSwitchOps,
  spawnQueueWorker() {
    const child = spawn('cortextos', ['switch-agent-account', '--drain-switch-queue'], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return child;
  },
};

export function queueDir(): string {
  return path.join(jobsDir(), 'queue');
}

function seqPath(): string {
  return path.join(queueDir(), '.seq');
}

function enqueueLockPath(): string {
  return path.join(queueDir(), '.enqueue.lock');
}

export function queueWorkerLockPath(): string {
  return path.join(locksDir(), 'queue-worker.lock');
}

export function ensureQueueDirs(): void {
  ensureJobDirs();
  fs.mkdirSync(queueDir(), { recursive: true, mode: SWITCH_JOB_DIR_MODE });
  fs.chmodSync(queueDir(), SWITCH_JOB_DIR_MODE);
}

export async function enqueueSwitchRequest(
  request: AccountSwitchRequestLike,
  session: SwitchSession | null | undefined,
  ops: SwitchQueueOps = defaultSwitchQueueOps,
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

    const validation = validateSwitchTarget(agent, targetAccount, ops);
    if (!validation.ok && validation.code === 'ALREADY_AT_TARGET') {
      ops.audit({ actor, agent, to: targetAccount, outcome: 'already-at-target' });
      return { status: 200, body: { noop: true } };
    }
    if (!validation.ok) throw validationToHttpError(validation.code);

    const result = withQueueMutationLock(ops, () => enqueueEntry(agent, targetAccount, actor, ops));
    ensureDrainWorker(ops);
    return { status: 202, body: { queueId: result.entry.queueId, position: result.position } };
  } catch (err) {
    const http = toHttpError(err);
    ops.audit({ actor, agent: agent || undefined, to: targetAccount || undefined, outcome: http.code });
    return { status: http.status, body: { error: http.message, code: http.code } };
  }
}

export function getSwitchQueueStatus(
  session: SwitchSession | null | undefined,
  ops: SwitchQueueOps = defaultSwitchQueueOps,
): { status: number; body: SwitchQueueStatus | Record<string, unknown> } {
  if (!session) return { status: 401, body: { error: 'Authentication required', code: 'UNAUTHENTICATED' } };
  if (!isAdminSession(session)) return { status: 403, body: { error: 'Admin access required', code: 'FORBIDDEN' } };
  reconcileSwitchQueue(ops);
  return { status: 200, body: readQueueStatus(ops) };
}

export function cancelSwitchQueueEntry(
  request: AccountSwitchRequestLike,
  queueId: string,
  session: SwitchSession | null | undefined,
  ops: SwitchQueueOps = defaultSwitchQueueOps,
): { status: number; body: Record<string, unknown> } {
  const actor = session ? actorFromSession(session) : 'anonymous';
  try {
    if (!session) throw new AccountSwitchHttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    if (!isAdminSession(session)) throw new AccountSwitchHttpError(403, 'Admin access required', 'FORBIDDEN');
    verifyCsrfAndOrigin(request);
    if (!/^[A-Za-z0-9-]+$/.test(queueId) || queueId.includes('..')) {
      throw new AccountSwitchHttpError(400, 'Invalid queueId', 'INVALID_QUEUE_ID');
    }

    const result = withQueueMutationLock(ops, () => {
      const found = findEntryByQueueId(queueId);
      if (!found) throw new AccountSwitchHttpError(404, 'Queue entry not found', 'QUEUE_ENTRY_NOT_FOUND');
      if (found.entry.status !== 'pending') {
        throw new AccountSwitchHttpError(409, 'Cannot cancel a running or terminal switch', 'CANNOT_CANCEL_RUNNING');
      }
      const now = ops.now();
      const updated: QueueEntryRecord = {
        ...found.entry,
        status: 'cancelled',
        cancelledAt: new Date(now).toISOString(),
        endedAt: new Date(now).toISOString(),
        resultSummary: `Cancelled before switching to ${found.entry.targetAccount}.`,
      };
      writeQueueEntry(updated);
      return updated;
    });
    ops.audit({ actor, agent: result.agent, to: result.targetAccount, queueId: result.queueId, outcome: 'cancelled' });
    return { status: 200, body: { queueId: result.queueId, status: result.status } };
  } catch (err) {
    const http = toHttpError(err);
    ops.audit({ actor, queueId, outcome: http.code });
    return { status: http.status, body: { error: http.message, code: http.code } };
  }
}

export function reconcileSwitchQueue(ops: SwitchQueueOps = defaultSwitchQueueOps): SwitchQueueStatus {
  sweepStaleLock(queueWorkerLockPath(), ops);
  sweepStaleLock(path.join(locksDir(), 'global.lock'), ops);
  const entries = readQueueEntries();
  for (const entry of entries) {
    if (entry.status !== 'draining' || !entry.jobId) continue;
    const record = readJobRecord(entry.jobId);
    if (record && record.status === 'running') {
      const derived = deriveSwitchStatus(record, ops);
      if (derived.status !== 'running') copyFlipTerminalToQueue(entry, derived, ops);
      continue;
    }
    if (record && record.status !== 'running') {
      copyFlipTerminalToQueue(entry, record, ops);
      continue;
    }
    if (!queueWorkerLive(ops)) {
      writeQueueEntry({
        ...entry,
        status: 'crashed',
        endedAt: new Date(ops.now()).toISOString(),
        error: 'queue worker exited before writing a switch record',
        resultSummary: 'Queue worker exited before writing a switch record.',
      });
    }
  }
  const status = readQueueStatus(ops);
  if (status.pending.length > 0 && !queueWorkerLive(ops)) ensureDrainWorker(ops);
  return status;
}

export async function drainSwitchQueue(ops: SwitchQueueOps = defaultSwitchQueueOps): Promise<QueueEntryRecord[]> {
  const completed: QueueEntryRecord[] = [];
  try {
    acquireQueueWorkerLock(ops);
  } catch (err) {
    if (err instanceof AccountSwitchHttpError && err.status === 409) return [];
    throw err;
  }

  try {
    while (true) {
      const entry = withQueueMutationLock(ops, () => dequeueEntry(ops));
      if (!entry) break;
      const terminal = await drainOneEntry(entry, ops);
      completed.push(terminal);
      if (terminal.status === 'pending') break;
    }
    return completed;
  } finally {
    releaseQueueWorkerLock();
  }
}

async function drainOneEntry(entry: QueueEntryRecord, ops: SwitchQueueOps): Promise<QueueEntryRecord> {
  const current = findEntryByQueueId(entry.queueId)?.entry;
  if (!current || current.status !== 'draining') return current ?? entry;

  const validation = validateSwitchTarget(current.agent, current.targetAccount, ops);
  if (!validation.ok) {
    if (validation.code === 'AGENT_RESOLVER_UNAVAILABLE' || validation.code === 'VAULT_ACCOUNTS_UNAVAILABLE') {
      const pending: QueueEntryRecord = {
        ...current,
        status: 'pending',
        resultSummary: unavailableSummary(validation.code, current),
      };
      writeQueueEntry(pending);
      ops.audit({ actor: current.actor, agent: current.agent, to: current.targetAccount, queueId: current.queueId, outcome: validation.code });
      return pending;
    }
    const status = drainTerminalForValidation(validation.code);
    const terminal = markQueueTerminal(current, status, summaryForValidation(status, current), ops);
    ops.audit({ actor: current.actor, agent: current.agent, to: current.targetAccount, queueId: current.queueId, outcome: status });
    return terminal;
  }

  while (true) {
    try {
      const record = await runOneSwitch(
        current.agent,
        current.targetAccount,
        validation.sourceAccount,
        current.actor,
        current.jobId ?? ops.uuid(),
        ops,
      );
      const terminal = copyFlipTerminalToQueue(current, record, ops);
      ops.audit({ actor: current.actor, agent: current.agent, to: current.targetAccount, queueId: current.queueId, jobId: record.jobId, outcome: terminal.status });
      return terminal;
    } catch (err) {
      if (err instanceof AccountSwitchHttpError && err.code === 'SWITCH_IN_PROGRESS') {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      const terminal = markQueueTerminal(current, 'failed', message, ops, message);
      ops.audit({ actor: current.actor, agent: current.agent, to: current.targetAccount, queueId: current.queueId, outcome: 'failed' });
      return terminal;
    }
  }
}

function enqueueEntry(agent: string, targetAccount: string, actor: string, ops: SwitchQueueOps): { entry: QueueEntryRecord; position: number } {
  const existing = readQueueEntries()
    .filter((entry) => entry.agent === agent && (entry.status === 'pending' || entry.status === 'draining'))
    .sort((a, b) => a.seq - b.seq);
  const pending = existing.find((entry) => entry.status === 'pending');
  if (pending) {
    const oldTarget = pending.targetAccount;
    const updated: QueueEntryRecord = {
      ...pending,
      targetAccount,
      actor,
      enqueuedAt: new Date(ops.now()).toISOString(),
      enqueuedAtMs: ops.now(),
    };
    writeQueueEntry(updated);
    ops.audit({ actor, agent, from: oldTarget, to: targetAccount, queueId: updated.queueId, outcome: 'replaced' });
    return { entry: updated, position: queuePosition(updated.seq) };
  }

  const seq = nextSeq();
  const entry: QueueEntryRecord = {
    queueId: ops.uuid(),
    seq,
    agent,
    targetAccount,
    actor,
    enqueuedAt: new Date(ops.now()).toISOString(),
    enqueuedAtMs: ops.now(),
    status: 'pending',
  };
  writeQueueEntry(entry);
  ops.audit({ actor, agent, to: targetAccount, queueId: entry.queueId, outcome: 'enqueued' });
  return { entry, position: queuePosition(seq) };
}

function dequeueEntry(ops: SwitchQueueOps): QueueEntryRecord | null {
  const pending = readQueueEntries()
    .filter((entry) => entry.status === 'pending')
    .sort((a, b) => a.seq - b.seq)[0];
  if (!pending) return null;
  const updated: QueueEntryRecord = {
    ...pending,
    status: 'draining',
    jobId: ops.uuid(),
  };
  writeQueueEntry(updated);
  return updated;
}

function readQueueStatus(ops: SwitchQueueOps): SwitchQueueStatus {
  const entries = readQueueEntries();
  const pending = entries.filter((entry) => entry.status === 'pending').sort((a, b) => a.seq - b.seq);
  const draining = entries.find((entry) => entry.status === 'draining') ?? null;
  const recent = entries.filter((entry) => isTerminal(entry.status)).sort((a, b) => b.enqueuedAtMs - a.enqueuedAtMs).slice(0, 20);
  if (draining?.jobId) {
    const record = readJobRecord(draining.jobId);
    if (record && record.status === 'running') deriveSwitchStatus(record, ops);
  }
  return { pending, draining, recent };
}

function withQueueMutationLock<T>(ops: SwitchQueueOps, fn: () => T): T {
  ensureQueueDirs();
  const lockPath = enqueueLockPath();
  acquireExclusiveLock(lockPath, { pid: process.pid, startedAtMs: ops.now() }, ops);
  try {
    return fn();
  } finally {
    fs.rmSync(lockPath, { force: true });
  }
}

function acquireQueueWorkerLock(ops: SwitchQueueOps): void {
  ensureQueueDirs();
  acquireExclusiveLock(queueWorkerLockPath(), { workerPid: process.pid, pid: process.pid, startedAtMs: ops.now() }, ops);
}

function releaseQueueWorkerLock(): void {
  fs.rmSync(queueWorkerLockPath(), { force: true });
}

function ensureDrainWorker(ops: SwitchQueueOps): void {
  if (queueWorkerLive(ops)) return;
  try {
    ops.spawnQueueWorker();
  } catch {
    // Queue status remains visible; a later reconcile can spawn the worker.
  }
}

function queueWorkerLive(ops: SwitchQueueOps): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(queueWorkerLockPath(), 'utf-8')) as { workerPid?: number; pid?: number; startedAtMs?: number };
    const pid = raw.workerPid ?? raw.pid;
    return typeof pid === 'number' &&
      ops.isPidAlive(pid) &&
      typeof raw.startedAtMs === 'number' &&
      ops.now() - raw.startedAtMs <= SWITCH_JOB_MAX_MS;
  } catch {
    return false;
  }
}

function sweepStaleLock(lockPath: string, ops: SwitchQueueOps): void {
  if (!fs.existsSync(lockPath)) return;
  if (lockStillLive(lockPath, ops)) return;
  // Re-read immediately before rmSync; wx-create remains the atomic backstop.
  if (!lockStillLive(lockPath, ops)) fs.rmSync(lockPath, { force: true });
}

function lockStillLive(lockPath: string, ops: SwitchQueueOps): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { jobId?: string; pid?: number; workerPid?: number; startedAtMs?: number };
    if (typeof raw.jobId === 'string') {
      const record = readJobRecord(raw.jobId);
      if (record && deriveSwitchStatus(record, ops).status === 'running') return true;
    }
    const pid = raw.workerPid ?? raw.pid;
    return typeof pid === 'number' &&
      ops.isPidAlive(pid) &&
      typeof raw.startedAtMs === 'number' &&
      ops.now() - raw.startedAtMs <= SWITCH_JOB_MAX_MS;
  } catch {
    return false;
  }
}

function readQueueEntries(): QueueEntryRecord[] {
  ensureQueueDirs();
  return fs.readdirSync(queueDir())
    .filter((name) => /^\d+-[A-Za-z0-9_-]+\.json$/.test(name))
    .flatMap((name): QueueEntryRecord[] => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(queueDir(), name), 'utf-8')) as QueueEntryRecord];
      } catch {
        return [];
      }
    });
}

function findEntryByQueueId(queueId: string): { entry: QueueEntryRecord; filePath: string } | null {
  ensureQueueDirs();
  for (const name of fs.readdirSync(queueDir())) {
    if (!/^\d+-[A-Za-z0-9_-]+\.json$/.test(name)) continue;
    const filePath = path.join(queueDir(), name);
    try {
      const entry = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as QueueEntryRecord;
      if (entry.queueId === queueId) return { entry, filePath };
    } catch {
      // Ignore malformed queue files.
    }
  }
  return null;
}

function writeQueueEntry(entry: QueueEntryRecord): void {
  if (!Number.isInteger(entry.seq) || !isValidName(entry.agent)) {
    throw new AccountSwitchHttpError(400, 'Invalid queue entry path fields', 'INVALID_QUEUE_ENTRY');
  }
  writeJson0600(queueEntryPath(entry), entry);
}

function queueEntryPath(entry: Pick<QueueEntryRecord, 'seq' | 'agent'>): string {
  return path.join(queueDir(), `${entry.seq}-${entry.agent}.json`);
}

function nextSeq(): number {
  ensureQueueDirs();
  let next = 0;
  try {
    const raw = JSON.parse(fs.readFileSync(seqPath(), 'utf-8')) as { next?: number };
    if (Number.isInteger(raw.next) && typeof raw.next === 'number' && raw.next >= 0) next = raw.next;
  } catch {
    next = 0;
  }
  writeJson0600(seqPath(), { next: next + 1 });
  return next;
}

function queuePosition(seq: number): number {
  return readQueueEntries().filter((entry) => entry.status === 'pending' && entry.seq <= seq).length;
}

function copyFlipTerminalToQueue(entry: QueueEntryRecord, record: SwitchJobRecord, ops: SwitchQueueOps): QueueEntryRecord {
  if (record.status === 'running') return entry;
  const updated: QueueEntryRecord = {
    ...entry,
    status: record.status,
    jobId: record.jobId,
    endedAt: record.endedAt ?? new Date(ops.now()).toISOString(),
    ...(record.resultSummary ? { resultSummary: record.resultSummary } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
  writeQueueEntry(updated);
  return updated;
}

function markQueueTerminal(
  entry: QueueEntryRecord,
  status: QueueEntryStatus,
  summary: string,
  ops: SwitchQueueOps,
  error?: string,
): QueueEntryRecord {
  const updated: QueueEntryRecord = {
    ...entry,
    status,
    endedAt: new Date(ops.now()).toISOString(),
    resultSummary: summary,
    ...(error ? { error } : {}),
  };
  writeQueueEntry(updated);
  return updated;
}

function drainTerminalForValidation(code: string): QueueEntryStatus {
  if (code === 'UNKNOWN_AGENT') return 'agent-gone';
  if (code === 'UNKNOWN_TARGET') return 'target-gone';
  if (code === 'ALREADY_AT_TARGET') return 'already-at-target';
  return 'failed';
}

function unavailableSummary(code: string, entry: QueueEntryRecord): string {
  if (code === 'AGENT_RESOLVER_UNAVAILABLE') {
    return `Live account resolver unavailable; ${entry.agent} remains queued.`;
  }
  return `Setup-token vault unavailable; ${entry.agent} remains queued for ${entry.targetAccount}.`;
}

function summaryForValidation(status: QueueEntryStatus, entry: QueueEntryRecord): string {
  if (status === 'agent-gone') return `${entry.agent} is no longer in the live account resolver.`;
  if (status === 'target-gone') return `${entry.targetAccount} is no longer available in the setup-token vault.`;
  if (status === 'already-at-target') return `${entry.agent} is already at ${entry.targetAccount}.`;
  return `Switch could not run for ${entry.agent}.`;
}

function isTerminal(status: QueueEntryStatus): boolean {
  return status !== 'pending' && status !== 'draining';
}

function toHttpError(err: unknown): AccountSwitchHttpError {
  if (err instanceof AccountSwitchHttpError) return err;
  return new AccountSwitchHttpError(500, 'Switch queue request failed', 'SWITCH_QUEUE_REQUEST_FAILED');
}

function readJsonBody(request: AccountSwitchRequestLike): Promise<Record<string, unknown>> {
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
