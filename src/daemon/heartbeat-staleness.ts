import { execFile } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CronDefinition, Heartbeat } from '../types/index.js';
import { cronExpressionMinIntervalMs, parseDurationMs } from '../bus/cron-state.js';
import { CRONS_DIRECTORY, CRONS_FILENAME } from '../bus/crons-schema.js';

export const HEARTBEAT_STALENESS_INTERVAL_MS = 15 * 60_000;
export const HEARTBEAT_STALENESS_THRESHOLD_GRACE_HOURS = 0.5;
export const HEARTBEAT_STALENESS_ALERT_COOLDOWN_MS = 60 * 60_000;

type Logger = (message: string) => void;
type Notifier = (message: string) => void;

export interface StalenessAgentInput {
  last_heartbeat?: string;
  timestamp?: string;
}

export interface StalenessAlert {
  agent: string;
  ageHours: number | null;
  thresholdHours: number | null;
  blocked?: string;
}

export interface StalenessScanResult {
  scannedCount: number;
  alerts: StalenessAlert[];
  blocked: boolean;
}

export interface HeartbeatStalenessMonitorLoop {
  start(): void;
  stop(): void;
  runOnce(): void;
}

export interface HeartbeatStalenessMonitorOptions {
  ctxRoot: string;
  frameworkRoot: string;
  intervalMs?: number;
  alertCooldownMs?: number;
  nowMs?: () => number;
  scanner?: (ctxRoot: string, now: Date) => StalenessScanResult;
  notifier?: Notifier;
  logger?: Logger;
}

export function stalenessAlerts(args: {
  agents: Record<string, StalenessAgentInput>;
  cadences: Record<string, number>;
  now: Date;
}): StalenessAlert[] {
  const alerts: StalenessAlert[] = [];
  const nowMs = args.now.getTime();

  for (const [agent, heartbeat] of Object.entries(args.agents)) {
    const cadenceHours = args.cadences[agent];
    if (!Number.isFinite(cadenceHours) || cadenceHours <= 0) {
      alerts.push({
        agent,
        ageHours: null,
        thresholdHours: null,
        blocked: 'no cadence known',
      });
      continue;
    }

    const heartbeatTs = heartbeat.last_heartbeat ?? heartbeat.timestamp;
    const heartbeatMs = heartbeatTs ? Date.parse(heartbeatTs) : NaN;
    if (!Number.isFinite(heartbeatMs)) {
      alerts.push({
        agent,
        ageHours: null,
        thresholdHours: cadenceHours * 2 + HEARTBEAT_STALENESS_THRESHOLD_GRACE_HOURS,
        blocked: 'invalid heartbeat timestamp',
      });
      continue;
    }

    const ageHours = (nowMs - heartbeatMs) / 3_600_000;
    const thresholdHours = cadenceHours * 2 + HEARTBEAT_STALENESS_THRESHOLD_GRACE_HOURS;
    if (ageHours > thresholdHours) {
      alerts.push({ agent, ageHours, thresholdHours });
    }
  }

  return alerts;
}

export function scanHeartbeatStaleness(ctxRoot: string, now = new Date()): StalenessScanResult {
  const agents = readHeartbeatAgents(ctxRoot);
  const cadences = deriveHeartbeatCadences(Object.keys(agents), ctxRoot);
  const alerts = stalenessAlerts({ agents, cadences, now });
  const scannedCount = Object.keys(agents).length;

  if (scannedCount === 0) {
    return {
      scannedCount,
      alerts: [{
        agent: '*',
        ageHours: null,
        thresholdHours: null,
        blocked: 'no heartbeats scanned',
      }],
      blocked: true,
    };
  }

  return {
    scannedCount,
    alerts,
    blocked: alerts.some((alert) => Boolean(alert.blocked)),
  };
}

export function deriveHeartbeatCadences(
  agentNames: string[],
  ctxRoot = process.env.CTX_ROOT ?? process.cwd(),
): Record<string, number> {
  const cadences: Record<string, number> = {};

  for (const agentName of agentNames) {
    const crons = readCronDefinitions(ctxRoot, agentName);
    if (crons === null) continue;

    const heartbeatCron = selectHeartbeatCron(crons);
    if (!heartbeatCron) continue;

    const cadenceMs = cadenceMsFromSchedule(heartbeatCron.schedule);
    if (Number.isFinite(cadenceMs) && cadenceMs > 0) {
      cadences[agentName] = cadenceMs / 3_600_000;
    }
  }

  return cadences;
}

export function createHeartbeatStalenessMonitorLoop(
  options: HeartbeatStalenessMonitorOptions,
): HeartbeatStalenessMonitorLoop {
  const intervalMs = options.intervalMs ?? HEARTBEAT_STALENESS_INTERVAL_MS;
  const alertCooldownMs = options.alertCooldownMs ?? HEARTBEAT_STALENESS_ALERT_COOLDOWN_MS;
  const nowMs = options.nowMs ?? (() => Date.now());
  const logger = options.logger ?? ((message: string) => console.log(message));
  const scanner = options.scanner ?? scanHeartbeatStaleness;
  const notifier = options.notifier ?? ((message: string) => notifyOrchestrator(options.frameworkRoot, message));
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastAlertKey = '';
  let lastAlertAt = 0;

  const runOnce = (): void => {
    let result: StalenessScanResult;
    const now = new Date(nowMs());
    try {
      result = scanner(options.ctxRoot, now);
    } catch {
      logger('[heartbeat-staleness] scan failed');
      return;
    }

    logger(`[heartbeat-staleness] scanned=${result.scannedCount} alerts=${result.alerts.length}`);
    if (result.alerts.length === 0) {
      lastAlertKey = '';
      return;
    }

    const alertKey = JSON.stringify(result.alerts.map((alert) => [
      alert.agent,
      alert.blocked ?? '',
      alert.thresholdHours,
    ]));
    const nowEpochMs = now.getTime();
    if (alertKey === lastAlertKey && nowEpochMs - lastAlertAt < alertCooldownMs) return;

    lastAlertKey = alertKey;
    lastAlertAt = nowEpochMs;
    notifier(formatStalenessAlert(result));
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

function readHeartbeatAgents(ctxRoot: string): Record<string, StalenessAgentInput> {
  const stateDir = join(ctxRoot, 'state');
  const agents: Record<string, StalenessAgentInput> = {};
  let dirs: string[];

  try {
    dirs = readdirSync(stateDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);
  } catch {
    return agents;
  }

  for (const agentName of dirs) {
    const heartbeatPath = join(stateDir, agentName, 'heartbeat.json');
    if (!existsSync(heartbeatPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(heartbeatPath, 'utf-8')) as Heartbeat;
      agents[agentName] = {
        last_heartbeat: parsed.last_heartbeat,
        timestamp: parsed.timestamp,
      };
    } catch {
      agents[agentName] = {};
    }
  }

  return agents;
}

function selectHeartbeatCron(crons: CronDefinition[]): CronDefinition | null {
  return crons.find((cron) => cron.enabled !== false && cron.name === 'heartbeat')
    ?? crons.find((cron) => cron.enabled !== false && /\bheartbeat\b/i.test(cron.prompt))
    ?? null;
}

function readCronDefinitions(ctxRoot: string, agentName: string): CronDefinition[] | null {
  const cronsPath = join(ctxRoot, CRONS_DIRECTORY, agentName, CRONS_FILENAME);
  const crons = readCronDefinitionsFile(cronsPath);
  if (crons !== null) return crons;

  const backup = readCronDefinitionsFile(`${cronsPath}.bak`);
  return backup;
}

function readCronDefinitionsFile(filePath: string): CronDefinition[] | null {
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as { crons?: unknown };
    return Array.isArray(parsed.crons) ? parsed.crons as CronDefinition[] : null;
  } catch {
    return null;
  }
}

function cadenceMsFromSchedule(schedule: string): number {
  const intervalMs = parseDurationMs(schedule);
  if (Number.isFinite(intervalMs) && intervalMs > 0) return intervalMs;

  const cronMs = cronExpressionMinIntervalMs(schedule);
  return Number.isFinite(cronMs) && cronMs > 0 ? cronMs : NaN;
}

function formatStalenessAlert(result: StalenessScanResult): string {
  const lines = result.alerts
    .map((alert) => {
      if (alert.blocked) return `${alert.agent}: BLOCKED (${alert.blocked})`;
      return `${alert.agent}: ${formatHours(alert.ageHours)}h since heartbeat, threshold ${formatHours(alert.thresholdHours)}h`;
    })
    .join('; ');
  return `[HEARTBEAT-STALENESS] scanned_count=${result.scannedCount} blocked=${result.blocked} alerts=${result.alerts.length}: ${lines}`;
}

function formatHours(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unknown';
  return value.toFixed(1);
}

function notifyOrchestrator(frameworkRoot: string, message: string): void {
  const cliPath = join(frameworkRoot, 'dist', 'cli.js');
  execFile(process.execPath, [cliPath, 'bus', 'notify-agent', 'the-orchestrator', message], (err) => {
    if (err) {
      console.error('[heartbeat-staleness] orchestrator notify failed');
    }
  });
}
