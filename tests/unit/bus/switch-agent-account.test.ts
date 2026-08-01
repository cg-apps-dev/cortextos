import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { atomicWriteSync } from '../../../src/utils/atomic';
import { shortTokenHash } from '../../../src/utils/live-token-hash';
import { checkInbox, sendMessage } from '../../../src/bus/message';
import {
  DEFAULT_PROBE_RETRY_INTERVAL_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  cleanupSwitchProbeInbox,
  isAcceptedProbeReply,
  isExactProbeReply,
  makeSwitchProbeBusPaths,
  makeSwitchProbeNonce,
  makeSwitchProbeOperatorAgent,
  setupTokenVaultDir,
  setupTokenVaultPath,
  switchAgentAccount,
  switchAllFrom,
  SwitchAgentAccountError,
  type SwitchAgentAccountOps,
} from '../../../src/bus/switch-agent-account';
import type { AgentStatus, IPCResponse } from '../../../src/types';

const OLD_TOKEN = `sk-ant-oat01-${'A'.repeat(95)}`;
const TARGET_TOKEN = `sk-ant-oat01-${'B'.repeat(95)}`;
const TRUNCATED_79_CHAR_TOKEN = `sk-ant-oat01-${'C'.repeat(66)}`;
const DELIVERED_TOKEN = `sk-ant-oat01-${'D'.repeat(95)}`;

describe('switch-agent-account', () => {
  let ctxRoot: string;
  let frameworkRoot: string;
  let agentDir: string;
  let envPath: string;
  let configPath: string;
  let ops: SwitchAgentAccountOps;
  let stopCalls: string[];
  let startCalls: string[];
  let running = true;
  let pid = 123;

  beforeEach(() => {
    ctxRoot = mkdtempSync(join(tmpdir(), 'switch-ctx-'));
    frameworkRoot = mkdtempSync(join(tmpdir(), 'switch-framework-'));
    agentDir = join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents', 'worker-a');
    envPath = join(agentDir, '.env');
    configPath = join(agentDir, 'config.json');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(envPath, `CLAUDE_CODE_OAUTH_TOKEN=${OLD_TOKEN}\n`, { mode: 0o600 });
    atomicWriteSync(configPath, JSON.stringify({ usage_account: 'me-com-max', model: 'x' }, null, 2) + '\n');
    const vaultDir = setupTokenVaultDir(ctxRoot);
    mkdirSync(vaultDir, { recursive: true });
    chmodSync(vaultDir, 0o700);
    writeFileSync(setupTokenVaultPath(ctxRoot, 'moonlight-max'), `${TARGET_TOKEN}\n`, { mode: 0o600 });
    writeFileSync(setupTokenVaultPath(ctxRoot, 'me-com-max'), `${OLD_TOKEN}\n`, { mode: 0o600 });
    stopCalls = [];
    startCalls = [];
    running = true;
    pid = 123;
    ops = makeOps();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(ctxRoot, { recursive: true, force: true });
    rmSync(frameworkRoot, { recursive: true, force: true });
  });

  it('rejects missing agents before any write', async () => {
    await expect(runSwitch({ agent: 'missing-agent' })).rejects.toMatchObject({
      code: 'MISSING_AGENT',
      rolledBack: false,
    });
    expect(readFileSync(envPath, 'utf-8')).toContain(OLD_TOKEN);
  });

  it('rejects a non setup-token target before any write', async () => {
    writeFileSync(setupTokenVaultPath(ctxRoot, 'moonlight-max'), 'not-a-runtime-token\n', { mode: 0o600 });

    await expect(runSwitch()).rejects.toMatchObject({
      code: 'NOT_SETUP_TOKEN',
      rolledBack: false,
    });
    expect(readFileSync(envPath, 'utf-8')).toContain(OLD_TOKEN);
  });

  it('rejects a truncated setup-token before any write', async () => {
    writeFileSync(setupTokenVaultPath(ctxRoot, 'moonlight-max'), `${TRUNCATED_79_CHAR_TOKEN}\n`, { mode: 0o600 });

    await expect(runSwitch()).rejects.toMatchObject({
      code: 'NOT_SETUP_TOKEN',
      rolledBack: false,
    });
    expect(readFileSync(envPath, 'utf-8')).toContain(OLD_TOKEN);
    expect(JSON.parse(readFileSync(configPath, 'utf-8')).usage_account).toBe('me-com-max');
  });

  it('rejects an active auth-wobble gate before any write', async () => {
    ops.hasAuthWobble = () => true;

    await expect(runSwitch()).rejects.toMatchObject({
      code: 'AUTH_WOBBLE',
      rolledBack: false,
    });
    expect(readFileSync(envPath, 'utf-8')).toContain(OLD_TOKEN);
  });

  it('rejects self-switch before any snapshot, write, or restart', async () => {
    let statusCalls = 0;
    ops.getStatuses = async () => {
      statusCalls += 1;
      return [];
    };
    const beforeEnv = readFileSync(envPath, 'utf-8');
    const beforeConfig = readFileSync(configPath, 'utf-8');

    await expect(runSwitch({ operatorAgent: 'worker-a', agent: 'worker-a' })).rejects.toMatchObject({
      code: 'SELF_SWITCH',
      rolledBack: false,
      message: expect.stringContaining('refusing self-switch'),
    });

    expect(statusCalls).toBe(0);
    expect(readFileSync(envPath, 'utf-8')).toBe(beforeEnv);
    expect(readFileSync(configPath, 'utf-8')).toBe(beforeConfig);
    expect(stopCalls).toEqual([]);
    expect(startCalls).toEqual([]);
  });

  it('still switches a different target agent for a non-self operator', async () => {
    const result = await runSwitch({ operatorAgent: 'worker-b', agent: 'worker-a' });

    expect(result.status).toBe('success');
    expect(readFileSync(envPath, 'utf-8')).toContain(TARGET_TOKEN);
    expect(stopCalls).toEqual(['worker-a']);
    expect(startCalls).toEqual(['worker-a']);
  });

  it('pins the bare fingerprint method; newline hashes differently', () => {
    expect(shortTokenHash(TARGET_TOKEN)).not.toBe(shortTokenHash(`${TARGET_TOKEN}\n`));
  });

  it('adds random entropy to the switch probe nonce', () => {
    const first = makeSwitchProbeNonce('worker-a', 1783660000000);
    const second = makeSwitchProbeNonce('worker-a', 1783660000000);

    expect(first).toMatch(/^SWITCH_AGENT_ACCOUNT_PROBE_worker-a_1783660000000_[a-f0-9]{16}$/);
    expect(second).toMatch(/^SWITCH_AGENT_ACCOUNT_PROBE_worker-a_1783660000000_[a-f0-9]{16}$/);
    expect(first).not.toBe(second);
  });

  it('creates a synthetic session-less probe operator name', () => {
    const first = makeSwitchProbeOperatorAgent();
    const second = makeSwitchProbeOperatorAgent();

    expect(first).toMatch(/^switch-probe-[a-f0-9]{16}$/);
    expect(second).toMatch(/^switch-probe-[a-f0-9]{16}$/);
    expect(first).not.toBe(second);
  });

  it('builds probe paths only under the bus inbox tree and cleans them', () => {
    const probeAgent = 'switch-probe-0123456789abcdef';
    const basePaths = {
      ctxRoot,
      inbox: join(ctxRoot, 'inbox', 'operator'),
      inflight: join(ctxRoot, 'inflight', 'operator'),
      processed: join(ctxRoot, 'processed', 'operator'),
      logDir: join(ctxRoot, 'logs', 'operator'),
      stateDir: join(ctxRoot, 'state', 'operator'),
      taskDir: join(ctxRoot, 'orgs', 'clean-green-marketing', 'tasks'),
      approvalDir: join(ctxRoot, 'orgs', 'clean-green-marketing', 'approvals'),
      analyticsDir: join(ctxRoot, 'orgs', 'clean-green-marketing', 'analytics'),
      deliverablesDir: join(ctxRoot, 'orgs', 'clean-green-marketing', 'deliverables'),
    };

    const probePaths = makeSwitchProbeBusPaths(basePaths, probeAgent);

    expect(probePaths.inbox).toBe(join(ctxRoot, 'inbox', probeAgent));
    expect(probePaths.inflight).toBe(join(ctxRoot, 'inbox', probeAgent, '.inflight'));
    expect(probePaths.processed).toBe(join(ctxRoot, 'inbox', probeAgent, '.processed'));
    expect(Object.values(probePaths).join('\n')).not.toContain(join('agents', probeAgent));
    expect(makeSwitchProbeBusPaths(basePaths, 'switch-probe-fedcba9876543210').inbox).not.toBe(probePaths.inbox);

    mkdirSync(probePaths.inbox, { recursive: true });
    cleanupSwitchProbeInbox(basePaths, probeAgent);
    expect(existsSync(probePaths.inbox)).toBe(false);
    expect(existsSync(join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents', probeAgent))).toBe(false);
  });

  it('uses the synthetic probe id in the signed bus path while preserving from-agent verification', () => {
    mkdirSync(join(ctxRoot, 'config'), { recursive: true });
    writeFileSync(join(ctxRoot, 'config', 'bus-signing-key'), 'test-signing-key\n');
    const probeAgent = 'switch-probe-0123456789abcdef';
    const basePaths = {
      ctxRoot,
      inbox: join(ctxRoot, 'inbox', 'operator'),
      inflight: join(ctxRoot, 'inflight', 'operator'),
      processed: join(ctxRoot, 'processed', 'operator'),
      logDir: join(ctxRoot, 'logs', 'operator'),
      stateDir: join(ctxRoot, 'state', 'operator'),
      taskDir: join(ctxRoot, 'orgs', 'clean-green-marketing', 'tasks'),
      approvalDir: join(ctxRoot, 'orgs', 'clean-green-marketing', 'approvals'),
      analyticsDir: join(ctxRoot, 'orgs', 'clean-green-marketing', 'analytics'),
      deliverablesDir: join(ctxRoot, 'orgs', 'clean-green-marketing', 'deliverables'),
    };
    const probePaths = makeSwitchProbeBusPaths(basePaths, probeAgent);

    const msgId = sendMessage(basePaths, probeAgent, 'worker-a', 'normal', 'probe');
    const targetInboxFiles = readdirSync(join(ctxRoot, 'inbox', 'worker-a'));
    const probeMessage = JSON.parse(readFileSync(join(ctxRoot, 'inbox', 'worker-a', targetInboxFiles[0]), 'utf-8')) as { from: string; sig?: string };
    expect(probeMessage.from).toBe(probeAgent);
    expect(probeMessage.sig).toBeTruthy();

    sendMessage(basePaths, 'worker-a', probeAgent, 'normal', 'echo', msgId);
    const replies = checkInbox(probePaths);

    expect(replies).toHaveLength(1);
    expect(isExactProbeReply(replies[0], 'worker-a', msgId)).toBe(true);
    expect(isExactProbeReply({ ...replies[0], from: 'other-agent' }, 'worker-a', msgId)).toBe(false);
    cleanupSwitchProbeInbox(basePaths, probeAgent);
  });

  it('prefers exact probe reply_to and keeps nonce text as fallback only', () => {
    const nonce = makeSwitchProbeNonce('worker-a', 1783660000000);
    const msgId = 'probe-message';

    expect(isExactProbeReply({ from: 'worker-a', reply_to: msgId }, 'worker-a', msgId)).toBe(true);
    expect(isAcceptedProbeReply({ from: 'worker-a', reply_to: msgId, text: 'ready' }, 'worker-a', msgId, nonce)).toBe(true);
    expect(isAcceptedProbeReply({ from: 'worker-a', text: `probe ${nonce}` }, 'worker-a', msgId, nonce)).toBe(true);
    expect(isAcceptedProbeReply({ from: 'other-agent', reply_to: msgId, text: nonce }, 'worker-a', msgId, nonce)).toBe(false);
  });

  it('restores both halves if the env write mutates then throws', async () => {
    ops.writeToken = (_frameworkRoot, _org, token) => {
      writeFileSync(envPath, `CLAUDE_CODE_OAUTH_TOKEN=${token}\n`);
      throw new Error('simulated write failure');
    };

    await expect(runSwitch()).rejects.toMatchObject({
      code: 'SWITCH_FAILED',
      rolledBack: false,
    });
    expect(readFileSync(envPath, 'utf-8')).toContain(OLD_TOKEN);
    expect(JSON.parse(readFileSync(configPath, 'utf-8')).usage_account).toBe('me-com-max');
  });

  it('passes verify when runtime hash, attribution, heartbeat, and probe all pass', async () => {
    const probeOperators: string[] = [];
    ops.probeAgent = async (_agent, operatorAgent) => {
      probeOperators.push(operatorAgent);
      return true;
    };

    const result = await runSwitch();

    expect(result.status).toBe('success');
    expect(result.fingerprint).toBe(shortTokenHash(TARGET_TOKEN));
    expect(result.message).toContain('FUNCTIONAL SWEEP REQUIRED');
    expect(result.functionalSweepTaskId).toBe('task_sweep');
    expect(readFileSync(envPath, 'utf-8')).toContain(TARGET_TOKEN);
    expect(JSON.parse(readFileSync(configPath, 'utf-8')).usage_account).toBe('moonlight-max');
    expect(stopCalls).toEqual(['worker-a']);
    expect(startCalls).toEqual(['worker-a']);
    expect(probeOperators).toHaveLength(1);
    expect(probeOperators[0]).toMatch(/^switch-probe-[a-f0-9]{16}$/);
    expect(probeOperators[0]).not.toBe('the-orchestrator');
    expect(existsSync(join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents', probeOperators[0]))).toBe(false);
    expect(result.warnings).toContain(`INFO: resolved operator agent the-orchestrator; probe replies use session-less ${probeOperators[0]}.`);
  });

  it('passes when the live probe succeeds but the post-restart heartbeat is missing', async () => {
    ops.getStatuses = async (): Promise<AgentStatus[]> => [{
      name: 'worker-a',
      status: running ? 'running' : 'stopped',
      ...(running ? { pid } : {}),
      uptime: 10,
    }];

    const result = await runSwitch();

    expect(result.status).toBe('success');
    expect(result.warnings).toContain('WARN: verified via live probe; post-restart heartbeat not yet fresh at verify time (heavy-boot agent) - corroborator only.');
  });

  it('fails at the probe gate even when heartbeat is fresh', async () => {
    ops.hashLiveProcessToken = () => shortTokenHash(currentEnvToken());
    ops.probeAgent = async () => {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { usage_account: string };
      return config.usage_account !== 'moonlight-max';
    };

    await expect(runSwitch()).rejects.toMatchObject({
      code: 'inference-probe',
      rolledBack: true,
    });
  });

  it('bounds probe retry at the cap when the agent never answers', async () => {
    let currentTime = Date.parse('2026-07-09T17:00:00.000Z');
    let probeCalls = 0;
    ops.hashLiveProcessToken = () => shortTokenHash(currentEnvToken());
    ops.probeAgent = async (_agent, _operator, timeoutMs) => {
      probeCalls += 1;
      currentTime += timeoutMs;
      return false;
    };

    await expect(runSwitch({ nowMs: () => currentTime })).rejects.toMatchObject({
      code: 'ROLLBACK_VERIFY_FAILED',
      rolledBack: true,
    });
    expect(probeCalls).toBe(2 * Math.ceil(DEFAULT_PROBE_TIMEOUT_MS / DEFAULT_PROBE_RETRY_INTERVAL_MS));
    expect(DEFAULT_PROBE_RETRY_INTERVAL_MS).toBe(60_000);
    expect(Math.ceil(DEFAULT_PROBE_TIMEOUT_MS / DEFAULT_PROBE_RETRY_INTERVAL_MS)).toBe(6);
  });

  it('rescues a heavy boot that answers just within the bounded probe cap', async () => {
    const maxProbeAttempts = Math.ceil(DEFAULT_PROBE_TIMEOUT_MS / DEFAULT_PROBE_RETRY_INTERVAL_MS);
    let currentTime = Date.parse('2026-07-09T17:00:00.000Z');
    let probeCalls = 0;
    ops.probeAgent = async (_agent, _operator, timeoutMs) => {
      probeCalls += 1;
      currentTime += timeoutMs;
      return probeCalls === maxProbeAttempts;
    };
    ops.getStatuses = async (): Promise<AgentStatus[]> => [{
      name: 'worker-a',
      status: running ? 'running' : 'stopped',
      ...(running ? { pid } : {}),
      uptime: 10,
      lastHeartbeat: '2026-07-09T17:00:30.000Z',
    }];

    const result = await runSwitch({ nowMs: () => currentTime });

    expect(result.status).toBe('success');
    expect(probeCalls).toBe(maxProbeAttempts);
    expect(result.warnings).toContain('WARN: verified via live probe; post-restart heartbeat not yet fresh at verify time (heavy-boot agent) - corroborator only.');
  });

  it('terminates probe retry on the first successful echo', async () => {
    let probeCalls = 0;
    ops.probeAgent = async () => {
      probeCalls += 1;
      return true;
    };

    const result = await runSwitch();

    expect(result.status).toBe('success');
    expect(probeCalls).toBe(1);
  });

  it('passes with indeterminate runtime proof when ps env read is restricted but primary gates pass', async () => {
    ops.hasProcessEnvVar = () => false;
    ops.hashLiveProcessToken = () => {
      throw new Error('hashLiveProcessToken should not be called when planted-positive is absent');
    };

    const result = await runSwitch();

    expect(result.status).toBe('success');
    expect(result.runtimeProof).toBe('indeterminate');
    expect(result.warnings).toContain('WARN: runtime-token unreadable; attribution via env-file + process-start-postdates-flip + probe, no direct live-token read.');
    expect(readFileSync(envPath, 'utf-8')).toContain(TARGET_TOKEN);
    expect(JSON.parse(readFileSync(configPath, 'utf-8')).usage_account).toBe('moonlight-max');
    expect(stopCalls).toEqual(['worker-a']);
    expect(startCalls).toEqual(['worker-a']);
  });

  it('accepts a start response queued behind an in-flight stop and verifies later', async () => {
    ops.startAgent = async (agent: string): Promise<IPCResponse> => {
      startCalls.push(agent);
      running = true;
      pid += 100;
      return { success: false, code: 'QUEUED_BEHIND_STOP', error: 'start queued behind stop' };
    };

    const result = await runSwitch();

    expect(result.status).toBe('success');
    expect(startCalls).toEqual(['worker-a']);
  });

  it('rolls back when the process start time does not postdate the env flip', async () => {
    let processStartCalls = 0;
    ops.hashLiveProcessToken = () => shortTokenHash(OLD_TOKEN);
    ops.processStartTimeMs = () => {
      processStartCalls += 1;
      return processStartCalls === 1
        ? 1
        : Number.MAX_SAFE_INTEGER;
    };

    await expect(runSwitch()).rejects.toMatchObject({
      code: 'process-start',
      rolledBack: true,
    });
    expect(readFileSync(envPath, 'utf-8')).toContain(OLD_TOKEN);
    expect(JSON.parse(readFileSync(configPath, 'utf-8')).usage_account).toBe('me-com-max');
  });

  it('rolls back on a real runtime-token mismatch and does not fail rollback on stale heartbeat', async () => {
    let hashCalls = 0;
    ops.hashLiveProcessToken = () => {
      hashCalls += 1;
      return hashCalls === 1 ? shortTokenHash('sk-ant-oat01-WRONG') : shortTokenHash(OLD_TOKEN);
    };
    ops.getStatuses = async (): Promise<AgentStatus[]> => [{
      name: 'worker-a',
      status: running ? 'running' : 'stopped',
      ...(running ? { pid } : {}),
      uptime: 10,
      lastHeartbeat: '2026-07-09T16:00:00.000Z',
    }];
    ops.resolveAgentAccount = (_agentDir) => {
      const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { usage_account: string };
      return { label: config.usage_account };
    };

    await expect(runSwitch()).rejects.toMatchObject({
      code: 'runtime-token',
      rolledBack: true,
    });
    expect(readFileSync(envPath, 'utf-8')).toContain(OLD_TOKEN);
    expect(JSON.parse(readFileSync(configPath, 'utf-8')).usage_account).toBe('me-com-max');
    expect(stopCalls).toEqual(['worker-a', 'worker-a']);
    expect(startCalls).toEqual(['worker-a', 'worker-a']);
  });

  it('rolls back when the .env file corroborator does not match the target fingerprint', async () => {
    let statusCalls = 0;
    ops.hasProcessEnvVar = () => false;
    ops.getStatuses = async () => {
      statusCalls += 1;
      if (statusCalls === 3) {
        writeFileSync(envPath, 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-OTHERFILETOKENabcdefghijklmnopqrstuvwxyz012345\n');
      }
      return [{
        name: 'worker-a',
        status: statusCalls === 2 ? 'stopped' : 'running',
        ...(statusCalls === 2 ? {} : { pid: 123 + statusCalls }),
        uptime: 10,
        lastHeartbeat: '2026-07-09T17:01:00.000Z',
      }];
    };

    await expect(runSwitch()).rejects.toMatchObject({
      code: 'env-file',
      rolledBack: true,
    });
    expect(readFileSync(envPath, 'utf-8')).toContain(OLD_TOKEN);
    expect(JSON.parse(readFileSync(configPath, 'utf-8')).usage_account).toBe('me-com-max');
  });

  it('dry-run with token-file validates delivery without mutating the vault', async () => {
    const delivery = join(ctxRoot, 'delivered.token');
    const deliveredToken = DELIVERED_TOKEN;
    writeFileSync(delivery, `${deliveredToken}\n`, { mode: 0o600 });
    const beforeVault = readFileSync(setupTokenVaultPath(ctxRoot, 'moonlight-max'), 'utf-8');

    const result = await runSwitch({ tokenFile: delivery, dryRun: true });

    expect(result.status).toBe('dry-run');
    expect(result.fingerprint).toBe(shortTokenHash(deliveredToken));
    expect(readFileSync(setupTokenVaultPath(ctxRoot, 'moonlight-max'), 'utf-8')).toBe(beforeVault);
    expect(readFileSync(delivery, 'utf-8')).toContain(deliveredToken);
  });

  it('does not vault a delivered token when preflight fails', async () => {
    const delivery = join(ctxRoot, 'delivered.token');
    const deliveredToken = DELIVERED_TOKEN;
    writeFileSync(delivery, `${deliveredToken}\n`, { mode: 0o600 });
    const newVaultPath = setupTokenVaultPath(ctxRoot, 'new-account');

    await expect(runSwitch({ agent: 'missing-agent', targetAccount: 'new-account', tokenFile: delivery })).rejects.toMatchObject({
      code: 'MISSING_AGENT',
      rolledBack: false,
    });

    expect(existsSync(newVaultPath)).toBe(false);
    expect(existsSync(delivery)).toBe(false);
  });

  it('vaults and removes a delivered token after a successful switch', async () => {
    const delivery = join(ctxRoot, 'delivered.token');
    const deliveredToken = DELIVERED_TOKEN;
    writeFileSync(delivery, `${deliveredToken}\n`, { mode: 0o600 });
    ops.hashLiveProcessToken = () => shortTokenHash(deliveredToken);

    const result = await runSwitch({ targetAccount: 'delivered-account', tokenFile: delivery });

    expect(result.status).toBe('success');
    expect(readFileSync(setupTokenVaultPath(ctxRoot, 'delivered-account'), 'utf-8').trim()).toBe(deliveredToken);
    expect(existsSync(delivery)).toBe(false);
    expect(readFileSync(envPath, 'utf-8')).toContain(deliveredToken);
  });

  it('batch --all-from runs sequentially and stops on first failure', async () => {
    const workerB = join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents', 'worker-b');
    mkdirSync(workerB, { recursive: true });
    writeFileSync(join(workerB, '.env'), `CLAUDE_CODE_OAUTH_TOKEN=${OLD_TOKEN}\n`, { mode: 0o600 });
    atomicWriteSync(join(workerB, 'config.json'), JSON.stringify({ usage_account: 'me-com-max' }, null, 2) + '\n');
    ops.resolveAgentAccount = (dir) => {
      const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8')) as { usage_account: string };
      return { label: config.usage_account };
    };
    ops.probeAgent = async (agent) => agent !== 'worker-b';

    const result = await switchAllFrom({
      ctxRoot,
      frameworkRoot,
      org: 'clean-green-marketing',
      instanceId: 'default',
      operatorAgent: 'the-orchestrator',
      sourceAccount: 'me-com-max',
      targetAccount: 'moonlight-max',
      ops,
      nowMs: () => Date.parse('2026-07-09T17:00:00.000Z'),
      sleepMs: async () => {},
    });

    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ agent: 'worker-a', status: 'success' });
    expect(result.results[1]).toMatchObject({ agent: 'worker-b', status: 'failed' });
  });

  it('batch --all-from skips the operator when it is in the source account', async () => {
    const workerB = join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents', 'worker-b');
    mkdirSync(workerB, { recursive: true });
    writeFileSync(join(workerB, '.env'), `CLAUDE_CODE_OAUTH_TOKEN=${OLD_TOKEN}\n`, { mode: 0o600 });
    atomicWriteSync(join(workerB, 'config.json'), JSON.stringify({ usage_account: 'me-com-max' }, null, 2) + '\n');
    ops.resolveAgentAccount = (dir) => {
      const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8')) as { usage_account: string };
      return { label: config.usage_account };
    };

    const result = await switchAllFrom({
      ctxRoot,
      frameworkRoot,
      org: 'clean-green-marketing',
      instanceId: 'default',
      operatorAgent: 'worker-a',
      sourceAccount: 'me-com-max',
      targetAccount: 'moonlight-max',
      ops,
      nowMs: () => Date.parse('2026-07-09T17:00:00.000Z'),
      sleepMs: async () => {},
    });

    expect(result.warnings).toEqual(['WARN: skipping self: worker-a cannot switch its own account in a batch.']);
    expect(result.results).toEqual([{ agent: 'worker-b', status: 'success', taskId: 'task_sweep' }]);
    expect(readFileSync(envPath, 'utf-8')).toContain(OLD_TOKEN);
    expect(readFileSync(join(workerB, '.env'), 'utf-8')).toContain(TARGET_TOKEN);
    expect(stopCalls).toEqual(['worker-b']);
    expect(startCalls).toEqual(['worker-b']);
  });

  it('batch --all-from refuses when the operator is the only source-account agent', async () => {
    const beforeEnv = readFileSync(envPath, 'utf-8');
    const beforeConfig = readFileSync(configPath, 'utf-8');

    await expect(switchAllFrom({
      ctxRoot,
      frameworkRoot,
      org: 'clean-green-marketing',
      instanceId: 'default',
      operatorAgent: 'worker-a',
      sourceAccount: 'me-com-max',
      targetAccount: 'moonlight-max',
      ops,
      nowMs: () => Date.parse('2026-07-09T17:00:00.000Z'),
      sleepMs: async () => {},
    })).rejects.toMatchObject({
      code: 'SELF_SWITCH',
      rolledBack: false,
      message: expect.stringContaining('refusing self-switch'),
    });

    expect(readFileSync(envPath, 'utf-8')).toBe(beforeEnv);
    expect(readFileSync(configPath, 'utf-8')).toBe(beforeConfig);
    expect(stopCalls).toEqual([]);
    expect(startCalls).toEqual([]);
  });

  it('does not include token values in returned errors', async () => {
    ops.hashLiveProcessToken = () => shortTokenHash('sk-ant-oat01-WRONG');

    try {
      await runSwitch();
      throw new Error('expected failure');
    } catch (err) {
      expect(err).toBeInstanceOf(SwitchAgentAccountError);
      expect(String((err as Error).message)).not.toContain(TARGET_TOKEN);
      expect(String((err as Error).message)).not.toContain(OLD_TOKEN);
      expect(JSON.stringify(err)).not.toContain(TARGET_TOKEN);
      expect(JSON.stringify(err)).not.toContain(OLD_TOKEN);
    }
  });

  function makeOps(): SwitchAgentAccountOps {
    return {
      async getStatuses(): Promise<AgentStatus[]> {
        return [{
          name: 'worker-a',
          status: running ? 'running' : 'stopped',
          ...(running ? { pid } : {}),
          uptime: 10,
          lastHeartbeat: '2026-07-09T17:01:00.000Z',
        }, {
          name: 'worker-b',
          status: running ? 'running' : 'stopped',
          ...(running ? { pid: 124 } : {}),
          uptime: 10,
          lastHeartbeat: '2026-07-09T17:01:00.000Z',
        }];
      },
      async stopAgent(agent: string): Promise<IPCResponse> {
        stopCalls.push(agent);
        running = false;
        return { success: true, data: 'Stopping' };
      },
      async startAgent(agent: string): Promise<IPCResponse> {
        startCalls.push(agent);
        running = true;
        pid += 100;
        return { success: true, data: 'Starting' };
      },
      hashLiveProcessToken: () => shortTokenHash(TARGET_TOKEN),
      hasProcessEnvVar: () => true,
      processStartTimeMs: () => Number.MAX_SAFE_INTEGER,
      resolveAgentAccount: (dir) => {
        const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf-8')) as { usage_account: string };
        return { label: config.usage_account };
      },
      hasAuthWobble: () => false,
      probeAgent: async () => true,
      createFunctionalSweepTask: () => 'task_sweep',
      writeToken: (_frameworkRoot, _org, token, agent) => {
        const targetEnv = join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents', agent, '.env');
        writeFileSync(targetEnv, `CLAUDE_CODE_OAUTH_TOKEN=${token}\n`);
      },
    };
  }

  function runSwitch(overrides: Partial<Parameters<typeof switchAgentAccount>[0]> = {}) {
    return switchAgentAccount({
      ctxRoot,
      frameworkRoot,
      org: 'clean-green-marketing',
      instanceId: 'default',
      operatorAgent: 'the-orchestrator',
      agent: 'worker-a',
      targetAccount: 'moonlight-max',
      ops,
      nowMs: () => Date.parse('2026-07-09T17:00:00.000Z'),
      sleepMs: async () => {},
      ...overrides,
    });
  }

  function currentEnvToken(): string {
    const line = readFileSync(envPath, 'utf-8').split('\n').find((entry) => entry.startsWith('CLAUDE_CODE_OAUTH_TOKEN='));
    return line?.slice('CLAUDE_CODE_OAUTH_TOKEN='.length) ?? '';
  }
});
