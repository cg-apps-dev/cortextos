import { Fragment } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { AgentAccountMatrixGroup, AccountConfidenceTier } from '@/lib/data/reports';

function formatUsd(cost: number | undefined): string {
  if (typeof cost !== 'number') return '-';
  return cost.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function TierBadge({ tier }: { tier: AccountConfidenceTier }) {
  return (
    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${tierTone(tier)}`}>
      {tier}
    </span>
  );
}

export function AgentAccountMatrix({
  groups,
  org,
}: {
  groups: AgentAccountMatrixGroup[];
  org?: string;
}) {
  const rowCount = groups.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Agent Account Matrix
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {org ? `Org: ${org}` : 'All orgs'} - {rowCount} agents
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {groups.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Pending restart</TableHead>
                <TableHead className="text-right">24h burn</TableHead>
                <TableHead className="text-right">7d burn</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <Fragment key={group.key}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={2} className="font-medium">
                      {group.label}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {group.source ?? group.section}
                    </TableCell>
                    <TableCell>
                      {group.tier ? <TierBadge tier={group.tier} /> : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {group.pendingRestartCount > 0 ? `${group.pendingRestartCount} pending` : 'none'}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatUsd(group.burn?.last24hUsd)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatUsd(group.burn?.last7dUsd)}
                    </TableCell>
                  </TableRow>
                  {group.rows.map((row) => (
                    <TableRow key={`${group.key}:${row.agent}`}>
                      <TableCell className="font-medium">{row.agent}</TableCell>
                      <TableCell className="text-muted-foreground">{row.account ?? group.label}</TableCell>
                      <TableCell>{row.source}</TableCell>
                      <TableCell><TierBadge tier={row.tier} /></TableCell>
                      <TableCell>
                        {row.pending_restart ? (
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            pending
                          </span>
                        ) : (
                          <span className="text-muted-foreground">none</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {row.section === 'account' ? 'account total' : '-'}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {row.section === 'account' ? 'account total' : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="py-8 text-center">
            <p className="text-sm font-medium">No account assignments available</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The live resolver has not reported any rows for this scope.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
