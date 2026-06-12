/**
 * Capacity-aware cron gate for the night-burn failure mode: non-critical
 * heartbeat-class crons can keep firing after an account's 5h bucket is capped
 * while the extra-usage meter is enabled, which burns metered dollars without
 * useful work. This gate fails open on every ambiguous or broken input because
 * monitoring outages must not stop user-facing or safety work.
 *
 * Machine-login resolution uses the keychain-capture marker as the seat-account
 * signal. If machine login is ever flipped to another account, that marker can
 * go stale. Fail-open behavior covers safety, but the flip procedure must
 * update usage_credential sources or set explicit usage_account overrides on
 * login-lane agents.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { CronDefinition } from '../types/index.js';

export interface GateDecision { defer: boolean; reason?: string }

export interface CapacityGateOptions {
  agentName: string;
  agentDir: string;
  ctxRoot: string;
  logger?: (msg: string) => void;
}

export const USAGE_FILE_MAX_AGE_MS = 30 * 60_000;
export const GATE_RECHECK_MS = 15 * 60_000;
export const RESOLUTION_CACHE_TTL_MS = 60_000;

interface UsageAccount {
  account: string;
  ok: boolean;
  five_hour_pct?: number;
  extra_usage?: { is_enabled: boolean; used_credits?: number };
}

interface UsageFile {
  generated_at: string;
  accounts: UsageAccount[];
}

interface OAuthAccount {
  access_token: string;
  usage_credential?: { source: string };
}

interface OAuthAccountsFile {
  accounts: Record<string, OAuthAccount>;
}

interface AccountResolution {
  label: string | null;
  reason?: string;
}

function failOpen(): GateDecision {
  return { defer: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
}

function parseUsageFile(value: unknown): UsageFile | null {
  if (!isRecord(value) || typeof value.generated_at !== 'string' || !Array.isArray(value.accounts)) {
    return null;
  }
  const accounts: UsageAccount[] = [];
  for (const account of value.accounts) {
    if (!isRecord(account) || typeof account.account !== 'string' || typeof account.ok !== 'boolean') {
      return null;
    }
    const parsed: UsageAccount = {
      account: account.account,
      ok: account.ok,
    };
    if (typeof account.five_hour_pct === 'number') {
      parsed.five_hour_pct = account.five_hour_pct;
    }
    if (isRecord(account.extra_usage) && typeof account.extra_usage.is_enabled === 'boolean') {
      parsed.extra_usage = { is_enabled: account.extra_usage.is_enabled };
      if (typeof account.extra_usage.used_credits === 'number') {
        parsed.extra_usage.used_credits = account.extra_usage.used_credits;
      }
    }
    accounts.push(parsed);
  }
  return { generated_at: value.generated_at, accounts };
}

function parseOAuthAccounts(value: unknown): OAuthAccountsFile | null {
  if (!isRecord(value) || !isRecord(value.accounts)) return null;
  const accounts: Record<string, OAuthAccount> = {};
  for (const [label, raw] of Object.entries(value.accounts)) {
    if (!isRecord(raw) || typeof raw.access_token !== 'string') return null;
    const account: OAuthAccount = { access_token: raw.access_token };
    if (isRecord(raw.usage_credential) && typeof raw.usage_credential.source === 'string') {
      account.usage_credential = { source: raw.usage_credential.source };
    }
    accounts[label] = account;
  }
  return { accounts };
}

function readUsageAccountOverride(agentDir: string): { ok: true; label?: string } | { ok: false; reason: string } {
  const configPath = join(agentDir, 'config.json');
  if (!existsSync(configPath)) return { ok: true };
  try {
    const raw = readJson(configPath);
    if (!isRecord(raw)) return { ok: false, reason: 'agent config unreadable' };
    const label = raw.usage_account;
    if (typeof label === 'string' && label.trim().length > 0) {
      return { ok: true, label: label.trim() };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'agent config unreadable' };
  }
}

function readOAuthAccounts(ctxRoot: string): { ok: true; accounts: OAuthAccountsFile } | { ok: false; reason: string } {
  try {
    const parsed = parseOAuthAccounts(readJson(join(ctxRoot, 'state', 'oauth', 'accounts.json')));
    if (!parsed) return { ok: false, reason: 'oauth accounts unreadable' };
    return { ok: true, accounts: parsed };
  } catch {
    return { ok: false, reason: 'oauth accounts unreadable' };
  }
}

function parseEnvToken(content: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?CLAUDE_CODE_OAUTH_TOKEN\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[1] ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return undefined;
}

function readEnvToken(agentDir: string): { ok: true; token?: string } | { ok: false; reason: string } {
  const envPath = join(agentDir, '.env');
  if (!existsSync(envPath)) return { ok: true };
  try {
    return { ok: true, token: parseEnvToken(readFileSync(envPath, 'utf-8')) };
  } catch {
    return { ok: false, reason: 'agent env unreadable' };
  }
}

function resolveAccountLabel(agentDir: string, ctxRoot: string): AccountResolution {
  const override = readUsageAccountOverride(agentDir);
  if (!override.ok) return { label: null, reason: override.reason };
  if (override.label) return { label: override.label };

  const envToken = readEnvToken(agentDir);
  if (!envToken.ok) return { label: null, reason: envToken.reason };

  const oauth = readOAuthAccounts(ctxRoot);
  if (!oauth.ok) return { label: null, reason: oauth.reason };

  if (envToken.token !== undefined) {
    const matches = Object.entries(oauth.accounts.accounts)
      .filter(([, account]) => account.access_token === envToken.token)
      .map(([label]) => label);
    if (matches.length === 1) return { label: matches[0] };
    return { label: null, reason: 'agent billing account unresolved' };
  }

  // Assumes machine login equals the seat account. If machine login is flipped,
  // update usage_credential sources or configure usage_account explicitly.
  const machineMatches = Object.entries(oauth.accounts.accounts)
    .filter(([, account]) => account.usage_credential?.source === 'keychain-capture')
    .map(([label]) => label);
  if (machineMatches.length === 1) return { label: machineMatches[0] };
  return { label: null, reason: 'agent billing account unresolved' };
}

export function makeCapacityGate(opts: CapacityGateOptions): (cron: CronDefinition) => GateDecision {
  let lastLoggedReason: string | undefined;
  let cachedResolution: { at: number; result: AccountResolution } | undefined;

  const logOnce = (reason: string): void => {
    if (reason === lastLoggedReason) return;
    lastLoggedReason = reason;
    opts.logger?.(`[capacity-gate] ${opts.agentName}: ${reason}`);
  };

  const getResolution = (): AccountResolution => {
    const now = Date.now();
    if (cachedResolution && now - cachedResolution.at <= RESOLUTION_CACHE_TTL_MS) {
      return cachedResolution.result;
    }
    const result = resolveAccountLabel(opts.agentDir, opts.ctxRoot);
    cachedResolution = { at: now, result };
    return result;
  };

  return (cron: CronDefinition): GateDecision => {
    if (cron.critical === true) return failOpen();

    let usage: UsageFile | null;
    try {
      usage = parseUsageFile(readJson(join(opts.ctxRoot, 'state', 'usage', 'multi-account-usage.json')));
    } catch {
      logOnce('usage file unreadable');
      return failOpen();
    }

    if (!usage) {
      logOnce('usage file unreadable');
      return failOpen();
    }

    const generatedAt = Date.parse(usage.generated_at);
    if (Number.isNaN(generatedAt)) {
      logOnce('usage file missing generated_at');
      return failOpen();
    }
    if (Date.now() - generatedAt > USAGE_FILE_MAX_AGE_MS) {
      logOnce('usage file stale');
      return failOpen();
    }

    const resolution = getResolution();
    if (!resolution.label) {
      logOnce(resolution.reason ?? 'agent billing account unresolved');
      return failOpen();
    }

    const account = usage.accounts.find((entry) => entry.account === resolution.label);
    if (!account || account.ok !== true) {
      logOnce(`usage account ${resolution.label} unavailable`);
      return failOpen();
    }

    if ((account.five_hour_pct ?? 0) >= 100 && account.extra_usage?.is_enabled === true) {
      return {
        defer: true,
        reason: `account ${resolution.label} 5h=${account.five_hour_pct}% capped + extra-usage meter on`,
      };
    }

    return failOpen();
  };
}
