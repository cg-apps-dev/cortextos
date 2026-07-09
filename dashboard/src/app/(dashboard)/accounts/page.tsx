import { getOrgs } from '@/lib/config';
import { syncCostsLazy } from '@/lib/sync';
import {
  getAgentAccountMatrixGroups,
  getAgentAccounts,
  getCodexActivity,
  getCodexUsage,
  getMultiAccountUsage,
} from '@/lib/data/reports';
import { SubscriptionUsage } from '@/components/analytics/subscription-usage';
import { AgentAccountMatrix } from '@/components/analytics/agent-account-matrix';

function ptTime(iso: string | undefined): string {
  if (!iso) return 'unknown';
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

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const orgs = getOrgs();
  const orgParam = typeof params.org === 'string' ? params.org : undefined;
  const org = orgParam && orgs.includes(orgParam) ? orgParam : '';

  syncCostsLazy();

  const [multiAccountUsage, agentAccounts, codexUsage, codexActivity] = await Promise.all([
    Promise.resolve(getMultiAccountUsage()),
    Promise.resolve(getAgentAccounts()),
    Promise.resolve(getCodexUsage()),
    Promise.resolve(getCodexActivity(7)),
  ]);

  const matrixGroups = getAgentAccountMatrixGroups(agentAccounts, org ? { org } : {});
  const newestUsageAge = ageLabel(multiAccountUsage?.newestFetchedAgeMs);
  const staleAfter = durationLabel(multiAccountUsage?.staleAfterMs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Fleet-wide subscription usage with {org ? `${org} agent mapping` : 'all-agent mapping'}.
        </p>
      </div>

      <div className="space-y-2">
        {agentAccounts && !agentAccounts.live && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <p className="font-medium">Snapshot fallback - live account resolver unreachable</p>
            <p className="mt-0.5 text-xs">
              Running-state map as of {ptTime(agentAccounts.runningStateGeneratedAt ?? agentAccounts.generatedAt)}.
            </p>
          </div>
        )}
        {multiAccountUsage?.stale && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <p className="font-medium">Usage sampler data is stale</p>
            <p className="mt-0.5 text-xs">
              Newest read as of {ptTime(multiAccountUsage.newestFetchedAt ?? multiAccountUsage.generatedAt)}
              {newestUsageAge ? ` (${newestUsageAge})` : ''}
              {staleAfter ? `; stale after ${staleAfter}` : ''}.
            </p>
          </div>
        )}
      </div>

      <SubscriptionUsage
        data={multiAccountUsage}
        codex={codexUsage}
        codexActivity={codexActivity}
        agentAccounts={agentAccounts}
        suppressPanelStatus
      />

      <AgentAccountMatrix groups={matrixGroups} org={org || undefined} />
    </div>
  );
}
