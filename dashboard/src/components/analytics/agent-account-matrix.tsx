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
import type { SwitchJobSummary, VaultAccountOption } from '@/lib/account-switch';
import { AccountSwitchControl } from './account-switch-control';

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
  vaultAccounts,
  switchJobsByAgent,
}: {
  groups: AgentAccountMatrixGroup[];
  org?: string;
  vaultAccounts?: VaultAccountOption[] | null;
  switchJobsByAgent?: Record<string, SwitchJobSummary>;
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
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Pending restart</TableHead>
                  <TableHead>Switch</TableHead>
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
                      <TableCell />
                    </TableRow>
                    {group.rows.map((row) => (
                      <TableRow key={`${group.key}:${row.agentId}`}>
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
                        <TableCell>
                          {row.section === 'account' ? (
                            <div className="flex min-w-56 flex-col gap-2">
                              <SwitchBreadcrumb job={switchJobsByAgent?.[row.agentId]} />
                              <AccountSwitchControl
                                agent={row.agent}
                                agentId={row.agentId}
                                currentAccount={row.account}
                                targets={vaultAccounts ?? null}
                                initialJob={switchJobsByAgent?.[row.agentId] ?? null}
                              />
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </>
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

function SwitchBreadcrumb({ job }: { job?: SwitchJobSummary | null }) {
  const text = switchBreadcrumbText(job);
  if (!job || !text) return null;
  if (job.status === 'running') {
    return (
      <p className="text-xs text-muted-foreground">
        {text}
      </p>
    );
  }
  if (job.status === 'succeeded') {
    return (
      <p className="text-xs text-emerald-600 dark:text-emerald-400">
        {text}
      </p>
    );
  }
  if (job.status === 'suspect') {
    return (
      <p className="text-xs text-amber-700 dark:text-amber-300">
        {text}
      </p>
    );
  }
  return (
    <p className="text-xs text-destructive">
      {text}
    </p>
  );
}

export function switchBreadcrumbText(job?: SwitchJobSummary | null): string | null {
  if (!job) return null;
  if (job.status === 'running') return `Switching to ${job.targetAccount} (${durationLabel(job.elapsedMs)})`;
  if (job.status === 'succeeded') return `Switched to ${job.targetAccount}`;
  if (job.status === 'suspect') return `Attribution NOT confirmed - ${job.targetAccount}? investigate`;
  return job.resultSummary ?? job.error ?? job.status;
}

function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}
