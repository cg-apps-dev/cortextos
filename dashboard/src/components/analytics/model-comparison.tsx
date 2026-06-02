'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CHART_GOLD } from '@/components/charts/chart-theme';

interface ProviderUsage { tokens: number; cost: number }
interface AgentModelUsage { agent: string; claude: ProviderUsage; codex: ProviderUsage }
interface ModelUsageBreakdown {
  byAgent: AgentModelUsage[];
  fleet: { claude: ProviderUsage; codex: ProviderUsage };
}

const CLAUDE_COLOR = CHART_GOLD; // gold
const CODEX_COLOR = '#2563EB';   // blue

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Two-segment Claude|Codex bar (proportions of the row's total tokens). */
function SplitBar({ claude, codex }: { claude: number; codex: number }) {
  const total = claude + codex;
  const cPct = total > 0 ? (claude / total) * 100 : 100;
  const xPct = total > 0 ? (codex / total) * 100 : 0;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      <div style={{ width: `${cPct}%`, backgroundColor: CLAUDE_COLOR }} />
      <div style={{ width: `${xPct}%`, backgroundColor: CODEX_COLOR }} />
    </div>
  );
}

export function ModelComparison({ data }: { data?: ModelUsageBreakdown | null }) {
  if (!data) return null;
  const { fleet, byAgent } = data;
  const total = fleet.claude.tokens + fleet.codex.tokens;
  if (total === 0) return null;

  const claudePct = Math.round((fleet.claude.tokens / total) * 100);
  const codexPct = 100 - claudePct;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Claude vs Codex Usage (Last 7 Days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CLAUDE_COLOR }} />
            Claude
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: CODEX_COLOR }} />
            Codex
          </span>
          <span className="ml-auto text-muted-foreground">token usage by model</span>
        </div>

        {/* Fleet-wide split */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Fleet total</span>
            <span className="tabular-nums text-muted-foreground">
              <span style={{ color: CLAUDE_COLOR }}>{fmt(fleet.claude.tokens)}</span> ({claudePct}%)
              {' · '}
              <span style={{ color: CODEX_COLOR }}>{fmt(fleet.codex.tokens)}</span> ({codexPct}%)
            </span>
          </div>
          <SplitBar claude={fleet.claude.tokens} codex={fleet.codex.tokens} />
        </div>

        {/* Per-agent split */}
        <div className="mt-5 space-y-3 border-t pt-4">
          {byAgent.map((a) => (
            <div key={a.agent} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{a.agent}</span>
                <span className="tabular-nums text-[11px] text-muted-foreground">
                  <span style={{ color: CLAUDE_COLOR }}>{fmt(a.claude.tokens)}</span>
                  {' · '}
                  <span style={{ color: CODEX_COLOR }}>{fmt(a.codex.tokens)} codex</span>
                </span>
              </div>
              <SplitBar claude={a.claude.tokens} codex={a.codex.tokens} />
            </div>
          ))}
        </div>

        <p className="mt-4 text-[10px] text-muted-foreground">
          Tokens by model provider (Claude vs OpenAI Codex). Codex usage comes from
          the codex peer tool; counted alongside Claude per agent.
        </p>
      </CardContent>
    </Card>
  );
}
