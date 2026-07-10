import { Fragment, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AgentAccountMatrixGroup, AccountConfidenceTier } from '@/lib/data/reports';
import type { SwitchJobSummary, VaultAccountOption } from '@/lib/account-switch';
import type { SwitchQueueStatus, QueueEntryRecord } from '@/lib/account-switch-queue';
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

function PendingBadge({ pending }: { pending: boolean }) {
  return pending ? (
    <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
      pending
    </span>
  ) : (
    <span className="text-muted-foreground">none</span>
  );
}

function MatrixField({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 space-y-1 ${className}`}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground md:hidden">
        {label}
      </div>
      <div className="min-w-0 text-sm md:text-xs">
        {children}
      </div>
    </div>
  );
}

export function AgentAccountMatrix({
  groups,
  org,
  vaultAccounts,
  switchJobsByAgent,
  switchQueue,
}: {
  groups: AgentAccountMatrixGroup[];
  org?: string;
  vaultAccounts?: VaultAccountOption[] | null;
  switchJobsByAgent?: Record<string, SwitchJobSummary>;
  switchQueue?: SwitchQueueStatus;
}) {
  const rowCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const queueByAgent = queueEntriesByAgent(switchQueue);

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
          <div className="space-y-3">
            <div className="hidden border-y bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground md:grid md:grid-cols-[1fr_1fr_0.8fr_0.8fr_0.8fr_1.5fr] md:gap-3 lg:grid-cols-[minmax(7rem,1fr)_minmax(8rem,1fr)_minmax(6rem,0.8fr)_minmax(7rem,0.8fr)_minmax(7rem,0.8fr)_minmax(15rem,1.4fr)]">
              <div>Agent</div>
              <div>Account</div>
              <div>Source</div>
              <div>Tier</div>
              <div>Pending restart</div>
              <div>Switch</div>
            </div>
            {groups.map((group) => (
              <Fragment key={group.key}>
                <div className="rounded-lg border bg-muted/35 p-3 md:grid md:grid-cols-[1fr_1fr_0.8fr_0.8fr_0.8fr_1.5fr] md:items-center md:gap-3 md:rounded-none md:border-x-0 md:bg-muted/40 md:px-3 md:py-2 lg:grid-cols-[minmax(7rem,1fr)_minmax(8rem,1fr)_minmax(6rem,0.8fr)_minmax(7rem,0.8fr)_minmax(7rem,0.8fr)_minmax(15rem,1.4fr)]">
                  <div className="font-medium md:col-span-2">{group.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground md:mt-0">
                    {group.source ?? group.section}
                  </div>
                  <div className="mt-2 md:mt-0">
                    {group.tier ? <TierBadge tier={group.tier} /> : <span className="text-muted-foreground">-</span>}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground md:mt-0">
                    {group.pendingRestartCount > 0 ? `${group.pendingRestartCount} pending` : 'none pending'}
                  </div>
                  <div className="hidden md:block" />
                </div>
                {group.rows.map((row) => (
                  <div
                    key={`${group.key}:${row.agentId}`}
                    data-agent-row={row.agentId}
                    className="grid gap-3 rounded-lg border bg-background p-3 md:grid-cols-[1fr_1fr_0.8fr_0.8fr_0.8fr_1.5fr] md:items-start md:gap-3 md:rounded-none md:border-x-0 md:border-t-0 md:px-3 md:py-3 lg:grid-cols-[minmax(7rem,1fr)_minmax(8rem,1fr)_minmax(6rem,0.8fr)_minmax(7rem,0.8fr)_minmax(7rem,0.8fr)_minmax(15rem,1.4fr)]"
                  >
                    <MatrixField label="Agent" className="font-medium">
                      <span className="break-words text-base md:text-xs">{row.agent}</span>
                    </MatrixField>
                    <MatrixField label="Account">
                      <span className="break-words text-muted-foreground">{row.account ?? group.label}</span>
                    </MatrixField>
                    <MatrixField label="Source">
                      <span className="break-words">{row.source}</span>
                    </MatrixField>
                    <MatrixField label="Tier">
                      <TierBadge tier={row.tier} />
                    </MatrixField>
                    <MatrixField label="Pending">
                      <PendingBadge pending={row.pending_restart} />
                    </MatrixField>
                    <MatrixField label="Switch" className="lg:min-w-56">
                      {row.section === 'account' ? (
                        <div data-agent-switch-control={row.agentId} className="flex min-w-0 flex-col gap-2">
                          <SwitchBreadcrumb job={switchJobsByAgent?.[row.agentId]} />
                          <QueueBreadcrumb entry={queueByAgent[row.agentId]} />
                          <AccountSwitchControl
                            agent={row.agent}
                            agentId={row.agentId}
                            currentAccount={row.account}
                            targets={vaultAccounts ?? null}
                            initialJob={switchJobsByAgent?.[row.agentId] ?? null}
                            initialQueue={queueByAgent[row.agentId] ?? null}
                          />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </MatrixField>
                  </div>
                ))}
              </Fragment>
            ))}
          </div>
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

function queueEntriesByAgent(status: SwitchQueueStatus | undefined): Record<string, QueueEntryRecord> {
  if (!status) return {};
  const rows = [
    ...(status.pending ?? []),
    ...(status.draining ? [status.draining] : []),
    ...(status.recent ?? []),
  ];
  const byAgent: Record<string, QueueEntryRecord> = {};
  for (const entry of rows) {
    if (!byAgent[entry.agent]) byAgent[entry.agent] = entry;
  }
  return byAgent;
}

function QueueBreadcrumb({ entry }: { entry?: QueueEntryRecord | null }) {
  if (!entry) return null;
  const text = queueBreadcrumbText(entry);
  if (!text) return null;
  const terminal = entry.status !== 'pending' && entry.status !== 'draining';
  const tone = entry.status === 'succeeded' || entry.status === 'already-at-target'
    ? 'text-emerald-600 dark:text-emerald-400'
    : entry.status === 'failed' || entry.status === 'crashed'
      ? 'text-destructive'
      : terminal
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-muted-foreground';
  return <p className={`text-xs ${tone}`}>{text}</p>;
}

export function queueBreadcrumbText(entry?: QueueEntryRecord | null): string | null {
  if (!entry) return null;
  if (entry.status === 'pending') return `Queued for ${entry.targetAccount}`;
  if (entry.status === 'draining') return `Draining switch to ${entry.targetAccount}`;
  return entry.resultSummary ?? entry.error ?? entry.status;
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
