export type Tier = 'CONFIRMED-PKCE' | 'CONFIRMED-CORRELATION' | 'ASSERTED' | 'UNVERIFIED';

export interface AgentClusterRow {
  agent: string;
  account: string | null;
  cluster_id: string | null;
  pkce_match: boolean;
  source: string | null;
}

export interface TierOverride {
  tier?: Tier;
  billing_account?: string;
  note?: string;
  set_at?: string;
}

export type OverrideMap = Record<string, TierOverride>;

export interface PromotionCandidate {
  cluster_id: string;
  target_account: string;
  seven_day_delta: number;
  five_hour_pct: number | null;
  spend_pct_or_extra_usage: number | null;
  no_other_cluster_guard: 'pass';
}

export type CandidateMap = Record<string, PromotionCandidate>;

export interface TierResult {
  agent: string;
  account: string | null;
  tier: Tier;
  cluster_id: string | null;
  cluster_size: number;
  label_consistent: boolean;
  override?: TierOverride;
  promotion_candidate?: PromotionCandidate;
}

export interface PromotionUsageRow {
  account: string;
  seven_day_pct?: number;
  five_hour_pct?: number;
  spend_pct?: number;
  extra_usage?: { used_credits?: number };
}

function tierRank(tier: Tier): number {
  switch (tier) {
    case 'CONFIRMED-PKCE': return 3;
    case 'CONFIRMED-CORRELATION': return 2;
    case 'ASSERTED': return 1;
    case 'UNVERIFIED': return 0;
  }
}

export function weakerTier(a: Tier, b: Tier): Tier {
  return tierRank(a) <= tierRank(b) ? a : b;
}

export function degradeTier(tier: Tier): Tier {
  switch (tier) {
    case 'CONFIRMED-PKCE': return 'CONFIRMED-CORRELATION';
    case 'CONFIRMED-CORRELATION': return 'ASSERTED';
    case 'ASSERTED': return 'UNVERIFIED';
    case 'UNVERIFIED': return 'UNVERIFIED';
  }
}

function labelsConsistent(rows: AgentClusterRow[]): boolean {
  const labels = rows
    .map((row) => row.account)
    .filter((account): account is string => typeof account === 'string' && account.length > 0);
  return new Set(labels).size <= 1;
}

function resolveOverride(row: AgentClusterRow, overrides: OverrideMap): TierOverride | undefined {
  return overrides[row.agent];
}

export function deriveTiers(
  rows: AgentClusterRow[],
  overrides: OverrideMap = {},
  candidates: CandidateMap = {},
): TierResult[] {
  const grouped = new Map<string, AgentClusterRow[]>();
  for (const row of rows) {
    if (!row.cluster_id) continue;
    const group = grouped.get(row.cluster_id) ?? [];
    group.push(row);
    grouped.set(row.cluster_id, group);
  }

  return rows.map((row) => {
    const clusterRows = row.cluster_id ? (grouped.get(row.cluster_id) ?? [row]) : [row];
    const label_consistent = labelsConsistent(clusterRows);
    const cluster_size = row.cluster_id ? clusterRows.length : 1;
    const clusterPkce = row.cluster_id ? clusterRows.some((candidate) => candidate.pkce_match) : row.pkce_match;
    const override = resolveOverride(row, overrides);
    let tier: Tier;

    if (override?.tier) {
      tier = override.tier;
    } else if (clusterPkce) {
      tier = 'CONFIRMED-PKCE';
    } else if (row.source === 'login-marker') {
      tier = 'UNVERIFIED';
    } else if (row.cluster_id && cluster_size >= 2 && label_consistent) {
      tier = 'ASSERTED';
    } else {
      tier = 'UNVERIFIED';
    }

    return {
      agent: row.agent,
      account: override?.billing_account ?? row.account,
      tier,
      cluster_id: row.cluster_id,
      cluster_size,
      label_consistent,
      ...(override ? { override } : {}),
      ...(row.cluster_id && candidates[row.cluster_id] ? { promotion_candidate: candidates[row.cluster_id] } : {}),
    };
  });
}

export function computePromotionCandidates(
  rows: AgentClusterRow[],
  currentUsage: PromotionUsageRow[],
  priorUsage: PromotionUsageRow[],
): PromotionCandidate[] {
  const tierResults = deriveTiers(rows);
  const byCluster = new Map<string, TierResult[]>();
  for (const result of tierResults) {
    if (!result.cluster_id) continue;
    const group = byCluster.get(result.cluster_id) ?? [];
    group.push(result);
    byCluster.set(result.cluster_id, group);
  }

  const clustersByAccount = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.cluster_id || !row.account) continue;
    const clusters = clustersByAccount.get(row.account) ?? new Set<string>();
    clusters.add(row.cluster_id);
    clustersByAccount.set(row.account, clusters);
  }

  const currentByAccount = new Map(currentUsage.map((row) => [row.account, row]));
  const priorByAccount = new Map(priorUsage.map((row) => [row.account, row]));
  const candidates: PromotionCandidate[] = [];

  for (const [clusterId, results] of byCluster) {
    if (!results.every((result) => result.tier === 'ASSERTED')) continue;
    const labels = Array.from(new Set(results.map((result) => result.account).filter((account): account is string => !!account)));
    if (labels.length !== 1) continue;
    const targetAccount = labels[0];
    if ((clustersByAccount.get(targetAccount)?.size ?? 0) !== 1) continue;

    const current = currentByAccount.get(targetAccount);
    const prior = priorByAccount.get(targetAccount);
    const currentSeven = current?.seven_day_pct;
    const priorSeven = prior?.seven_day_pct ?? 0;
    if (typeof currentSeven !== 'number') continue;
    const seven_day_delta = currentSeven - priorSeven;
    if (priorSeven > 0.5 || seven_day_delta <= 0) continue;

    candidates.push({
      cluster_id: clusterId,
      target_account: targetAccount,
      seven_day_delta,
      five_hour_pct: typeof current?.five_hour_pct === 'number' ? current.five_hour_pct : null,
      spend_pct_or_extra_usage: typeof current?.spend_pct === 'number'
        ? current.spend_pct
        : typeof current?.extra_usage?.used_credits === 'number'
        ? current.extra_usage.used_credits
        : null,
      no_other_cluster_guard: 'pass',
    });
  }

  return candidates;
}
