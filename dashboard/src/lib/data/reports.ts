import fs from 'fs';
import path from 'path';
import os from 'os';
import { db } from '@/lib/db';

// Resolve CTX_ROOT without importing from config (avoids turbopack chunk issues)
const CTX_INSTANCE_ID = process.env.CTX_INSTANCE_ID ?? 'default';
const CTX_ROOT = process.env.CTX_ROOT ?? path.join(os.homedir(), '.cortextos', CTX_INSTANCE_ID);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FleetHealthAgent {
  name: string;
  heartbeatAgeMin: number;
  isStale: boolean;
  events: number;
  realErrors: number;
  crashes: number;
  heartbeats: number;
  stability: number; // (heartbeats - crashes) / heartbeats * 100
}

export interface AgentMessageCount {
  name: string;
  sent: number;
  received: number;
}

export interface FleetHealth {
  agents: FleetHealthAgent[];
  messageBus: { totalToday: number; pending: number; perAgent: AgentMessageCount[] };
  fleetStability: number;
  staleCount: number;
  errorCount: number;
}

export interface AgentCostData {
  agent: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  models: Record<string, number>;
}

export interface CostIntelligence {
  fleetTokensToday: number;
  fleetCostToday: number;
  perAgent: AgentCostData[];
}

export interface LatestSnapshot {
  date: string;
  generatedAt: string;
  health: Record<string, unknown>;
  productivity: Record<string, unknown>;
  cost: Record<string, unknown>;
  alignment: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Core reader
// ---------------------------------------------------------------------------

function getReportsDir(org: string): string {
  return path.join(CTX_ROOT, 'orgs', org, 'analytics', 'reports');
}

export function getLatestSnapshot(org: string): LatestSnapshot | null {
  const file = path.join(getReportsDir(org), 'latest.json');
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const data = JSON.parse(raw);
    return {
      date: data.date ?? '',
      generatedAt: data.generated_at ?? '',
      health: data.health ?? {},
      productivity: data.productivity ?? {},
      cost: data.cost ?? {},
      alignment: data.alignment ?? {},
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fleet Health (Phase 1)
// ---------------------------------------------------------------------------

export function getFleetHealth(org: string): FleetHealth | null {
  const snapshot = getLatestSnapshot(org);
  if (!snapshot?.health) {
    // Fallback: build fleet health from live heartbeat files
    return getFleetHealthFromHeartbeats(org);
  }

  const healthData = snapshot.health as {
    agents?: Record<string, {
      agent: string;
      heartbeat_age_min: number;
      is_stale: boolean;
      events: number;
      real_errors: number;
      crashes: number;
      heartbeats: number;
    }>;
    message_bus?: { inbox: number; inflight: number; processed: number };
  };

  const agents: FleetHealthAgent[] = [];
  let totalStability = 0;
  let staleCount = 0;
  let errorCount = 0;

  if (healthData.agents) {
    for (const [name, data] of Object.entries(healthData.agents)) {
      const hb = data.heartbeats || 1;
      // Stability based on real errors, not total restarts (which include planned restarts)
      const stability = Math.round(((hb - data.real_errors) / hb) * 100);
      if (data.is_stale) staleCount++;
      errorCount += data.real_errors;
      totalStability += stability;

      // Read live heartbeat for real-time Last Seen
      let liveAgeMin = data.heartbeat_age_min;
      const hbFile = path.join(CTX_ROOT, 'state', name, 'heartbeat.json');
      try {
        if (fs.existsSync(hbFile)) {
          const hbData = JSON.parse(fs.readFileSync(hbFile, 'utf-8'));
          if (hbData.last_heartbeat) {
            const ageMs = Date.now() - new Date(hbData.last_heartbeat).getTime();
            liveAgeMin = Math.round(ageMs / 60000);
          }
        }
      } catch { /* use report data as fallback */ }

      agents.push({
        name,
        heartbeatAgeMin: liveAgeMin,
        isStale: liveAgeMin > 300, // 5 hours = stale
        events: data.events,
        realErrors: data.real_errors,
        crashes: data.crashes,
        heartbeats: data.heartbeats,
        stability,
      });
    }
  }

  const fleetStability = agents.length > 0
    ? Math.round(totalStability / agents.length)
    : 100;

  // Count messages per agent from processed/inbox directories
  // Only include agents that belong to this org (from health report)
  const orgAgentNames = new Set(agents.map(a => a.name));
  let deliveredToday = 0;
  let totalPending = 0;
  const perAgentMessages: Record<string, { sent: number; received: number }> = {};
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  // Received = messages in this agent's processed dir today
  const processedDir = path.join(CTX_ROOT, 'processed');
  if (fs.existsSync(processedDir)) {
    for (const ad of fs.readdirSync(processedDir, { withFileTypes: true })) {
      if (!ad.isDirectory()) continue;
      const agentName = ad.name;
      if (!orgAgentNames.has(agentName)) continue; // Skip agents not in this org
      if (!perAgentMessages[agentName]) perAgentMessages[agentName] = { sent: 0, received: 0 };
      try {
        for (const f of fs.readdirSync(path.join(processedDir, agentName))) {
          try {
            if (fs.statSync(path.join(processedDir, agentName, f)).mtimeMs >= todayMs) {
              deliveredToday++;
              perAgentMessages[agentName].received++;
              // Parse sender from filename (format: PNUM-EPOCH-from-SENDER-RAND.json)
              const senderMatch = f.match(/from-([a-z0-9_-]+)-/);
              if (senderMatch && orgAgentNames.has(senderMatch[1])) {
                const sender = senderMatch[1];
                if (!perAgentMessages[sender]) perAgentMessages[sender] = { sent: 0, received: 0 };
                perAgentMessages[sender].sent++;
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
  }

  const inboxDir = path.join(CTX_ROOT, 'inbox');
  if (fs.existsSync(inboxDir)) {
    for (const ad of fs.readdirSync(inboxDir, { withFileTypes: true })) {
      if (!ad.isDirectory()) continue;
      try { totalPending += fs.readdirSync(path.join(inboxDir, ad.name)).length; } catch { /* skip */ }
    }
  }

  const perAgent: AgentMessageCount[] = Object.entries(perAgentMessages)
    .map(([name, counts]) => ({ name, ...counts }))
    .sort((a, b) => (b.sent + b.received) - (a.sent + a.received));

  return {
    agents: agents.sort((a, b) => a.stability - b.stability),
    messageBus: { totalToday: deliveredToday, pending: totalPending, perAgent },
    fleetStability,
    staleCount,
    errorCount,
  };
}

// ---------------------------------------------------------------------------
// Fallback: build fleet health from live heartbeat files when no report exists
function getFleetHealthFromHeartbeats(org: string): FleetHealth | null {
  const CTX_FRAMEWORK_ROOT = process.env.CTX_FRAMEWORK_ROOT ?? path.join(path.dirname(CTX_ROOT), '..');
  const agentsDir = path.join(CTX_FRAMEWORK_ROOT, 'orgs', org, 'agents');
  if (!fs.existsSync(agentsDir)) return null;

  const agents: FleetHealthAgent[] = [];
  for (const entry of fs.readdirSync(agentsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const hbFile = path.join(CTX_ROOT, 'state', name, 'heartbeat.json');
    let ageMin = 9999;
    try {
      if (fs.existsSync(hbFile)) {
        const hb = JSON.parse(fs.readFileSync(hbFile, 'utf-8'));
        if (hb.last_heartbeat) {
          ageMin = Math.round((Date.now() - new Date(hb.last_heartbeat).getTime()) / 60000);
        }
      }
    } catch { /* skip */ }

    agents.push({
      name,
      heartbeatAgeMin: ageMin,
      isStale: ageMin > 300,
      events: 0,
      realErrors: 0,
      crashes: 0,
      heartbeats: 1,
      stability: 100,
    });
  }

  if (agents.length === 0) return null;

  return {
    agents,
    messageBus: { totalToday: 0, pending: 0, perAgent: [] },
    fleetStability: 100,
    staleCount: agents.filter(a => a.isStale).length,
    errorCount: 0,
  };
}

// Multi-account Claude subscription usage (3-account panel)
// ---------------------------------------------------------------------------

/**
 * Account-key -> display label + plan name. Adam-specified labels; the keys
 * are the accounts.json identifiers the usage monitor writes. New accounts
 * fall back to the raw key so they still render (visible, not dropped).
 */
const ACCOUNT_LABELS: Record<string, { email: string; plan: string }> = {
  'me-com-max': { email: 'afolker@me.com', plan: 'Personal Claude MAX Plan' },
  'cg-team-seat': { email: 'adam@cleangreen.com', plan: 'Teams Premium Seat Plan' },
  'icloud-max-20x': { email: 'afolker@icloud.com', plan: 'Personal Claude MAX Plan' },
  'moonlight-max': { email: 'moonlightmedia312@gmail.com', plan: 'Personal Claude MAX Plan' },
};

// Display order: cleangreen seat first (primary), then the personal MAX accounts.
const ACCOUNT_ORDER = ['cg-team-seat', 'me-com-max', 'icloud-max-20x', 'moonlight-max'];

// Anthropic extra-usage billing: 100 credits = $1.00; me.com is capped at $10k.
const CREDITS_PER_USD = 100;
const EXTRA_USAGE_CAP_USD: Record<string, number> = { 'me-com-max': 10000 };

export interface ScopedLimit {
  model: string;
  percent: number;
  severity: 'normal' | 'warning' | 'critical';
  resets_at?: string;
  is_active: boolean;
}

export interface AccountUsagePanelEntry {
  account: string;
  email: string;
  plan: string;
  ok: boolean;
  error?: string;
  five_hour_pct?: number;
  seven_day_pct?: number;
  five_hour_resets?: string;
  seven_day_resets?: string;
  extra_usage?: {
    is_enabled: boolean;
    used_credits: number;
    used_usd: number;
    cap_usd?: number;
  };
  scoped_limits?: ScopedLimit[];
  last_good?: {
    five_hour_pct?: number;
    seven_day_pct?: number;
    five_hour_resets?: string;
    seven_day_resets?: string;
    extra_usage?: {
      is_enabled: boolean;
      used_credits?: number;
    };
    scoped_limits?: ScopedLimit[];
    fetched_at: string;
  };
  fetched_at?: string;
}

interface RawAccountUsage {
  account: string;
  ok: boolean;
  error?: string;
  five_hour_pct?: number;
  seven_day_pct?: number;
  five_hour_resets?: string;
  seven_day_resets?: string;
  extra_usage?: { is_enabled: boolean; used_credits?: number };
  scoped_limits?: ScopedLimit[];
  last_good?: {
    five_hour_pct?: number;
    seven_day_pct?: number;
    five_hour_resets?: string;
    seven_day_resets?: string;
    extra_usage?: { is_enabled: boolean; used_credits?: number };
    scoped_limits?: ScopedLimit[];
    fetched_at: string;
  };
  fetched_at?: string;
}

/**
 * Read the consolidated all-accounts usage snapshot (written by
 * `cortextos bus check-all-usage`, refreshed every 2h by launchd). Maps each
 * account to its email/plan label and enriches extra-usage with USD + cap.
 * Returns null if the snapshot has not been written yet.
 */
export function getMultiAccountUsage(): { generatedAt: string; accounts: AccountUsagePanelEntry[] } | null {
  const file = path.join(CTX_ROOT, 'state', 'usage', 'multi-account-usage.json');
  if (!fs.existsSync(file)) return null;
  let raw: { generated_at: string; accounts: RawAccountUsage[] };
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
  const byKey = new Map(raw.accounts.map((a) => [a.account, a]));
  // Preferred order first, then any unknown accounts appended.
  const keys = [
    ...ACCOUNT_ORDER.filter((k) => byKey.has(k)),
    ...raw.accounts.map((a) => a.account).filter((k) => !ACCOUNT_ORDER.includes(k)),
  ];
  const accounts: AccountUsagePanelEntry[] = keys.map((key) => {
    const a = byKey.get(key)!;
    const label = ACCOUNT_LABELS[key] ?? { email: key, plan: 'Claude Plan' };
    const entry: AccountUsagePanelEntry = {
      account: key,
      email: label.email,
      plan: label.plan,
      ok: a.ok,
      error: a.error,
      five_hour_pct: a.five_hour_pct,
      seven_day_pct: a.seven_day_pct,
      five_hour_resets: a.five_hour_resets,
      seven_day_resets: a.seven_day_resets,
      scoped_limits: a.scoped_limits,
      last_good: a.last_good,
      fetched_at: a.fetched_at,
    };
    if (a.extra_usage) {
      const credits = a.extra_usage.used_credits ?? 0;
      entry.extra_usage = {
        is_enabled: a.extra_usage.is_enabled,
        used_credits: credits,
        used_usd: credits / CREDITS_PER_USD,
        cap_usd: EXTRA_USAGE_CAP_USD[key],
      };
    }
    return entry;
  });
  return { generatedAt: raw.generated_at, accounts };
}

export type AccountConfidenceTier = 'CONFIRMED-PKCE' | 'CONFIRMED-CORRELATION' | 'ASSERTED' | 'UNVERIFIED';

export interface PromotionCandidate {
  cluster_id: string;
  target_account: string;
  seven_day_delta: number;
  five_hour_pct: number | null;
  spend_pct_or_extra_usage: number | null;
  no_other_cluster_guard: 'pass';
}

export interface AgentAccountAttribution {
  agent: string;
  tier: AccountConfidenceTier;
  source: string;
  cluster_id: string | null;
  pending_restart: boolean;
}

export interface AccountAttribution {
  tier: AccountConfidenceTier;
  verified_at?: string;
  stale: boolean;
  pending_restart: boolean;
  source: string;
  note?: string;
  promotion_candidate?: PromotionCandidate;
  agents: AgentAccountAttribution[];
}

export interface AgentAccounts {
  byAccount: Record<string, string[]>;
  unassigned: string[];
  codexAgents: string[];
  generatedAt?: string;
  stale: boolean;
  promotionCandidates: PromotionCandidate[];
  accounts: Record<string, AccountAttribution>;
  agents: Record<string, AgentAccountAttribution>;
}

export function shortAgentName(name: string): string {
  let short = name;
  if (short.endsWith('-agent')) short = short.slice(0, -'-agent'.length);
  if (short.startsWith('the-')) short = short.slice('the-'.length);
  return short;
}

const STALENESS_CYCLES = 2;

function isAccountTier(value: unknown): value is AccountConfidenceTier {
  return value === 'CONFIRMED-PKCE' ||
    value === 'CONFIRMED-CORRELATION' ||
    value === 'ASSERTED' ||
    value === 'UNVERIFIED';
}

function tierRank(tier: AccountConfidenceTier): number {
  switch (tier) {
    case 'CONFIRMED-PKCE': return 3;
    case 'CONFIRMED-CORRELATION': return 2;
    case 'ASSERTED': return 1;
    case 'UNVERIFIED': return 0;
  }
}

function weakestTier(a: AccountConfidenceTier, b: AccountConfidenceTier): AccountConfidenceTier {
  return tierRank(a) <= tierRank(b) ? a : b;
}

function parsePromotionCandidate(value: unknown): PromotionCandidate | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.cluster_id !== 'string' ||
    typeof raw.target_account !== 'string' ||
    typeof raw.seven_day_delta !== 'number' ||
    raw.no_other_cluster_guard !== 'pass'
  ) {
    return undefined;
  }
  return {
    cluster_id: raw.cluster_id,
    target_account: raw.target_account,
    seven_day_delta: raw.seven_day_delta,
    five_hour_pct: typeof raw.five_hour_pct === 'number' ? raw.five_hour_pct : null,
    spend_pct_or_extra_usage: typeof raw.spend_pct_or_extra_usage === 'number' ? raw.spend_pct_or_extra_usage : null,
    no_other_cluster_guard: 'pass',
  };
}

function parseIntervalMs(schedule: unknown): number | null {
  if (typeof schedule !== 'string') return null;
  const trimmed = schedule.trim();
  const interval = trimmed.match(/^(\d+)([smhd])$/);
  if (interval) {
    const value = Number(interval[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    switch (interval[2]) {
      case 's': return value * 1000;
      case 'm': return value * 60_000;
      case 'h': return value * 60 * 60_000;
      case 'd': return value * 24 * 60 * 60_000;
    }
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 5) {
    const minute = parts[0];
    const step = minute.match(/^\*\/(\d+)$/);
    if (step) {
      const value = Number(step[1]);
      return Number.isFinite(value) && value > 0 ? value * 60_000 : null;
    }
  }
  return null;
}

function readUsageSnapshotIntervalMs(): number | null {
  const stateDir = path.join(CTX_ROOT, 'state');
  if (!fs.existsSync(stateDir)) return null;
  try {
    for (const entry of fs.readdirSync(stateDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cronsPath = path.join(stateDir, entry.name, 'crons.json');
      if (!fs.existsSync(cronsPath)) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(cronsPath, 'utf-8'));
      } catch {
        continue;
      }
      const cronList = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object' && Array.isArray((raw as { crons?: unknown }).crons)
          ? (raw as { crons: unknown[] }).crons
          : [];
      for (const cron of cronList) {
        if (!cron || typeof cron !== 'object') continue;
        const record = cron as { name?: unknown; prompt?: unknown; schedule?: unknown; interval?: unknown };
        const mentionsUsage = record.name === 'check-all-usage' ||
          (typeof record.prompt === 'string' && record.prompt.includes('check-all-usage'));
        if (!mentionsUsage) continue;
        const parsed = parseIntervalMs(record.schedule ?? record.interval);
        if (parsed) return parsed;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function agentSource(entry: { source?: unknown; pkce_match?: unknown; tier?: unknown; override_note?: unknown }): string {
  if (entry.pkce_match === true) return 'pkce-confirmed';
  if (entry.tier === 'CONFIRMED-CORRELATION') return 'correlation-confirmed';
  if (typeof entry.override_note === 'string') return 'override';
  if (entry.source === 'login-marker') return 'login-marker';
  if (entry.source === 'runtime-excluded') return 'runtime-excluded';
  return 'cluster';
}

export function getAgentAccounts(): AgentAccounts | null {
  const file = path.join(CTX_ROOT, 'state', 'usage', 'agent-accounts.json');
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      generated_at?: unknown;
      snapshot_interval_ms?: unknown;
      promotion_candidates?: unknown[];
      agents?: Array<{
        agent?: unknown;
        account?: unknown;
        source?: unknown;
        tier?: unknown;
        cluster_id?: unknown;
        live_cluster_id?: unknown;
        env_cluster_id?: unknown;
        pending_restart?: unknown;
        pkce_match?: unknown;
        override_note?: unknown;
        promotion_candidate?: unknown;
      }>;
    };
    if (!Array.isArray(raw.agents)) return null;

    const byAccount: Record<string, string[]> = {};
    const unassigned: string[] = [];
    const codexAgents: string[] = [];
    const generatedAt = typeof raw.generated_at === 'string' ? raw.generated_at : undefined;
    const generatedMs = generatedAt ? new Date(generatedAt).getTime() : NaN;
    const snapshotIntervalMs = typeof raw.snapshot_interval_ms === 'number' && raw.snapshot_interval_ms > 0
      ? raw.snapshot_interval_ms
      : readUsageSnapshotIntervalMs();
    const stale = Number.isFinite(generatedMs) && snapshotIntervalMs !== null
      ? Date.now() - generatedMs > STALENESS_CYCLES * snapshotIntervalMs
      : false;
    const promotionCandidates = Array.isArray(raw.promotion_candidates)
      ? raw.promotion_candidates.map(parsePromotionCandidate).filter((c): c is PromotionCandidate => !!c)
      : [];
    const accounts: Record<string, AccountAttribution> = {};
    const agents: Record<string, AgentAccountAttribution> = {};

    for (const entry of raw.agents) {
      if (typeof entry.agent !== 'string') continue;
      const name = shortAgentName(entry.agent);
      const tier = isAccountTier(entry.tier) ? entry.tier : 'UNVERIFIED';
      const cluster_id = typeof entry.cluster_id === 'string'
        ? entry.cluster_id
        : typeof entry.live_cluster_id === 'string'
          ? entry.live_cluster_id
          : typeof entry.env_cluster_id === 'string'
            ? entry.env_cluster_id
            : null;
      const pending_restart = entry.pending_restart === true;
      const source = agentSource(entry);
      const attribution: AgentAccountAttribution = { agent: name, tier, source, cluster_id, pending_restart };
      agents[name] = attribution;
      if (typeof entry.account === 'string' && entry.account.length > 0) {
        if (!byAccount[entry.account]) byAccount[entry.account] = [];
        byAccount[entry.account].push(name);
        const existing = accounts[entry.account];
        const candidate = parsePromotionCandidate(entry.promotion_candidate) ??
          promotionCandidates.find((c) => c.target_account === entry.account);
        if (!existing) {
          accounts[entry.account] = {
            tier,
            verified_at: generatedAt,
            stale,
            pending_restart,
            source,
            ...(typeof entry.override_note === 'string' ? { note: entry.override_note } : {}),
            ...(candidate ? { promotion_candidate: candidate } : {}),
            agents: [attribution],
          };
        } else {
          existing.tier = weakestTier(existing.tier, tier);
          existing.pending_restart = existing.pending_restart || pending_restart;
          const existingClusters = new Set(existing.agents.map((agent) => agent.cluster_id).filter(Boolean));
          const clusterConflict = cluster_id !== null && existingClusters.size > 0 && !existingClusters.has(cluster_id);
          existing.source = existing.source === source && !clusterConflict ? source : 'conflicting-clusters';
          existing.note = existing.note ?? 'multiple clusters map to this account';
          if (!existing.promotion_candidate && candidate) existing.promotion_candidate = candidate;
          existing.agents.push(attribution);
        }
      } else if (entry.source === 'runtime-excluded') {
        codexAgents.push(name);
      } else {
        unassigned.push(name);
      }
    }
    for (const names of Object.values(byAccount)) names.sort();
    unassigned.sort();
    codexAgents.sort();
    for (const account of Object.values(accounts)) {
      account.agents.sort((a, b) => a.agent.localeCompare(b.agent));
    }
    return { byAccount, unassigned, codexAgents, generatedAt, stale, promotionCandidates, accounts, agents };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Codex (OpenAI ChatGPT plan) usage - read-only
// ---------------------------------------------------------------------------

export interface CodexUsagePanel {
  primary?: { used_pct: number; window_minutes: number; resets_at?: number };
  secondary?: { used_pct: number; window_minutes: number; resets_at?: number };
  plan_type?: string;
  rate_limit_reached?: boolean;
  as_of: string;
}

export interface CodexActivity {
  tokens: number;
  cost: number;
}

export function getCodexActivity(days: number = 7): CodexActivity {
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(total_tokens), 0) AS tokens,
        COALESCE(SUM(cost_usd), 0) AS cost
      FROM cost_entries
      WHERE source_file LIKE '%codex-tokens.jsonl'
        AND timestamp >= DATE('now', ?)
    `).get(`-${days} days`) as { tokens?: number | null; cost?: number | null } | undefined;

    return {
      tokens: row?.tokens ?? 0,
      cost: row?.cost ?? 0,
    };
  } catch {
    return { tokens: 0, cost: 0 };
  }
}

/**
 * Read the Codex usage snapshot written into the 15-min consolidated sync by
 * `cortextos bus check-all-usage` (which reads codex's own rollout files - no
 * token, no endpoint, no auth). Returns null until codex has been run with a
 * rate-limit reading. The value is last-seen (the panel wears the as-of time).
 */
export function getCodexUsage(): CodexUsagePanel | null {
  const file = path.join(CTX_ROOT, 'state', 'usage', 'codex-usage.json');
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
      codex?: {
        primary?: { used_percent: number; window_minutes: number; resets_at?: number };
        secondary?: { used_percent: number; window_minutes: number; resets_at?: number };
        plan_type?: string;
        rate_limit_reached?: boolean;
        as_of: string;
      };
    };
    const c = raw.codex;
    if (!c) return null;
    const win = (w?: { used_percent: number; window_minutes: number; resets_at?: number }) =>
      w ? { used_pct: Math.round(w.used_percent), window_minutes: w.window_minutes, resets_at: w.resets_at } : undefined;
    return {
      primary: win(c.primary),
      secondary: win(c.secondary),
      plan_type: c.plan_type,
      rate_limit_reached: c.rate_limit_reached,
      as_of: c.as_of,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Historical Plan Usage (time series from JSONL logs)
// ---------------------------------------------------------------------------

export interface UsageDataPoint {
  timestamp: string;
  session_pct: number;
  week_pct: number;
  sonnet_pct: number;
  five_hour_pct: number;
  seven_day_pct: number;
}

export function getUsageHistory(days: number = 7): UsageDataPoint[] {
  const usageDir = path.join(CTX_ROOT, 'state', 'usage');
  if (!fs.existsSync(usageDir)) return [];

  const points: UsageDataPoint[] = [];
  const now = new Date();

  for (let d = days - 1; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().split('T')[0];
    const file = path.join(usageDir, `${dateStr}.jsonl`);

    if (!fs.existsSync(file)) continue;

    try {
      const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line);
          points.push({
            timestamp: entry.timestamp,
            session_pct: entry.session?.used_pct ?? 0,
            week_pct: entry.week_all_models?.used_pct ?? 0,
            sonnet_pct: entry.week_sonnet?.used_pct ?? 0,
            five_hour_pct: entry.five_hour?.used_pct ?? 0,
            seven_day_pct: entry.seven_day?.used_pct ?? 0,
          });
        } catch { /* skip bad lines */ }
      }
    } catch { /* skip unreadable files */ }
  }

  return points;
}

// ---------------------------------------------------------------------------
// Cost Intelligence (Phase 3)
// ---------------------------------------------------------------------------

export function getCostIntelligence(org: string): CostIntelligence | null {
  const snapshot = getLatestSnapshot(org);
  if (!snapshot?.cost) return null;

  const costData = snapshot.cost as {
    agents?: Record<string, {
      total_tokens: number;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
      models?: Record<string, number>;
    }>;
  };

  if (!costData.agents) return null;

  const perAgent: AgentCostData[] = [];
  let fleetTokens = 0;
  let fleetCost = 0;

  for (const [agent, data] of Object.entries(costData.agents)) {
    fleetTokens += data.total_tokens || 0;
    fleetCost += data.cost_usd || 0;
    perAgent.push({
      agent,
      totalTokens: data.total_tokens || 0,
      inputTokens: data.input_tokens || 0,
      outputTokens: data.output_tokens || 0,
      costUsd: data.cost_usd || 0,
      models: data.models || {},
    });
  }

  return {
    fleetTokensToday: fleetTokens,
    fleetCostToday: fleetCost,
    perAgent: perAgent.sort((a, b) => b.totalTokens - a.totalTokens),
  };
}
