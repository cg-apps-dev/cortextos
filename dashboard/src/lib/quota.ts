/**
 * Quota helpers for the dashboard topbar indicator.
 *
 * The fleet runs isolated bearer tokens, so dashboard quota UX must never read
 * Claude Code credentials or call Anthropic OAuth usage directly. This module
 * projects the existing multi-account usage cache into the compact topbar shape.
 */
import type { AccountUsagePanelEntry } from '@/lib/data/reports';
import { getMultiAccountUsage } from '@/lib/data/reports';

export interface QuotaSnapshot {
  account: string;
  email: string;
  plan: string;
  status: AccountUsagePanelEntry['status'];
  ok: boolean;
  five_hour_pct?: number;
  seven_day_pct?: number;
  five_hour_resets?: string;
  seven_day_resets?: string;
  fetched_at: string;
  source: 'multi-account-usage';
  error?: string;
  cache_age_ms?: number;
}

function toSnapshot(entry: AccountUsagePanelEntry): QuotaSnapshot {
  return {
    account: entry.account,
    email: entry.email,
    plan: entry.plan,
    status: entry.status,
    ok: entry.status === 'ok',
    ...(entry.status === 'ok' && typeof entry.five_hour_pct === 'number' ? { five_hour_pct: entry.five_hour_pct } : {}),
    ...(entry.status === 'ok' && typeof entry.seven_day_pct === 'number' ? { seven_day_pct: entry.seven_day_pct } : {}),
    ...(entry.status === 'ok' && entry.five_hour_resets ? { five_hour_resets: entry.five_hour_resets } : {}),
    ...(entry.status === 'ok' && entry.seven_day_resets ? { seven_day_resets: entry.seven_day_resets } : {}),
    fetched_at: entry.fetched_at ?? entry.freshness?.asOf ?? new Date(0).toISOString(),
    source: 'multi-account-usage',
    ...(entry.error || entry.suspectReason ? { error: entry.error ?? entry.suspectReason } : {}),
    ...(typeof entry.freshness?.ageMs === 'number' ? { cache_age_ms: entry.freshness.ageMs } : {}),
  };
}

/**
 * Read the freshest usable account from the multi-account cache. If every
 * account is failed or stale, return an explicit non-ok row so the topbar says
 * UNREACHABLE instead of showing last-good numbers as current.
 */
export async function fetchQuotaSnapshot(): Promise<QuotaSnapshot | null> {
  const usage = getMultiAccountUsage();
  if (!usage || usage.accounts.length === 0) return null;
  const active = usage.accounts.find((account) => account.status === 'ok') ?? usage.accounts[0];
  return toSnapshot(active);
}
