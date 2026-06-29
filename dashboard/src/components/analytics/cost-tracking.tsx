'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart } from '@/components/charts/area-chart';
import { BarChart } from '@/components/charts/bar-chart';
import { CHART_GOLD, MODEL_COLORS } from '@/components/charts/chart-theme';

interface UsageHistoryPoint {
  timestamp: string;
  session_pct: number;
  week_pct: number;
  sonnet_pct: number;
  five_hour_pct: number;
  seven_day_pct: number;
}

interface AgentUsage {
  agent: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

interface CostTrackingProps {
  dailyCosts: Array<{ date: string; cost: number }>;
  dailyCostByModel: Array<Record<string, unknown>>;
  currentMonthCost: number;
  projectedMonthly: number;
  usageHistory?: UsageHistoryPoint[];
  costByAgent?: AgentUsage[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function UsageBar({ pct, label, sublabel }: { pct: number; label: string; sublabel?: string }) {
  const color = pct < 50 ? 'bg-green-500' : pct < 80 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

export function CostTracking({
  dailyCosts,
  dailyCostByModel,
  currentMonthCost,
  projectedMonthly,
  usageHistory,
  costByAgent,
}: CostTrackingProps) {
  const modelKeys = Object.keys(MODEL_COLORS); // opus, sonnet, haiku
  const modelColorValues = modelKeys.map((k) => MODEL_COLORS[k]);

  const hasPlanData = !!(usageHistory && usageHistory.length > 0);
  const agentRows = (costByAgent ?? []).filter(a => a.tokens > 0);
  // Share-of-fleet: bars are a proportion of total agent token use (sum ~100%),
  // not scaled-to-the-biggest-agent (which made the top agent always look full).
  const fleetTokens = agentRows.reduce((s, a) => s + a.tokens, 0);
  const fleetApiCost = agentRows.reduce((s, a) => s + a.cost, 0);

  return (
    <div className="space-y-6">
      {/* Per-Agent Token Usage (last 7 days — matches the Max 7-day limit window) */}
      {agentRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Per-Agent Token Usage (Last 7 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Your Max plan is a flat subscription governed by the account-wide 5h/7d rate limits above —
              all agents share that budget. This shows <span className="font-medium">who is consuming it</span>
              {' '}(share of total agent tokens over the last 7 days).
            </p>
            <div className="space-y-3">
              {agentRows.map((a) => {
                const share = fleetTokens > 0 ? Math.round((a.tokens / fleetTokens) * 100) : 0;
                return (
                  <div key={a.agent} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{a.agent}</span>
                      <span className="tabular-nums">
                        <span className="font-medium">{share}%</span>
                        <span className="text-muted-foreground"> · {formatTokens(a.tokens)} tokens</span>
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${share}%`, backgroundColor: CHART_GOLD }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {formatTokens(a.inputTokens)} in · {formatTokens(a.outputTokens)} out
                    </p>
                  </div>
                );
              })}
            </div>
            {fleetApiCost > 0 && (
              <p className="text-[10px] text-muted-foreground mt-4 border-t pt-3">
                These tokens would cost ≈<span className="font-medium tabular-nums">${fleetApiCost.toFixed(2)}</span>
                {' '}at pay-per-token API list rates over the last 7 days — covered by your Max subscription, not billed.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Usage History Chart */}
      {usageHistory && usageHistory.length >= 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Usage Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Plan usage percentage over time. Weekly limit resets every Sunday.
            </p>
            <AreaChart
              data={usageHistory.map(p => {
                const d = new Date(p.timestamp);
                return {
                  date: `${d.getMonth()+1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
                  'Weekly %': p.week_pct,
                  'Session %': p.session_pct,
                };
              })}
              xKey="date"
              yKeys={['Weekly %', 'Session %']}
              colors={[CHART_GOLD, '#2563EB']}
              height={200}
              showLegend
            />
          </CardContent>
        </Card>
      ) : usageHistory && usageHistory.length === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Usage Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6 py-4">
              <div className="text-center">
                <p className="text-4xl font-bold tabular-nums" style={{ color: CHART_GOLD }}>{usageHistory[0].week_pct}%</p>
                <p className="text-xs text-muted-foreground mt-1">Weekly (All Models)</p>
              </div>
              <div className="text-center">
                <p className="text-4xl font-bold tabular-nums text-muted-foreground">{usageHistory[0].session_pct}%</p>
                <p className="text-xs text-muted-foreground mt-1">Current Session</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">Chart will appear after the next scrape</p>
          </CardContent>
        </Card>
      ) : null}

      {/* API Cost Tracking (secondary — for users on pay-per-token) */}
      {!hasPlanData && dailyCosts.length > 0 && (
        <>
          {currentMonthCost > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Month to Date</p>
                  <p className="text-2xl font-semibold mt-1">${currentMonthCost.toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Projected Monthly</p>
                  <p className="text-2xl font-semibold mt-1">${projectedMonthly.toFixed(2)}</p>
                </CardContent>
              </Card>
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                Daily API Cost
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AreaChart
                data={dailyCosts}
                xKey="date"
                yKeys={['cost']}
                colors={[CHART_GOLD]}
                height={200}
              />
            </CardContent>
          </Card>
          {dailyCostByModel.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  Cost by Model
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BarChart
                  data={dailyCostByModel}
                  xKey="date"
                  yKeys={modelKeys}
                  colors={modelColorValues}
                  stacked
                  showLegend
                  height={200}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
