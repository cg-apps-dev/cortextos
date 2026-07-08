import { execFileSync } from 'child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { AgentConfig, AgentStatus } from '../types/index.js';
import { atomicWriteSync, ensureDir } from '../utils/atomic.js';
import { stripBom } from '../utils/strip-bom.js';

export const RTK_AUTOHEAL_INTERVAL_MS = 24 * 60 * 60_000;
export const RTK_PASSIVE_WINDOW_MS = 24 * 60 * 60_000;
export const RTK_PROBE_SETTLE_MS = 2_000;
export const RTK_AUTH_WOBBLE_FREEZE_WINDOW_MS = 60 * 60_000;
export const RTK_STATE_VERSION = 1;

const RTK_HISTORY_DB = join(homedir(), 'Library', 'Application Support', 'rtk', 'history.db');
const AUTH_ERROR_SIGNAL_RE =
  /(http\s*401|\b401\b|unauthori[sz]ed|invalid_grant|invalid token|expired token|refresh token|token refresh)/i;

type Logger = (message: string) => void;

export interface RtkAutohealAgentManager {
  getAllStatuses(): AgentStatus[];
  injectAgent?(agentName: string, text: string): boolean;
  injectAgentDetailed?(
    agentName: string,
    text: string,
  ): { ok: true } | { ok: false; code: string; message: string };
}

export interface RtkHistoryReader {
  hasRecentProjectCommand(projectPath: string, sinceIso: string): boolean;
  hasProbeToken(token: string): boolean;
}

export interface RtkContinueDecayAutohealLoop {
  start(): void;
  stop(): void;
  runOnce(): void;
}

export interface RtkDiscoveredAgent {
  name: string;
  agentDir: string;
  projectPath: string;
  runtime: NonNullable<AgentConfig['runtime']>;
}

export interface RtkPendingProbe {
  token: string;
  command: string;
  injectedAt: string;
  projectPath: string;
}

export interface RtkAutohealAgentState {
  pendingProbe?: RtkPendingProbe;
  lastArmAt?: string;
  lastProbeOkAt?: string;
  lastPassiveMissAt?: string;
}

export interface RtkAutohealState {
  version: number;
  agents: Record<string, RtkAutohealAgentState>;
}

export interface RtkContinueDecayAutohealOptions {
  agentManager: RtkAutohealAgentManager;
  ctxRoot: string;
  frameworkRoot: string;
  intervalMs?: number;
  passiveWindowMs?: number;
  probeSettleMs?: number;
  authWobbleFreezeWindowMs?: number;
  nowMs?: () => number;
  logger?: Logger;
  historyReader?: RtkHistoryReader;
  discoverAgents?: (frameworkRoot: string) => RtkDiscoveredAgent[];
}

export class SqliteRtkHistoryReader implements RtkHistoryReader {
  constructor(private readonly historyDbPath = RTK_HISTORY_DB) {}

  hasRecentProjectCommand(projectPath: string, sinceIso: string): boolean {
    const sql = [
      'SELECT COUNT(*) FROM commands',
      `WHERE project_path = ${sqlQuote(projectPath)}`,
      `AND datetime(timestamp) >= datetime(${sqlQuote(sinceIso)});`,
    ].join(' ');
    return sqliteCount(this.historyDbPath, sql) > 0;
  }

  hasProbeToken(token: string): boolean {
    const sql = [
      'SELECT COUNT(*) FROM commands',
      `WHERE original_cmd LIKE ${sqlQuote(`%${token}%`)};`,
    ].join(' ');
    return sqliteCount(this.historyDbPath, sql) > 0;
  }
}

export function createRtkContinueDecayAutohealLoop(
  options: RtkContinueDecayAutohealOptions,
): RtkContinueDecayAutohealLoop {
  const intervalMs = options.intervalMs ?? RTK_AUTOHEAL_INTERVAL_MS;
  const passiveWindowMs = options.passiveWindowMs ?? RTK_PASSIVE_WINDOW_MS;
  const probeSettleMs = options.probeSettleMs ?? RTK_PROBE_SETTLE_MS;
  const authWobbleFreezeWindowMs =
    options.authWobbleFreezeWindowMs ?? RTK_AUTH_WOBBLE_FREEZE_WINDOW_MS;
  const nowMs = options.nowMs ?? (() => Date.now());
  const logger = options.logger ?? ((message: string) => console.log(message));
  const historyReader = options.historyReader ?? new SqliteRtkHistoryReader();
  const discoverAgents = options.discoverAgents ?? discoverClaudeAgents;
  let timer: ReturnType<typeof setInterval> | null = null;

  const runOnce = (): void => {
    try {
      if (hasRecentAuthWobble(options.ctxRoot, nowMs(), authWobbleFreezeWindowMs)) {
        logger('[rtk-autoheal] auth wobble detected; healing frozen');
        return;
      }

      const state = readRtkAutohealState(options.ctxRoot);
      let mutated = false;
      const discovered = new Map(discoverAgents(options.frameworkRoot).map((agent) => [agent.name, agent]));
      const running = options.agentManager.getAllStatuses()
        .filter((status) => status.status === 'running');

      for (const status of running) {
        const agent = discovered.get(status.name);
        if (!agent || agent.runtime !== 'claude-code') continue;

        const agentState = state.agents[status.name] ?? {};
        state.agents[status.name] = agentState;

        if (agentState.pendingProbe) {
          const pendingResult = processPendingProbe({
            agentName: status.name,
            ctxRoot: options.ctxRoot,
            state: agentState,
            historyReader,
            nowMs: nowMs(),
            probeSettleMs,
            passiveWindowMs,
            logger,
          });
          mutated = pendingResult.mutated || mutated;
          if (pendingResult.continueAgent) continue;
        }

        if (forceFreshPathExists(options.ctxRoot, status.name)) continue;
        if (isRecent(agentState.lastArmAt, nowMs(), passiveWindowMs)) continue;

        const sinceIso = new Date(nowMs() - passiveWindowMs).toISOString();
        let hasRecent: boolean;
        try {
          hasRecent = historyReader.hasRecentProjectCommand(agent.projectPath, sinceIso);
        } catch {
          logger(`[rtk-autoheal] history read failed for ${status.name}; skipping`);
          continue;
        }
        if (hasRecent) continue;

        const probe = createProbe(status.name, nowMs(), agent.projectPath);
        if (!injectProbe(options.agentManager, status.name, probe.command)) {
          logger(`[rtk-autoheal] probe inject failed for ${status.name}`);
          continue;
        }
        agentState.pendingProbe = probe;
        agentState.lastPassiveMissAt = new Date(nowMs()).toISOString();
        mutated = true;
        logger(`[rtk-autoheal] passive miss for ${status.name}; probe injected`);
      }

      if (mutated) writeRtkAutohealState(options.ctxRoot, state);
    } catch {
      logger('[rtk-autoheal] scan failed');
    }
  };

  return {
    start(): void {
      if (timer) return;
      runOnce();
      timer = setInterval(runOnce, intervalMs);
    },
    stop(): void {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    runOnce,
  };
}

function processPendingProbe(options: {
  agentName: string;
  ctxRoot: string;
  state: RtkAutohealAgentState;
  historyReader: RtkHistoryReader;
  nowMs: number;
  probeSettleMs: number;
  passiveWindowMs: number;
  logger: Logger;
}): { mutated: boolean; continueAgent: boolean } {
  const pending = options.state.pendingProbe;
  if (!pending) return { mutated: false, continueAgent: false };

  const injectedAtMs = Date.parse(pending.injectedAt);
  if (!Number.isFinite(injectedAtMs) || options.nowMs - injectedAtMs < options.probeSettleMs) {
    return { mutated: false, continueAgent: true };
  }

  try {
    if (options.historyReader.hasProbeToken(pending.token)) {
      delete options.state.pendingProbe;
      options.state.lastProbeOkAt = new Date(options.nowMs).toISOString();
      options.logger(`[rtk-autoheal] probe logged for ${options.agentName}; no heal needed`);
      return { mutated: true, continueAgent: true };
    }
  } catch {
    options.logger(`[rtk-autoheal] probe history read failed for ${options.agentName}; skipping`);
    return { mutated: false, continueAgent: true };
  }

  if (forceFreshPathExists(options.ctxRoot, options.agentName)) {
    delete options.state.pendingProbe;
    return { mutated: true, continueAgent: true };
  }
  if (isRecent(options.state.lastArmAt, options.nowMs, options.passiveWindowMs)) {
    delete options.state.pendingProbe;
    return { mutated: true, continueAgent: true };
  }

  armForceFresh(options.ctxRoot, options.agentName, 'rtk-reengage');
  options.state.lastArmAt = new Date(options.nowMs).toISOString();
  delete options.state.pendingProbe;
  options.logger(`[rtk-autoheal] confirmed decay for ${options.agentName}; force-fresh armed`);
  return { mutated: true, continueAgent: true };
}

export function discoverClaudeAgents(frameworkRoot: string): RtkDiscoveredAgent[] {
  const agents: RtkDiscoveredAgent[] = [];
  const orgsRoot = join(frameworkRoot, 'orgs');
  if (!existsSync(orgsRoot)) return agents;

  let orgs;
  try {
    orgs = readdirSync(orgsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return agents;
  }

  for (const org of orgs) {
    const agentsRoot = join(orgsRoot, org.name, 'agents');
    if (!existsSync(agentsRoot)) continue;
    let agentDirs;
    try {
      agentDirs = readdirSync(agentsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory());
    } catch {
      continue;
    }

    for (const agentDirent of agentDirs) {
      const agentDir = join(agentsRoot, agentDirent.name);
      const configPath = join(agentDir, 'config.json');
      const config = readAgentConfig(configPath);
      const runtime = config.runtime ?? 'claude-code';
      if (runtime !== 'claude-code') continue;
      agents.push({
        name: agentDirent.name,
        agentDir,
        runtime,
        projectPath: config.working_directory || agentDir,
      });
    }
  }

  return agents;
}

export function readRtkAutohealState(ctxRoot: string): RtkAutohealState {
  const path = rtkAutohealStatePath(ctxRoot);
  if (!existsSync(path)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<RtkAutohealState>;
    return {
      version: RTK_STATE_VERSION,
      agents: parsed.agents && typeof parsed.agents === 'object' ? parsed.agents : {},
    };
  } catch {
    return emptyState();
  }
}

export function writeRtkAutohealState(ctxRoot: string, state: RtkAutohealState): void {
  atomicWriteSync(rtkAutohealStatePath(ctxRoot), JSON.stringify({
    version: RTK_STATE_VERSION,
    agents: state.agents,
  }, null, 2));
}

export function rtkAutohealStatePath(ctxRoot: string): string {
  return join(ctxRoot, 'state', 'rtk-continue-decay-autoheal.json');
}

export function createProbe(agentName: string, nowMs: number, projectPath: string): RtkPendingProbe {
  const safeAgent = agentName.replace(/[^A-Za-z0-9_-]/g, '_');
  const token = `RTK_HEAL_PROBE_${safeAgent}_${nowMs}`;
  return {
    token,
    command: `ls -la /etc/hosts /tmp/${token}`,
    injectedAt: new Date(nowMs).toISOString(),
    projectPath,
  };
}

export function hasRecentAuthWobble(
  ctxRoot: string,
  nowMs: number,
  windowMs = RTK_AUTH_WOBBLE_FREEZE_WINDOW_MS,
): boolean {
  const path = join(ctxRoot, 'state', 'usage', 'diagnostics.jsonl');
  if (!existsSync(path)) return false;

  let content: string;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return false;
  }

  const lines = content.split(/\n/).filter((line) => line.trim().length > 0).slice(-500);
  for (const line of lines) {
    const ts = extractDiagnosticTimestamp(line);
    if (!ts || nowMs - ts > windowMs) continue;
    if (isAuthWobbleDiagnostic(line)) return true;
  }

  return false;
}

function isAuthWobbleDiagnostic(line: string): boolean {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const error = stringValue(parsed.error);

    return AUTH_ERROR_SIGNAL_RE.test(error);
  } catch {
    return false;
  }
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function extractDiagnosticTimestamp(line: string): number | null {
  try {
    const parsed = JSON.parse(line) as { ts?: unknown; timestamp?: unknown };
    const raw = typeof parsed.ts === 'string'
      ? parsed.ts
      : typeof parsed.timestamp === 'string'
        ? parsed.timestamp
        : null;
    if (!raw) return null;
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function injectProbe(
  agentManager: RtkAutohealAgentManager,
  agentName: string,
  command: string,
): boolean {
  const prompt = [
    '[RTK AUTOHEAL PROBE]',
    'Run exactly one Bash command, then stop.',
    command,
    'The missing /tmp path is intentional.',
  ].join('\n');

  if (agentManager.injectAgentDetailed) {
    return agentManager.injectAgentDetailed(agentName, prompt).ok;
  }
  return agentManager.injectAgent?.(agentName, prompt) ?? false;
}

function armForceFresh(ctxRoot: string, agentName: string, reason: string): void {
  const markerPath = forceFreshPath(ctxRoot, agentName);
  ensureDir(join(ctxRoot, 'state', agentName));
  atomicWriteSync(markerPath, `${reason} ${new Date().toISOString()}`);
}

function forceFreshPathExists(ctxRoot: string, agentName: string): boolean {
  return existsSync(forceFreshPath(ctxRoot, agentName));
}

function forceFreshPath(ctxRoot: string, agentName: string): string {
  return join(ctxRoot, 'state', agentName, '.force-fresh');
}

function readAgentConfig(configPath: string): AgentConfig {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(stripBom(readFileSync(configPath, 'utf-8'))) as AgentConfig;
  } catch {
    return {};
  }
}

function emptyState(): RtkAutohealState {
  return { version: RTK_STATE_VERSION, agents: {} };
}

function isRecent(iso: string | undefined, nowMs: number, windowMs: number): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) && nowMs - ts < windowMs;
}

function sqliteCount(historyDbPath: string, sql: string): number {
  const output = execFileSync(
    'sqlite3',
    [`file:${historyDbPath}?immutable=1`, sql],
    { encoding: 'utf-8', timeout: 5_000, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
  const count = Number(output);
  return Number.isFinite(count) ? count : 0;
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
