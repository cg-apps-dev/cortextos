import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import type { NextRequest } from 'next/server';
import { AccountSwitchHttpError, isAdminSession, verifyCsrfAndOrigin, type SwitchSession } from '@/lib/account-switch';
import { getCTXRoot, getFrameworkRoot } from '@/lib/config';
import { getMultiAccountUsage } from '@/lib/data/reports';

const REFRESH_CLI = 'cortextos';
export const USAGE_REFRESH_RATE_LIMIT_MS = 90_000;
const USAGE_REFRESH_TIMEOUT_MS = 30_000;
const USAGE_REFRESH_DIR_MODE = 0o700;
const USAGE_REFRESH_FILE_MODE = 0o600;

interface UsageRefreshState {
  lastForcedAtMs?: number;
  lastAsOf?: string;
}

export interface UsageRefreshResponse {
  refreshed: boolean;
  asOf?: string;
  nextAllowedInMs?: number;
  error?: string;
}

export interface UsageRefreshOps {
  now(): number;
  runSampler(): void;
}

export const defaultUsageRefreshOps: UsageRefreshOps = {
  now: () => Date.now(),
  runSampler() {
    execFileSync(REFRESH_CLI, ['bus', 'check-all-usage'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: USAGE_REFRESH_TIMEOUT_MS,
      env: usageRefreshEnv(),
    });
  },
};

export async function refreshUsageSnapshot(
  request: NextRequest,
  session: SwitchSession | null | undefined,
  ops: UsageRefreshOps = defaultUsageRefreshOps,
): Promise<{ status: number; body: UsageRefreshResponse | { error: string; code: string } }> {
  try {
    if (!session) throw new AccountSwitchHttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    if (!isAdminSession(session)) throw new AccountSwitchHttpError(403, 'Admin access required', 'FORBIDDEN');
    verifyCsrfAndOrigin(request);

    const now = ops.now();
    const beforeAsOf = newestUsageAsOf(now);
    const state = readRefreshState();
    const lastForcedAtMs = typeof state.lastForcedAtMs === 'number' ? state.lastForcedAtMs : null;
    if (lastForcedAtMs !== null && now - lastForcedAtMs < USAGE_REFRESH_RATE_LIMIT_MS) {
      return {
        status: 200,
        body: {
          refreshed: false,
          asOf: beforeAsOf ?? state.lastAsOf,
          nextAllowedInMs: USAGE_REFRESH_RATE_LIMIT_MS - (now - lastForcedAtMs),
        },
      };
    }

    const priorAsOf = beforeAsOf ?? state.lastAsOf;
    writeRefreshState({ lastForcedAtMs: now, ...(priorAsOf ? { lastAsOf: priorAsOf } : {}) });
    try {
      ops.runSampler();
    } catch {
      return {
        status: 200,
        body: {
          refreshed: false,
          asOf: beforeAsOf ?? state.lastAsOf,
          error: 'Usage refresh failed. Existing sampler data is still shown.',
        },
      };
    }

    const asOf = newestUsageAsOf(ops.now()) ?? beforeAsOf ?? state.lastAsOf;
    writeRefreshState({ lastForcedAtMs: ops.now(), ...(asOf ? { lastAsOf: asOf } : {}) });
    return { status: 200, body: { refreshed: true, ...(asOf ? { asOf } : {}) } };
  } catch (err) {
    if (err instanceof AccountSwitchHttpError) {
      return { status: err.status, body: { error: err.message, code: err.code } };
    }
    return { status: 500, body: { error: 'Usage refresh failed', code: 'USAGE_REFRESH_FAILED' } };
  }
}

export function usageRefreshStatePath(): string {
  return path.join(usageStateDir(), 'forced-refresh.json');
}

function newestUsageAsOf(nowMs: number): string | undefined {
  const usage = getMultiAccountUsage(nowMs);
  return usage?.newestFetchedAt ?? usage?.generatedAt;
}

function usageStateDir(): string {
  return path.join(getCTXRoot(), 'state', 'usage');
}

function readRefreshState(): UsageRefreshState {
  try {
    return JSON.parse(fs.readFileSync(usageRefreshStatePath(), 'utf-8')) as UsageRefreshState;
  } catch {
    return {};
  }
}

function writeRefreshState(state: UsageRefreshState): void {
  fs.mkdirSync(usageStateDir(), { recursive: true, mode: USAGE_REFRESH_DIR_MODE });
  fs.chmodSync(usageStateDir(), USAGE_REFRESH_DIR_MODE);
  fs.writeFileSync(usageRefreshStatePath(), JSON.stringify(state, null, 2), { mode: USAGE_REFRESH_FILE_MODE });
  fs.chmodSync(usageRefreshStatePath(), USAGE_REFRESH_FILE_MODE);
}

function usageRefreshEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CTX_ROOT: getCTXRoot(),
    CTX_FRAMEWORK_ROOT: getFrameworkRoot(),
    CTX_PROJECT_ROOT: getFrameworkRoot(),
    CTX_INSTANCE_ID: process.env.CTX_INSTANCE_ID ?? 'default',
    CTX_AGENT_NAME: process.env.CTX_AGENT_NAME ?? 'dashboard',
  };
}
