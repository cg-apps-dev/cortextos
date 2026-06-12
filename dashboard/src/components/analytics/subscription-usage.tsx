import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AccountUsagePanelEntry, AgentAccounts, CodexUsagePanel } from '@/lib/data/reports';
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

function UsageRow({ label, pct, resets }: { label: string; pct?: number; resets?: string }) {
  const value = typeof pct === 'number' ? pct : null;
  const barColor = value === null ? 'bg-muted' : value >= 80 ? 'bg-red-500' : value >= 60 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value === null ? '-' : `${value}%`}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
      </div>
      {resets && <ResetCountdown resets={resets} fallback={`Resets ${ptTime(resets)}`} />}
    </div>
  );
}

function ExtraUsage({ extra }: { extra: NonNullable<AccountUsagePanelEntry['extra_usage']> }) {
  const usd = extra.used_usd.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const capPct = extra.cap_usd ? Math.round((extra.used_usd / extra.cap_usd) * 100) : null;
  return (
    <div className="rounded-md border border-border/60 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">Extra usage</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            extra.is_enabled ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400' : 'bg-muted text-muted-foreground'
          }`}
        >
          {extra.is_enabled ? 'ENABLED' : 'OFF'}
        </span>
      </div>
      {extra.is_enabled && (
        <div className="flex items-baseline justify-between">
          <span className="tabular-nums font-medium">{usd}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {extra.used_credits.toLocaleString()} credits
            {extra.cap_usd ? ` · ${capPct}% of ${extra.cap_usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

function AgentChips({ agents, warning = false }: { agents?: string[]; warning?: boolean }) {
  if (!agents || agents.length === 0) return null;
  const tone = warning
    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
    : 'bg-muted text-muted-foreground';
  return (
    <div className="flex flex-wrap gap-1">
      {agents.map((agent) => (
        <span key={agent} className={`rounded px-1.5 py-0.5 text-[10px] ${tone}`}>
          {agent}
        </span>
      ))}
    </div>
  );
}

function AccountCard({ entry, agents }: { entry: AccountUsagePanelEntry; agents?: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">{entry.email}</p>
        <p className="text-xs text-muted-foreground">{entry.plan}</p>
      </div>
      {entry.ok ? (
        <div className="space-y-3">
          <UsageRow label="5-Hour Session" pct={entry.five_hour_pct} resets={entry.five_hour_resets} />
          <UsageRow label="7-Day Weekly" pct={entry.seven_day_pct} resets={entry.seven_day_resets} />
          {entry.extra_usage && <ExtraUsage extra={entry.extra_usage} />}
        </div>
      ) : (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Unavailable{entry.error ? ` (${entry.error})` : ''}
        </p>
      )}
      <AgentChips agents={agents} />
    </div>
  );
}

/** Codex (OpenAI ChatGPT plan) usage card - read-only, last-seen, as-of stamped. */
function CodexCard({ codex }: { codex: CodexUsagePanel }) {
  const plan = codex.plan_type ? codex.plan_type.charAt(0).toUpperCase() + codex.plan_type.slice(1) : 'ChatGPT';
  const resetIso = (s?: number) => (s ? new Date(s * 1000).toISOString() : undefined);
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold">Codex (OpenAI)</p>
        <p className="text-xs text-muted-foreground">{plan} Plan</p>
      </div>
      <div className="space-y-3">
        <UsageRow label="5-Hour" pct={codex.primary?.used_pct} resets={resetIso(codex.primary?.resets_at)} />
        <UsageRow label="Weekly" pct={codex.secondary?.used_pct} resets={resetIso(codex.secondary?.resets_at)} />
        {codex.rate_limit_reached && (
          <p className="text-xs text-red-600 dark:text-red-400">Rate limit reached</p>
        )}
        <p className="text-[10px] text-muted-foreground">as of {ptTime(codex.as_of)} (last Codex run)</p>
      </div>
    </div>
  );
}

export function SubscriptionUsage({
  data,
  codex,
  agentAccounts,
}: {
  data: { generatedAt: string; accounts: AccountUsagePanelEntry[] } | null;
  codex?: CodexUsagePanel | null;
  agentAccounts?: AgentAccounts | null;
}) {
  const unassigned = agentAccounts?.unassigned ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Subscription Usage
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(data && data.accounts.length > 0) || codex ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {data?.accounts.map((a) => (
                <AccountCard key={a.account} entry={a} agents={agentAccounts?.byAccount[a.account]} />
              ))}
              {codex && <CodexCard codex={codex} />}
            </div>
            {unassigned.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                <span>unassigned:</span>
                <AgentChips agents={unassigned} warning />
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              {data ? `Claude updated ${ptTime(data.generatedAt)} · ` : ''}refreshes every 5 min
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
