import { existsSync, readFileSync, chmodSync, statSync, unlinkSync, readdirSync, writeFileSync, rmSync } from 'fs';
import { dirname, join, resolve as pathResolve } from 'path';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import type { AgentStatus, BusPaths, IPCResponse } from '../types/index.js';
import { atomicWriteSync, ensureDir } from '../utils/atomic.js';
import { parseEnvFile } from '../utils/env.js';
import { validateAgentName } from '../utils/validate.js';
import { shortTokenHash, hashLiveProcessToken, hasProcessEnvVar } from '../utils/live-token-hash.js';
import { resolveAgentAccount } from '../daemon/cron-capacity-gate.js';
import { hasRecentAuthWobble } from '../daemon/rtk-continue-decay-autoheal.js';
import { writeTokenToAgents } from './oauth.js';
import { createTask } from './task.js';
import { sendMessage, checkInbox, ackInbox } from './message.js';

// Coupled with scripts/deploy-agent-token.sh when present; update both if oat01 setup-token length changes.
const SETUP_TOKEN_RE = /^sk-ant-oat01-[A-Za-z0-9_-]{95}$/;
const DEFAULT_STOP_WAIT_MS = 60_000;
const DEFAULT_BOOT_VERIFY_WAIT_MS = 40_000;
// Heavy-boot agents with long session-start checklists can miss 120s by seconds.
// hbTime >= restartAtMs below still requires a fresh post-restart heartbeat.
const DEFAULT_HEARTBEAT_WINDOW_MS = 4 * 60_000;
// Liveness corroborator (warning-only): bounded poll for a fresh post-restart
// heartbeat before proceeding. This NEVER fails the switch - a heavy-boot agent
// not yet fresh within this window gets a warning, never a revert. It replaced
// the old bus round-trip probe, which sent from a session-less (unroutable)
// operator and so frequently never confirmed a HEALTHY just-restarted agent,
// false-failing verify and auto-reverting a good switch (the kill-trap class).
const DEFAULT_HEARTBEAT_CORROBORATE_MS = 90_000;
const DEFAULT_HEARTBEAT_POLL_MS = 5_000;
const STATUS_IPC_MAX_TRIES = 4;
const STATUS_IPC_RETRY_GAP_MS = 1_000;

export interface SwitchAgentAccountOptions {
  ctxRoot: string;
  frameworkRoot: string;
  org: string;
  instanceId: string;
  operatorAgent: string;
  agent: string;
  targetAccount: string;
  tokenFile?: string;
  dryRun?: boolean;
  nowMs?: () => number;
  sleepMs?: (ms: number) => Promise<void>;
  ops: SwitchAgentAccountOps;
  paths?: BusPaths;
}

export interface SwitchAllFromOptions extends Omit<SwitchAgentAccountOptions, 'agent' | 'targetAccount'> {
  sourceAccount: string;
  targetAccount: string;
}

interface Snapshot {
  envContent: string;
  envToken: string;
  envMode: number;
  configContent: string;
  usageAccount?: string;
  pid?: number;
  accountLabel: string | null;
}

interface VaultToken {
  token: string;
  path: string;
  fingerprint: string;
}

interface VerifyInput {
  agent: string;
  targetAccount: string;
  tokenFingerprint: string;
  restartAtMs: number;
  envFlipMtimeMs: number;
  envPath: string;
}

interface VerifyResult {
  ok: boolean;
  gate?: string;
  reason?: string;
  pid?: number;
  primary?: 'matched' | 'indeterminate';
  warnings?: string[];
  heartbeat?: 'fresh' | 'stale';
  statusIpcTimedOut?: boolean;
}

export interface SwitchAgentAccountResult {
  agent: string;
  targetAccount: string;
  fingerprint: string;
  status: 'success' | 'dry-run';
  warnings: string[];
  runtimeProof?: 'matched' | 'indeterminate';
  functionalSweepTaskId?: string;
  message: string;
}

export interface SwitchBatchResult {
  sourceAccount: string;
  targetAccount: string;
  results: Array<{
    agent: string;
    status: 'success' | 'failed';
    endState: 'verified-on-target' | 'rolled-back-verified' | 'INDETERMINATE-needs-attention';
    error?: string;
    taskId?: string;
  }>;
  warnings: string[];
}

export type SwitchAgentAccountFailureClass = 'agent' | 'daemon';

export interface SwitchAgentAccountOps {
  getStatuses(): Promise<AgentStatus[]>;
  stopAgent(agent: string): Promise<IPCResponse>;
  startAgent(agent: string): Promise<IPCResponse>;
  hashLiveProcessToken(pid: number): string | null;
  hasProcessEnvVar(pid: number, name: string): boolean;
  processStartTimeMs(pid: number): number | null;
  resolveAgentAccount(agentDir: string, ctxRoot: string): { label: string | null };
  hasAuthWobble(ctxRoot: string, nowMs: number): boolean;
  probeAgent(agent: string, operatorAgent: string, timeoutMs: number): Promise<boolean>;
  createFunctionalSweepTask(agent: string, targetAccount: string): string | undefined;
  writeToken(frameworkRoot: string, org: string, token: string, agent: string): void;
}

export class SwitchAgentAccountError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly rolledBack = false,
    public readonly failureClass: SwitchAgentAccountFailureClass = classifySwitchFailureCode(code),
  ) {
    super(message);
  }
}

export function setupTokenVaultDir(ctxRoot: string): string {
  return join(ctxRoot, 'state', 'oauth', 'setup-tokens');
}

export function setupTokenVaultPath(ctxRoot: string, account: string): string {
  return join(setupTokenVaultDir(ctxRoot), `${account}.token`);
}

export function processStartTimeMs(pid: number): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const raw = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024,
    }).trim();
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  } catch {
    return null;
  }
}

export function makeSwitchProbeNonce(agent: string, nowMs: number): string {
  return `SWITCH_AGENT_ACCOUNT_PROBE_${agent}_${nowMs}_${randomBytes(8).toString('hex')}`;
}

export function makeSwitchProbeOperatorAgent(): string {
  return `switch-probe-${randomBytes(8).toString('hex')}`;
}

export function makeSwitchProbeBusPaths(basePaths: BusPaths, probeOperatorAgent: string): BusPaths {
  const probeRoot = join(basePaths.ctxRoot, 'inbox', probeOperatorAgent);
  return {
    ctxRoot: basePaths.ctxRoot,
    inbox: probeRoot,
    inflight: join(probeRoot, '.inflight'),
    processed: join(probeRoot, '.processed'),
    logDir: join(probeRoot, '.logs'),
    stateDir: join(probeRoot, '.state'),
    taskDir: join(probeRoot, '.unused', 'tasks'),
    approvalDir: join(probeRoot, '.unused', 'approvals'),
    analyticsDir: join(probeRoot, '.unused', 'analytics'),
    deliverablesDir: join(probeRoot, '.unused', 'deliverables'),
  };
}

export function cleanupSwitchProbeInbox(basePaths: BusPaths, probeOperatorAgent: string): void {
  try {
    rmSync(join(basePaths.ctxRoot, 'inbox', probeOperatorAgent), { recursive: true, force: true });
  } catch { /* session-less probe inbox cleanup is best-effort */ }
}

export function isAcceptedProbeReply(
  msg: { from: string; reply_to?: string | null; text: string },
  agent: string,
  msgId: string,
  nonce: string,
): boolean {
  if (msg.from !== agent) return false;
  if (msg.reply_to === msgId) return true;
  return msg.text.includes(nonce);
}

export function isExactProbeReply(
  msg: { from: string; reply_to?: string | null },
  agent: string,
  msgId: string,
): boolean {
  return msg.from === agent && msg.reply_to === msgId;
}

export function defaultSwitchAgentAccountOps(
  ipc: { send(request: { type: string; agent?: string; source?: string }): Promise<IPCResponse> },
  org: string,
  paths: BusPaths | undefined,
  nowMs: () => number,
  sleepMs: (ms: number) => Promise<void> = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
): SwitchAgentAccountOps {
  return {
    async getStatuses() {
      for (let attempt = 1; attempt <= STATUS_IPC_MAX_TRIES; attempt += 1) {
        try {
          const response = await ipc.send({ type: 'status', source: 'cortextos switch-agent-account' });
          if (!response.success) throw new Error(response.error ?? 'status IPC failed');
          return response.data as AgentStatus[];
        } catch (err) {
          if (!isIpcTimeoutError(err) || attempt === STATUS_IPC_MAX_TRIES) throw err;
          await sleepMs(STATUS_IPC_RETRY_GAP_MS);
        }
      }
      throw new Error('status IPC retry loop exhausted');
    },
    stopAgent(agent) {
      return ipc.send({ type: 'stop-agent', agent, source: 'cortextos switch-agent-account' });
    },
    startAgent(agent) {
      return ipc.send({ type: 'start-agent', agent, source: 'cortextos switch-agent-account' });
    },
    hashLiveProcessToken,
    hasProcessEnvVar,
    processStartTimeMs,
    resolveAgentAccount,
    hasAuthWobble: (root, now) => hasRecentAuthWobble(root, now),
    probeAgent: paths
      ? (agent, operatorAgent, timeoutMs) => busRoundTripProbe(paths, agent, operatorAgent, timeoutMs, nowMs)
      : async () => false,
    createFunctionalSweepTask: paths
      ? (agent, targetAccount) => createFunctionalSweepTask(paths, org, agent, targetAccount)
      : () => undefined,
    writeToken: writeTokenToAgents,
  };
}

export async function switchAgentAccount(options: SwitchAgentAccountOptions): Promise<SwitchAgentAccountResult> {
  validateAgentName(options.agent);
  validateAgentName(options.operatorAgent);
  assertNotSelfSwitch(options.operatorAgent, options.agent);
  if (!options.frameworkRoot) throw new SwitchAgentAccountError('CTX_FRAMEWORK_ROOT is required', 'NO_FRAMEWORK_ROOT');
  if (!options.org) throw new SwitchAgentAccountError('CTX_ORG is required', 'NO_ORG');

  const nowMs = options.nowMs ?? (() => Date.now());
  const sleepMs = options.sleepMs ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const ops = options.ops;
  const warnings: string[] = [];
  const agentDir = join(options.frameworkRoot, 'orgs', options.org, 'agents', options.agent);
  const envPath = join(agentDir, '.env');
  const configPath = join(agentDir, 'config.json');
  const target = readTargetToken(options);

  try {
    const snapshot = await preflight({
      options,
      agentDir,
      envPath,
      configPath,
      target,
      ops,
      nowMs,
      warnings,
    });

    if (options.dryRun) {
      return {
        agent: options.agent,
        targetAccount: options.targetAccount,
        fingerprint: target.fingerprint,
        status: 'dry-run',
        warnings,
        message: `DRY RUN OK: ${options.agent} can switch to ${options.targetAccount} (${target.fingerprint}, bare sha256/12).`,
      };
    }

    let flipped = false;
    try {
      if (options.tokenFile) persistDeliveredToken(options, target.token);
      applyBothHalves(options, ops, envPath, configPath, target.token);
      const envFlipMtimeMs = statSync(envPath).mtimeMs;
      flipped = true;
      let restartAtMs = nowMs();
      try {
        await restartAgent(options.agent, options.ctxRoot, ops, sleepMs, DEFAULT_STOP_WAIT_MS, snapshot.pid);
        restartAtMs = nowMs();
      } catch (restartErr) {
        if (!isDaemonFailure(restartErr)) throw restartErr;
        restartAtMs = nowMs();
        await sleepMs(DEFAULT_BOOT_VERIFY_WAIT_MS);
        const postTimeoutVerify = await verifySwitched({
          agent: options.agent,
          targetAccount: options.targetAccount,
          tokenFingerprint: target.fingerprint,
          restartAtMs,
          envFlipMtimeMs,
          envPath,
        }, agentDir, options.ctxRoot, ops, nowMs, sleepMs).catch(() => null);
        if (postTimeoutVerify?.ok) {
          warnings.push('WARN: restart IPC timed out or was unreachable, but post-timeout state verified the target account; treating switch as success and skipping rollback.');
          warnings.push(...(postTimeoutVerify.warnings ?? []));
          const taskId = ops.createFunctionalSweepTask(options.agent, options.targetAccount);
          return {
            agent: options.agent,
            targetAccount: options.targetAccount,
            fingerprint: target.fingerprint,
            status: 'success',
            warnings,
            runtimeProof: postTimeoutVerify.primary,
            functionalSweepTaskId: taskId,
            message: successMessage(options.agent, options.targetAccount, target.fingerprint, taskId),
          };
        }
        throw restartErr;
      }
      await sleepMs(DEFAULT_BOOT_VERIFY_WAIT_MS);
      const verify = await verifySwitched({
        agent: options.agent,
        targetAccount: options.targetAccount,
        tokenFingerprint: target.fingerprint,
        restartAtMs,
        envFlipMtimeMs,
        envPath,
      }, agentDir, options.ctxRoot, ops, nowMs, sleepMs);
      if (!verify.ok) {
        throw new SwitchAgentAccountError(`verify failed at ${verify.gate}: ${verify.reason}`, verify.gate ?? 'VERIFY_FAILED');
      }
      warnings.push(...(verify.warnings ?? []));
      const taskId = ops.createFunctionalSweepTask(options.agent, options.targetAccount);
      return {
        agent: options.agent,
        targetAccount: options.targetAccount,
        fingerprint: target.fingerprint,
        status: 'success',
        warnings,
        runtimeProof: verify.primary,
        functionalSweepTaskId: taskId,
        message: successMessage(options.agent, options.targetAccount, target.fingerprint, taskId),
      };
    } catch (err) {
      if (flipped) {
        const priorAccount = snapshot.accountLabel ?? snapshot.usageAccount ?? 'prior-account';
        let rollbackStatusIpcTimedOut = false;
        try {
          restoreSnapshot(envPath, configPath, snapshot);
          await restartAgent(options.agent, options.ctxRoot, ops, sleepMs, DEFAULT_STOP_WAIT_MS);
        } catch (rollbackErr) {
          throw new SwitchAgentAccountError(
            `switch failed and rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`,
            'ROLLBACK_FAILED',
            true,
            rollbackErr instanceof SwitchAgentAccountError ? rollbackErr.failureClass : 'agent',
          );
        }
        try {
          const rollbackEnvMtimeMs = statSync(envPath).mtimeMs;
          const rollbackAtMs = nowMs();
          await sleepMs(DEFAULT_BOOT_VERIFY_WAIT_MS);
          const priorFingerprint = shortTokenHash(snapshot.envToken);
          const rollbackVerify = await verifySwitched({
            agent: options.agent,
            targetAccount: priorAccount,
            tokenFingerprint: priorFingerprint,
            restartAtMs: rollbackAtMs,
            envFlipMtimeMs: rollbackEnvMtimeMs,
            envPath,
          }, agentDir, options.ctxRoot, ops, nowMs, sleepMs);
          if (!rollbackVerify.ok) {
            throw new SwitchAgentAccountError(
              `switch failed and rollback verification failed at ${rollbackVerify.gate}: ${rollbackVerify.reason}`,
              'ROLLBACK_VERIFY_FAILED',
              true,
            );
          }
          rollbackStatusIpcTimedOut = rollbackVerify.statusIpcTimedOut === true;
        } catch (rollbackVerifyErr) {
          if (rollbackVerifyErr instanceof SwitchAgentAccountError && rollbackVerifyErr.code === 'ROLLBACK_VERIFY_FAILED') {
            throw rollbackVerifyErr;
          }
          throw new SwitchAgentAccountError(
            `switch failed and rollback verification failed: ${rollbackVerifyErr instanceof Error ? rollbackVerifyErr.message : String(rollbackVerifyErr)}`,
            'ROLLBACK_VERIFY_FAILED',
            true,
            rollbackVerifyErr instanceof SwitchAgentAccountError ? rollbackVerifyErr.failureClass : 'agent',
          );
        }
        if (rollbackStatusIpcTimedOut) {
          const reason = err instanceof Error ? err.message : String(err);
          throw new SwitchAgentAccountError(
            `${reason}; rolled back; rollback restored prior account (${priorAccount}), liveness unconfirmed because status IPC timed out.`,
            err instanceof SwitchAgentAccountError ? err.code : 'SWITCH_FAILED',
            true,
            err instanceof SwitchAgentAccountError ? err.failureClass : 'agent',
          );
        }
      }
      if (err instanceof SwitchAgentAccountError) {
        throw new SwitchAgentAccountError(err.message, err.code, flipped, err.failureClass);
      }
      throw new SwitchAgentAccountError(err instanceof Error ? err.message : String(err), 'SWITCH_FAILED', flipped);
    }
  } finally {
    if (options.tokenFile && !options.dryRun) shredFile(options.tokenFile);
  }
}

export async function switchAllFrom(options: SwitchAllFromOptions): Promise<SwitchBatchResult> {
  validateAgentName(options.operatorAgent);
  const ops = options.ops;
  const agentsDir = join(options.frameworkRoot, 'orgs', options.org, 'agents');
  const agents: string[] = [];
  const warnings: string[] = [];
  let skippedSelf = false;
  const operatorAgent = normalizeAgentName(options.operatorAgent);
  for (const entry of safeReaddir(agentsDir)) {
    const agentDir = join(agentsDir, entry);
    if (!safeIsDir(agentDir)) continue;
    const r = ops.resolveAgentAccount(agentDir, options.ctxRoot);
    if (r.label !== options.sourceAccount) continue;
    if (normalizeAgentName(entry) === operatorAgent) {
      skippedSelf = true;
      warnings.push(`WARN: skipping self: ${options.operatorAgent} cannot switch its own account in a batch.`);
      continue;
    }
    agents.push(entry);
  }
  if (skippedSelf && agents.length === 0) {
    throw selfSwitchError(options.operatorAgent);
  }
  const results: SwitchBatchResult['results'] = [];
  let tokenFile = options.tokenFile;
  for (const agent of agents) {
    try {
      const result = await switchAgentAccount({ ...options, tokenFile, agent, targetAccount: options.targetAccount });
      tokenFile = undefined;
      results.push({ agent, status: 'success', endState: 'verified-on-target', taskId: result.functionalSweepTaskId });
    } catch (err) {
      const endState = batchFailureEndState(err);
      const error = err instanceof Error ? err.message : String(err);
      results.push({ agent, status: 'failed', endState, error });
      if (endState === 'INDETERMINATE-needs-attention') {
        warnings.push(`ATTENTION: ${agent} ended INDETERMINATE-needs-attention after failure: ${error}`);
      }
      if (shouldAbortBatch(err)) {
        warnings.push(`ABORT: daemon/IPC failure while switching ${agent}; ${agents.length - results.length} remaining agent(s) deferred.`);
        break;
      }
    }
  }
  return { sourceAccount: options.sourceAccount, targetAccount: options.targetAccount, results, warnings };
}

function normalizeAgentName(agent: string): string {
  return agent.trim().toLowerCase();
}

function assertNotSelfSwitch(operatorAgent: string, agent: string): void {
  if (normalizeAgentName(operatorAgent) === normalizeAgentName(agent)) {
    throw selfSwitchError(operatorAgent);
  }
}

function selfSwitchError(operatorAgent: string): SwitchAgentAccountError {
  return new SwitchAgentAccountError(
    `refusing self-switch: the executing agent ${operatorAgent} cannot switch its own account - the restart step kills this process mid-sequence and bricks it with no auto-recovery; run from another agent or externally`,
    'SELF_SWITCH',
  );
}

async function preflight(input: {
  options: SwitchAgentAccountOptions;
  agentDir: string;
  envPath: string;
  configPath: string;
  target: VaultToken;
  ops: SwitchAgentAccountOps;
  nowMs: () => number;
  warnings: string[];
}): Promise<Snapshot> {
  const { options, agentDir, envPath, configPath, target, ops, nowMs, warnings } = input;
  if (!existsSync(agentDir)) {
    throw new SwitchAgentAccountError(
      `agent '${options.agent}' not found in org '${options.org}'. For a cross-org target, set CTX_ORG=<its-org> (org-qualified names are not accepted here).`,
      'MISSING_AGENT',
    );
  }
  if (!existsSync(configPath)) throw new SwitchAgentAccountError(`config.json missing for ${options.agent}`, 'MISSING_CONFIG');
  if (!existsSync(envPath)) throw new SwitchAgentAccountError(`.env missing for ${options.agent}`, 'MISSING_ENV');
  if (ops.hasAuthWobble(options.ctxRoot, nowMs())) {
    throw new SwitchAgentAccountError('auth wobble active; refusing account switch', 'AUTH_WOBBLE');
  }
  assertSetupToken(target.token);
  const envContent = readFileSync(envPath, 'utf-8');
  const configContent = readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configContent) as { usage_account?: string; connectors?: unknown };
  const envToken = parseEnvFile(envPath).CLAUDE_CODE_OAUTH_TOKEN;
  if (!envToken) throw new SwitchAgentAccountError('current .env lacks CLAUDE_CODE_OAUTH_TOKEN', 'MISSING_CURRENT_TOKEN');
  const envMode = statSync(envPath).mode & 0o777;
  if (config.connectors !== undefined) {
    warnings.push('WARN: connector dependency check is warn-only; bearer mode assumes connector lanes are already migrated.');
  }
  const statuses = await ops.getStatuses();
  const status = statuses.find((s) => s.name === options.agent);
  return {
    envContent,
    envToken,
    envMode,
    configContent,
    usageAccount: config.usage_account,
    pid: status?.pid,
    accountLabel: ops.resolveAgentAccount(agentDir, options.ctxRoot).label,
  };
}

function readTargetToken(options: SwitchAgentAccountOptions): VaultToken {
  if (options.tokenFile) {
    const deliveryPath = pathResolve(options.tokenFile);
    const delivered = readFileSync(deliveryPath, 'utf-8').trim();
    assertSetupToken(delivered);
    return { token: delivered, path: deliveryPath, fingerprint: shortTokenHash(delivered) };
  }
  const path = setupTokenVaultPath(options.ctxRoot, options.targetAccount);
  assertVaultPerms(path);
  const token = readFileSync(path, 'utf-8').trim();
  assertSetupToken(token);
  return { token, path, fingerprint: shortTokenHash(token) };
}

function persistDeliveredToken(options: SwitchAgentAccountOptions, token: string): void {
  const vaultDir = setupTokenVaultDir(options.ctxRoot);
  ensureDir(vaultDir);
  chmodSync(vaultDir, 0o700);
  const vaultPath = setupTokenVaultPath(options.ctxRoot, options.targetAccount);
  atomicWriteSync(vaultPath, `${token}\n`);
  chmodSync(vaultPath, 0o600);
}

function assertSetupToken(token: string): void {
  if (!SETUP_TOKEN_RE.test(token)) {
    throw new SwitchAgentAccountError('target token is not a runtime setup-token (expected sk-ant-oat01)', 'NOT_SETUP_TOKEN');
  }
}

function assertVaultPerms(path: string): void {
  if (!existsSync(path)) throw new SwitchAgentAccountError(`target token not found in vault: ${path}`, 'MISSING_TARGET_TOKEN');
  const dirMode = statSync(dirname(path)).mode & 0o777;
  const fileMode = statSync(path).mode & 0o777;
  if (dirMode !== 0o700) throw new SwitchAgentAccountError('setup-token vault dir must be 0700', 'BAD_VAULT_PERMS');
  if (fileMode !== 0o600) throw new SwitchAgentAccountError('setup-token file must be 0600', 'BAD_TOKEN_PERMS');
}

function applyBothHalves(
  options: SwitchAgentAccountOptions,
  ops: SwitchAgentAccountOps,
  envPath: string,
  configPath: string,
  token: string,
): void {
  const snapshot = {
    env: readFileSync(envPath, 'utf-8'),
    config: readFileSync(configPath, 'utf-8'),
  };
  try {
    ops.writeToken(options.frameworkRoot, options.org, token, options.agent);
    const afterEnv = parseEnvFile(envPath).CLAUDE_CODE_OAUTH_TOKEN ?? '';
    if (shortTokenHash(afterEnv) !== shortTokenHash(token)) throw new Error('.env token write verification failed');
    chmodSync(envPath, 0o600);

    const config = JSON.parse(snapshot.config) as Record<string, unknown>;
    config.usage_account = options.targetAccount;
    atomicWriteSync(configPath, JSON.stringify(config, null, 2) + '\n');
  } catch (err) {
    atomicWriteSync(envPath, snapshot.env);
    atomicWriteSync(configPath, snapshot.config);
    chmodSync(envPath, 0o600);
    throw err;
  }
}

function restoreSnapshot(envPath: string, configPath: string, snapshot: Snapshot): void {
  atomicWriteSync(envPath, snapshot.envContent);
  chmodSync(envPath, snapshot.envMode || 0o600);
  atomicWriteSync(configPath, snapshot.configContent);
}

async function restartAgent(
  agent: string,
  ctxRoot: string,
  ops: SwitchAgentAccountOps,
  sleepMs: (ms: number) => Promise<void>,
  stopWaitMs: number,
  oldPid?: number,
): Promise<void> {
  writeRestartPlannedMarker(ctxRoot, agent);
  const stop = await callRestartIpc(() => ops.stopAgent(agent), 'stop');
  if (!stop.success && isDaemonNotRunning(stop)) {
    throw new SwitchAgentAccountError('stop failed: daemon is not running', 'DAEMON_UNREACHABLE', false, 'daemon');
  }
  if (!stop.success && stop.code !== 'NOT_RUNNING') {
    throw new SwitchAgentAccountError(`stop failed: ${stop.error ?? stop.code ?? 'unknown'}`, 'STOP_FAILED');
  }
  await sleepMs(stopWaitMs);
  if (oldPid) {
    const statuses = await ops.getStatuses();
    const status = statuses.find((s) => s.name === agent);
    if (status?.status === 'running' && status.pid === oldPid) {
      throw new SwitchAgentAccountError('old process still running after stop wait', 'STOP_WAIT_FAILED');
    }
  }
  const start = await callRestartIpc(() => ops.startAgent(agent), 'start');
  if (!start.success && isDaemonNotRunning(start)) {
    throw new SwitchAgentAccountError('start failed: daemon is not running', 'DAEMON_UNREACHABLE', false, 'daemon');
  }
  const startCode = String(start.code ?? '');
  if (!start.success && startCode !== 'DEDUPED' && startCode !== 'QUEUED_BEHIND_STOP') {
    throw new SwitchAgentAccountError(`start failed: ${start.error ?? startCode ?? 'unknown'}`, 'START_FAILED');
  }
}

async function callRestartIpc(call: () => Promise<IPCResponse>, phase: 'stop' | 'start'): Promise<IPCResponse> {
  try {
    return await call();
  } catch (err) {
    if (isIpcTimeoutError(err)) {
      throw new SwitchAgentAccountError(`${phase} IPC timed out: ${err instanceof Error ? err.message : String(err)}`, 'DAEMON_UNRESPONSIVE', false, 'daemon');
    }
    throw new SwitchAgentAccountError(`${phase} IPC failed: ${err instanceof Error ? err.message : String(err)}`, 'DAEMON_IPC_FAILED', false, 'daemon');
  }
}

function isIpcTimeoutError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'IPC_TIMEOUT';
}

function isDaemonNotRunning(response: IPCResponse): boolean {
  return !response.success && response.code === 'DAEMON_DOWN';
}

function isDaemonFailure(err: unknown): boolean {
  return err instanceof SwitchAgentAccountError && err.failureClass === 'daemon';
}

function shouldAbortBatch(err: unknown): boolean {
  return err instanceof SwitchAgentAccountError && err.failureClass === 'daemon';
}

function batchFailureEndState(err: unknown): SwitchBatchResult['results'][number]['endState'] {
  if (err instanceof SwitchAgentAccountError) {
    if (err.rolledBack && err.code !== 'ROLLBACK_VERIFY_FAILED' && err.code !== 'ROLLBACK_FAILED') {
      return 'rolled-back-verified';
    }
  }
  return 'INDETERMINATE-needs-attention';
}

function classifySwitchFailureCode(code: string): SwitchAgentAccountFailureClass {
  return code === 'DAEMON_UNRESPONSIVE' || code === 'DAEMON_UNREACHABLE' || code === 'DAEMON_IPC_FAILED'
    ? 'daemon'
    : 'agent';
}

function writeRestartPlannedMarker(ctxRoot: string, agent: string): void {
  const stateDir = join(ctxRoot, 'state', agent);
  ensureDir(stateDir);
  writeFileSync(join(stateDir, '.restart-planned'), 'account switch\n', 'utf-8');
}

async function verifySwitched(
  input: VerifyInput,
  agentDir: string,
  ctxRoot: string,
  ops: SwitchAgentAccountOps,
  nowMs: () => number,
  sleepMs: (ms: number) => Promise<void>,
): Promise<VerifyResult> {
  try {
    return await verifySwitchedWithStatus(input, agentDir, ctxRoot, ops, nowMs, sleepMs);
  } catch (err) {
    if (!isIpcTimeoutError(err)) throw err;
    return verifySwitchedAfterStatusTimeout(input, agentDir, ctxRoot, ops);
  }
}

async function verifySwitchedWithStatus(
  input: VerifyInput,
  agentDir: string,
  ctxRoot: string,
  ops: SwitchAgentAccountOps,
  nowMs: () => number,
  sleepMs: (ms: number) => Promise<void>,
): Promise<VerifyResult> {
  const statuses = await ops.getStatuses();
  const status = statuses.find((s) => s.name === input.agent);
  if (!status || status.status !== 'running' || !status.pid) {
    return { ok: false, gate: 'status', reason: 'agent not running' };
  }

  const fileToken = parseEnvFile(input.envPath).CLAUDE_CODE_OAUTH_TOKEN ?? '';
  if (shortTokenHash(fileToken) !== input.tokenFingerprint) {
    return { ok: false, gate: 'env-file', reason: '.env token fingerprint mismatch', pid: status.pid };
  }

  const processStartedAtMs = ops.processStartTimeMs(status.pid);
  if (processStartedAtMs === null || processStartedAtMs <= input.envFlipMtimeMs) {
    return {
      ok: false,
      gate: 'process-start',
      reason: 'process start time does not postdate the .env flip',
      pid: status.pid,
    };
  }

  let primary: VerifyResult['primary'] = 'indeterminate';
  const warnings: string[] = [];
  if (ops.hasProcessEnvVar(status.pid, 'CTX_AGENT_NAME')) {
    const liveHash = ops.hashLiveProcessToken(status.pid);
    if (liveHash === input.tokenFingerprint) primary = 'matched';
    else if (liveHash && liveHash !== shortTokenHash('')) {
      return { ok: false, gate: 'runtime-token', reason: 'live process token fingerprint mismatch', pid: status.pid };
    }
  }
  if (primary === 'indeterminate') {
    warnings.push('WARN: runtime-token unreadable; attribution via env-file + process-start-postdates-flip + account attribution, no direct live-token read.');
  }

  const attribution = ops.resolveAgentAccount(agentDir, ctxRoot);
  if (attribution.label !== input.targetAccount) {
    return { ok: false, gate: 'attribution', reason: `expected ${input.targetAccount}, got ${attribution.label ?? 'unresolved'}`, pid: status.pid, primary };
  }

  // Switch CORRECTNESS is fully proven by the authoritative gates above (status
  // running + .env fingerprint==target + process-start postdates the .env flip +
  // attribution==target + live-token==target when readable) - each still
  // hard-fails -> rollback on a genuinely bad switch. Liveness is a corroborator
  // ONLY: bounded-poll for a fresh post-restart heartbeat (routable) and WARN,
  // never fail, if it is not fresh in the window. The old bus round-trip probe
  // was dropped - it sent from a session-less (unroutable) operator, so a HEALTHY
  // just-restarted agent frequently never confirmed within the cap, which
  // false-failed verify and auto-reverted a good switch (the kill-trap class).
  const heartbeatFresh = await awaitFreshHeartbeat(input.agent, input.restartAtMs, status.lastHeartbeat, ops, nowMs, sleepMs);
  if (!heartbeatFresh) {
    warnings.push('WARN: auth flip verified by env-file + process-start-postdates-flip + attribution' +
      (primary === 'matched' ? ' + live-token' : '') +
      '; post-restart heartbeat not fresh within the corroborator window (heavy-boot agent) - liveness corroborator pending, not a failure.');
  }

  return {
    ok: true,
    pid: status.pid,
    primary,
    warnings,
    heartbeat: heartbeatFresh ? 'fresh' : 'stale',
  };
}

function verifySwitchedAfterStatusTimeout(
  input: VerifyInput,
  agentDir: string,
  ctxRoot: string,
  ops: SwitchAgentAccountOps,
): VerifyResult {
  const fileToken = parseEnvFile(input.envPath).CLAUDE_CODE_OAUTH_TOKEN ?? '';
  if (shortTokenHash(fileToken) !== input.tokenFingerprint) {
    return { ok: false, gate: 'env-file', reason: '.env token fingerprint mismatch after status IPC timeout' };
  }

  const attribution = ops.resolveAgentAccount(agentDir, ctxRoot);
  if (attribution.label !== input.targetAccount) {
    return {
      ok: false,
      gate: 'attribution',
      reason: `expected ${input.targetAccount}, got ${attribution.label ?? 'unresolved'} after status IPC timeout`,
    };
  }

  return {
    ok: true,
    primary: 'indeterminate',
    statusIpcTimedOut: true,
    warnings: [
      `WARN: status IPC timed out after ${STATUS_IPC_MAX_TRIES} tries during heavy-boot; auth flip verified by env-file + attribution (file reads); running-pid/live-token/process-start unconfirmed - liveness convenience, not a failure.`,
    ],
  };
}

// Liveness corroborator: return true as soon as a fresh post-restart heartbeat
// is observed, else false at the bound. WARNING-ONLY at the call site - a false
// here never fails the switch. Attempt-capped AND nowMs-deadline-bounded so it
// terminates under either a moving or a frozen (test) clock; the inter-poll wait
// uses the injected sleepMs so tests drive it instantly.
async function awaitFreshHeartbeat(
  agent: string,
  restartAtMs: number,
  initialHeartbeat: string | undefined,
  ops: SwitchAgentAccountOps,
  nowMs: () => number,
  sleepMs: (ms: number) => Promise<void>,
): Promise<boolean> {
  const isFresh = (hb: string | undefined): boolean => {
    const t = hb ? Date.parse(hb) : NaN;
    return !Number.isNaN(t) && t >= restartAtMs && nowMs() - t <= DEFAULT_HEARTBEAT_WINDOW_MS;
  };
  if (isFresh(initialHeartbeat)) return true;
  const deadline = nowMs() + DEFAULT_HEARTBEAT_CORROBORATE_MS;
  const maxAttempts = Math.max(1, Math.ceil(DEFAULT_HEARTBEAT_CORROBORATE_MS / DEFAULT_HEARTBEAT_POLL_MS));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (nowMs() >= deadline) break;
    await sleepMs(DEFAULT_HEARTBEAT_POLL_MS);
    const statuses = await ops.getStatuses();
    const status = statuses.find((s) => s.name === agent);
    if (isFresh(status?.lastHeartbeat)) return true;
  }
  return false;
}

async function busRoundTripProbe(
  paths: BusPaths,
  agent: string,
  operatorAgent: string,
  timeoutMs: number,
  nowMs: () => number,
): Promise<boolean> {
  const probePaths = makeSwitchProbeBusPaths(paths, operatorAgent);
  try {
    const nonce = makeSwitchProbeNonce(agent, nowMs());
    const msgId = sendMessage(
      paths,
      operatorAgent,
      agent,
      'normal',
      `Inference probe: reply exactly "${nonce}" to confirm runtime after account switch.`,
    );
    const deadline = nowMs() + timeoutMs;
    while (nowMs() < deadline) {
      const messages = checkInbox(probePaths);
      for (const msg of messages) {
        if (isExactProbeReply(msg, agent, msgId)) {
          ackInbox(probePaths, msg.id);
          return true;
        }
      }
      for (const msg of messages) {
        if (isAcceptedProbeReply(msg, agent, msgId, nonce)) {
          ackInbox(probePaths, msg.id);
          return true;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  } finally {
    cleanupSwitchProbeInbox(paths, operatorAgent);
  }
}

function createFunctionalSweepTask(paths: BusPaths, org: string, agent: string, targetAccount: string): string {
  const title = `[FUNCTIONAL SWEEP] ${agent} after switch to ${targetAccount}`;
  const description = [
    `Auth flip verified for ${agent} on ${targetAccount}.`,
    'Run SOP playbooks/fleet/switch-agent-account.md step 5: lane-specific post-migration functional sweep.',
    'Success from switch-agent-account means auth flip verified; functional sweep remains pending.',
  ].join(' ');
  const taskId = createTask(paths, 'switch-agent-account', org, title, {
    description,
    assignee: agent,
    priority: 'normal',
    project: 'functional-sweeps',
    autoClassify: false,
  });
  try {
    sendMessage(paths, 'switch-agent-account', agent, 'normal', `Task assigned: ${title} (id: ${taskId})`);
  } catch { /* task creation is the source of truth */ }
  return taskId;
}

function successMessage(agent: string, targetAccount: string, fingerprint: string, taskId: string | undefined): string {
  return [
    `AUTH FLIP VERIFIED: ${agent} -> ${targetAccount} (${fingerprint}, bare sha256/12).`,
    '',
    'FUNCTIONAL SWEEP REQUIRED',
    'Run SOP step 5 for this agent. This tool verified auth flip only; migration is not complete until the lane sweep passes.',
    taskId ? `Queued sweep task: ${taskId}` : 'Sweep task not queued (no bus paths available).',
  ].join('\n');
}

function shredFile(path: string): void {
  try {
    const size = statSync(path).size;
    const overwrite = randomBytes(Math.max(size, 1));
    writeFileSync(path, overwrite, { mode: 0o600 });
    unlinkSync(path);
  } catch { /* delivery-file shred is best-effort after vault write */ }
}

function safeReaddir(path: string): string[] {
  try { return existsSync(path) ? readdirSync(path) : []; } catch { return []; }
}

function safeIsDir(path: string): boolean {
  try { return statSync(path).isDirectory(); } catch { return false; }
}
