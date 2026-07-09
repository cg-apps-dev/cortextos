import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  AccountAttribution,
  AccountConfidenceTier,
  AccountUsagePanelEntry,
  AgentAccountAttribution,
  AgentAccounts,
  CodexActivity,
  CodexUsagePanel,
} from '@/lib/data/reports';
import { ResetCountdown } from './reset-countdown';

/** Render an ISO timestamp in Pacific time (fleet rule: humans see PT). */
function ptTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return (
    d.toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' PT'
  );
}

function isPanelStale(generatedAt: string | undefined): boolean {
  if (!generatedAt) return false;
  const generated = new Date(generatedAt).getTime();
  if (isNaN(generated)) return false;
  return Date.now() - generated > 15 * 60 * 1000;
}

function ageLabel(ageMs: number | undefined): string | null {
  if (typeof ageMs !== 'number' || !Number.isFinite(ageMs)) return null;
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) return `${minutes} min old`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h old` : `${hours}h ${rem}m old`;
}

function durationLabel(durationMs: number | undefined): string | null {
  const label = ageLabel(durationMs);
  return label ? label.replace(/ old$/, '') : null;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toLocaleString('en-US');
}

function formatUsd(cost: number): string {
  return cost.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function degradeTier(tier: AccountConfidenceTier): AccountConfidenceTier {
  // Keep in sync with src/bus/account-tiers.ts degradeTier.
  switch (tier) {
    case 'CONFIRMED-PKCE':
      return 'CONFIRMED-CORRELATION';
    case 'CONFIRMED-CORRELATION':
      return 'ASSERTED';
    case 'ASSERTED':
      return 'UNVERIFIED';
    case 'UNVERIFIED':
      return 'UNVERIFIED';
  }
}

function tierTone(tier: AccountConfidenceTier): string {
  switch (tier) {
    case 'CONFIRMED-PKCE':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    case 'CONFIRMED-CORRELATION':
      return 'bg-teal-500/15 text-teal-600 dark:text-teal-400';
    case 'ASSERTED':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    case 'UNVERIFIED':
      return 'bg-muted text-muted-foreground';
  }
}

function TierBadge({ tier, stale }: { tier: AccountConfidenceTier; stale?: boolean }) {
  const visibleTier = stale ? degradeTier(tier) : tier;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tierTone(visibleTier)}`}>
      {visibleTier}
    </span>
  );
}

type UsageMetricKey = 'five_hour' | 'seven_day';

type ResolvedUsageValue = {
  value?: number;
  resets?: string;
  stale: boolean;
  staleAsOf?: string;
};

type ResolvedScopedLimit = NonNullable<AccountUsagePanelEntry['scoped_limits']>[number] & {
  stale: boolean;
  staleAsOf?: string;
};

function resolveUsageValue(entry: AccountUsagePanelEntry, metric: UsageMetricKey): ResolvedUsageValue {
  if (entry.status !== 'ok' && entry.status !== 'stale') return { stale: false };
  const currentPct = metric === 'five_hour' ? entry.five_hour_pct : entry.seven_day_pct;
  const currentResets = metric === 'five_hour' ? entry.five_hour_resets : entry.seven_day_resets;
  if (typeof currentPct === 'number') {
    return {
      value: currentPct,
      resets: currentResets,
      stale: entry.status === 'stale',
      staleAsOf: entry.status === 'stale' ? entry.fetched_at : undefined,
    };
  }

  const lastGoodPct = metric === 'five_hour' ? entry.last_good?.five_hour_pct : entry.last_good?.seven_day_pct;
  const lastGoodResets = metric === 'five_hour' ? entry.last_good?.five_hour_resets : entry.last_good?.seven_day_resets;
  if (typeof lastGoodPct === 'number') {
    return {
      value: lastGoodPct,
      resets: lastGoodResets,
      stale: true,
      staleAsOf: entry.last_good?.fetched_at,
    };
  }

  return { stale: false };
}

function resolveScopedLimits(entry: AccountUsagePanelEntry): ResolvedScopedLimit[] {
  if (entry.status !== 'ok' && entry.status !== 'stale') return [];
  if (entry.scoped_limits && entry.scoped_limits.length > 0) {
    return entry.scoped_limits.map((limit) => ({
      ...limit,
      stale: entry.status === 'stale',
      staleAsOf: entry.status === 'stale' ? entry.fetched_at : undefined,
    }));
  }
  return (entry.last_good?.scoped_limits ?? []).map((limit) => ({
    ...limit,
    stale: true,
    staleAsOf: entry.last_good?.fetched_at,
  }));
}

function UsageRow({ label, usage, note }: { label: string; usage: ResolvedUsageValue; note?: string }) {
  const hasValue = typeof usage.value === 'number';
  const value = usage.value;
  const barColor = !hasValue
    ? 'bg-muted'
    : usage.stale
      ? 'bg-muted-foreground/40'
      : value! >= 80
        ? 'bg-red-500'
        : value! >= 60
          ? 'bg-amber-500'
          : 'bg-emerald-500';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium tabular-nums ${usage.stale ? 'text-muted-foreground' : ''}`}>
          {hasValue ? `${value}%` : '-'}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
      </div>
      {usage.stale && (
        <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          stale - as of {ptTime(usage.staleAsOf)}
        </span>
      )}
      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
      {usage.resets && <ResetCountdown resets={usage.resets} fallback={`Resets ${ptTime(usage.resets)}`} />}
    </div>
  );
}

function ScopedLimitRow({ limit }: { limit: ResolvedScopedLimit }) {
  const barColor = limit.stale
    ? 'bg-muted-foreground/40'
    : limit.severity === 'critical'
      ? 'bg-red-500'
      : limit.severity === 'warning'
        ? 'bg-amber-500'
        : 'bg-muted-foreground/50';
  const badgeTone = limit.stale
    ? 'bg-muted text-muted-foreground'
    : limit.severity === 'critical'
      ? 'bg-red-500/15 text-red-600 dark:text-red-400'
      : limit.severity === 'warning'
        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
        : 'bg-muted text-muted-foreground';
  const label = limit.model === 'Fable' ? 'Fable weekly limit' : `${limit.model} weekly limit`;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeTone}`}>
            {limit.severity}
          </span>
          <span className={`font-medium tabular-nums ${limit.stale ? 'text-muted-foreground' : ''}`}>
            {limit.percent}%
          </span>
        </div>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, limit.percent))}%` }} />
      </div>
      {limit.stale && (
        <span className="inline-flex rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          stale - as of {ptTime(limit.staleAsOf)}
        </span>
      )}
      {limit.resets_at && <ResetCountdown resets={limit.resets_at} fallback={`Resets ${ptTime(limit.resets_at)}`} />}
    </div>
  );
}

function ExtraUsage({ extra }: { extra: NonNullable<AccountUsagePanelEntry['extra_usage']> }) {
  const usd = extra.used_usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const capPct = extra.cap_usd ? Math.round((extra.used_usd / extra.cap_usd) * 100) : null;
  return (
    <div className="rounded-md border border-border/60 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">Real burn (extra usage)</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            extra.is_enabled ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400' : 'bg-muted text-muted-foreground'
          }`}
        >
          {extra.is_enabled ? 'ENABLED' : 'OFF'}
        </span>
      </div>
      {extra.is_enabled && (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between">
            <span className="tabular-nums font-semibold">{usd}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {extra.used_credits.toLocaleString()} credits
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>authoritative metered burn</span>
            {extra.cap_usd && (
              <span className="tabular-nums">
                {capPct}% of {extra.cap_usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentChips({
  agents,
  details,
  warning = false,
}: {
  agents?: string[];
  details?: AgentAccountAttribution[];
  warning?: boolean;
}) {
  const names = details?.map((agent) => agent.agent) ?? agents;
  if (!names || names.length === 0) return null;
  const tone = warning
    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    : 'bg-muted text-muted-foreground';
  return (
    <div className="flex flex-wrap gap-1">
      {names.map((agent) => {
        const detail = details?.find((entry) => entry.agent === agent);
        return (
        <span key={agent} className={`rounded px-1.5 py-0.5 text-[10px] ${detail?.pending_restart ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : tone}`}>
          {agent}{detail?.pending_restart ? ' - flip pending restart' : ''}
        </span>
        );
      })}
    </div>
  );
}

function AccountAttributionBlock({ attribution }: { attribution?: AccountAttribution }) {
  if (!attribution) return null;
  const burn = attribution.burn;
  return (
    <div className="rounded-md border border-border/60 px-3 py-2 text-xs space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-muted-foreground">Attribution</span>
        <TierBadge tier={attribution.tier} stale={attribution.stale} />
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
        <span>verified {ptTime(attribution.verified_at)}</span>
        <span>source: {attribution.source}</span>
      </div>
      {attribution.stale && (
        <span className="inline-flex rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
          STALE - map as of {ptTime(attribution.verified_at)}, source: reconciler+security
        </span>
      )}
      {attribution.pending_restart && (
        <span className="inline-flex rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
          flip pending restart
        </span>
      )}
      {burn && (
        <div className="grid grid-cols-2 gap-2 rounded bg-muted px-2 py-1 text-[10px]">
          <span className="text-muted-foreground">24h burn <b className="text-foreground">{formatUsd(burn.last24hUsd)}</b></span>
          <span className="text-muted-foreground">7d burn <b className="text-foreground">{formatUsd(burn.last7dUsd)}</b></span>
        </div>
      )}
      {attribution.promotion_candidate && attribution.tier === 'ASSERTED' && (
        <div className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground">promotion candidate (pending security)</span>
          <span className="block">
            7d +{attribution.promotion_candidate.seven_day_delta}; 5h {attribution.promotion_candidate.five_hour_pct ?? '-'}; spend {attribution.promotion_candidate.spend_pct_or_extra_usage ?? '-'}
          </span>
        </div>
      )}
      {attribution.note && <p className="text-[10px] text-muted-foreground">{attribution.note}</p>}
      <AgentChips details={attribution.agents} />
    </div>
  );
}

function statusLabel(status: AccountUsagePanelEntry['status']): string {
  switch (status) {
    case 'suspect': return 'SUSPECT';
    case 'impossible-read': return 'IMPOSSIBLE READ';
    case 'fetch-fail': return 'UNREACHABLE';
    case 'stale': return 'STALE';
    case 'ok': return 'OK';
  }
}

function AccountStatusNotice({ entry }: { entry: AccountUsagePanelEntry }) {
  if (entry.status === 'ok') return null;
  const tone = entry.status === 'suspect' || entry.status === 'impossible-read'
    ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    : 'border-border/60 bg-muted text-muted-foreground';
  const reason = entry.suspectReason ?? entry.error;
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${tone}`}>
      <p className="font-medium">{statusLabel(entry.status)}</p>
      {reason && <p className="mt-0.5 text-[10px]">{reason}</p>}
      {entry.freshness?.asOf && (
        <p className="mt-0.5 text-[10px]">as of {ptTime(entry.freshness.asOf)}</p>
      )}
    </div>
  );
}

function AccountCard({ entry, attribution }: { entry: AccountUsagePanelEntry; attribution?: AccountAttribution }) {
  const fiveHour = resolveUsageValue(entry, 'five_hour');
  const sevenDay = resolveUsageValue(entry, 'seven_day');
  const scopedLimits = resolveScopedLimits(entry);
  const hasUsageValue = typeof fiveHour.value === 'number' || typeof sevenDay.value === 'number' || scopedLimits.length > 0;
  const showUsageMetrics = (entry.status === 'ok' || entry.status === 'stale') && hasUsageValue;
  const showUnavailable = entry.status === 'ok' && !hasUsageValue;
  const isMetered = entry.extra_usage?.is_enabled;
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">{entry.email}</p>
        <p className="text-xs text-muted-foreground">{entry.plan}</p>
      </div>
      <AccountAttributionBlock attribution={attribution} />
      <AccountStatusNotice entry={entry} />
      {showUsageMetrics ? (
        <div className="space-y-3">
          <UsageRow label="5-Hour Session" usage={fiveHour} />
          <UsageRow
            label={isMetered ? '7-Day Weekly (subscription window)' : '7-Day Weekly'}
            usage={sevenDay}
            note={isMetered ? 'subscription window only - under-reads overage burn' : undefined}
          />
          {scopedLimits.map((limit) => (
            <ScopedLimitRow key={limit.model} limit={limit} />
          ))}
          {entry.extra_usage && <ExtraUsage extra={entry.extra_usage} />}
        </div>
      ) : showUnavailable ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Unavailable{entry.error ? ` (${entry.error})` : ''}
        </p>
      ) : null}
    </div>
  );
}

/** Codex (OpenAI ChatGPT plan) usage card - read-only, last-seen, as-of stamped. */
function CodexCard({
  codex,
  codexActivity,
  agents,
}: {
  codex: CodexUsagePanel;
  codexActivity?: CodexActivity | null;
  agents?: string[];
}) {
  const plan = codex.plan_type ? codex.plan_type.charAt(0).toUpperCase() + codex.plan_type.slice(1) : 'ChatGPT';
  const resetIso = (s?: number) => (s ? new Date(s * 1000).toISOString() : undefined);
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">Codex (OpenAI)</p>
        <p className="text-xs text-muted-foreground">{plan} Plan</p>
      </div>
      {codexActivity && (
        <div className="rounded-md border border-border/60 px-3 py-2">
          <p className="text-sm font-semibold tabular-nums">
            {formatTokens(codexActivity.tokens)} tokens / {formatUsd(codexActivity.cost)}
          </p>
          <p className="text-[10px] text-muted-foreground">
            Codex work, last 7 days (notional list-rate $)
          </p>
        </div>
      )}
      <div className="space-y-3">
        <div className="space-y-0.5">
          <p className="text-xs font-medium text-muted-foreground">Rate-limit headroom</p>
          <p className="text-[10px] text-muted-foreground">not total usage</p>
        </div>
        <UsageRow
          label="5-Hour limit"
          usage={{ value: codex.primary?.used_pct, resets: resetIso(codex.primary?.resets_at), stale: false }}
        />
        <UsageRow
          label="Weekly limit"
          usage={{ value: codex.secondary?.used_pct, resets: resetIso(codex.secondary?.resets_at), stale: false }}
        />
        {codex.rate_limit_reached && (
          <p className="text-xs text-red-600 dark:text-red-400">Rate limit reached</p>
        )}
        <p className="text-[10px] text-muted-foreground">as of {ptTime(codex.as_of)} (last Codex run)</p>
      </div>
      <AgentChips agents={agents} />
    </div>
  );
}

export function SubscriptionUsage({
  data,
  codex,
  codexActivity,
  agentAccounts,
  suppressPanelStatus = false,
}: {
  data: {
    generatedAt: string;
    accounts: AccountUsagePanelEntry[];
    stale?: boolean;
    staleAfterMs?: number;
    newestFetchedAt?: string;
    newestFetchedAgeMs?: number;
  } | null;
  codex?: CodexUsagePanel | null;
  codexActivity?: CodexActivity | null;
  agentAccounts?: AgentAccounts | null;
  suppressPanelStatus?: boolean;
}) {
  const unassigned = agentAccounts?.unassigned ?? [];
  const panelStale = data?.stale ?? isPanelStale(data?.generatedAt);
  const newestAge = ageLabel(data?.newestFetchedAgeMs);
  const staleAfter = durationLabel(data?.staleAfterMs);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Subscription Usage
          </CardTitle>
          {panelStale && !suppressPanelStatus && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              data stale
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {(data && data.accounts.length > 0) || codex ? (
          <div className="space-y-3">
            {agentAccounts?.overrideUnreadable && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Security override layer unreadable - tiers are mechanical-only, judgments not applied.
              </div>
            )}
            {agentAccounts && !agentAccounts.live && !suppressPanelStatus && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                Snapshot fallback - live account resolver unreachable. Running-state map as of {ptTime(agentAccounts.runningStateGeneratedAt ?? agentAccounts.generatedAt)}.
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data?.accounts.map((a) => (
                <AccountCard key={a.account} entry={a} attribution={agentAccounts?.accounts[a.account]} />
              ))}
              {codex && <CodexCard codex={codex} codexActivity={codexActivity} agents={agentAccounts?.codexAgents} />}
            </div>
            {unassigned.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                <span>unassigned:</span>
                <AgentChips agents={unassigned} warning />
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              {data ? `Claude usage as of ${ptTime(data.newestFetchedAt ?? data.generatedAt)}${newestAge ? ` (${newestAge})` : ''}` : ''}
              {data && staleAfter ? ` · stale after ${staleAfter}` : ''}
            </p>
            <p className="text-[10px] text-muted-foreground">
              CONFIRMED-PKCE requires an agent running a PKCE access_token as runtime; the fleet runs setup-tokens, so 0 is expected. Tiers: PKCE-proof &gt; correlation &gt; asserted (cluster-consistent) &gt; unverified.
            </p>
          </div>
        ) : (
          <div className="py-6 text-center space-y-2">
            <p className="text-sm font-medium">Subscription usage not yet available</p>
            <p className="text-xs text-muted-foreground">
              Per-account 5-hour, 7-day, and extra-usage appear here once the monitor runs.
            </p>
            <code className="text-xs bg-muted px-2 py-1 rounded block w-fit mx-auto mt-2">
              cortextos bus check-all-usage
            </code>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
