"use client";

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SwitchJobSummary, VaultAccountOption } from '@/lib/account-switch';

interface AccountSwitchControlProps {
  agent: string;
  agentId: string;
  currentAccount: string | null;
  targets: VaultAccountOption[] | null;
  initialJob?: SwitchJobSummary | null;
}

interface SwitchStatus {
  status: 'running' | 'succeeded' | 'failed' | 'crashed' | 'suspect';
  elapsedMs: number;
  attributionPending?: boolean;
  resultSummary?: string;
  error?: string;
  functionalSweepTaskId?: string;
}

export function AccountSwitchControl({ agent, agentId, currentAccount, targets, initialJob }: AccountSwitchControlProps) {
  const initialState = initialSwitchState(initialJob);
  const [selected, setSelected] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(initialState.jobId);
  const [status, setStatus] = useState<SwitchStatus | null>(initialState.status);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => targets ?? [], [targets]);
  const switchableOptions = useMemo(
    () => options.filter((target) => target.account !== currentAccount),
    [options, currentAccount],
  );
  const selectedTarget = switchableOptions.find((target) => target.account === selected) ?? null;
  const disabled = !targets || switchableOptions.length === 0 || !!(status && status.status === 'running');

  useEffect(() => {
    if (!jobId) return;
    if (initialJob?.jobId === jobId && !shouldPollInitialJob(initialJob)) return;
    const id = jobId;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/accounts/switch/status?jobId=${encodeURIComponent(id)}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data?.error ?? 'switch status unavailable');
          return;
        }
        setStatus(data);
        if (data.status === 'running') window.setTimeout(poll, 3000);
      } catch {
        if (!cancelled) setError('switch status unavailable');
      }
    }
    poll();
    return () => {
      cancelled = true;
    };
  }, [initialJob, jobId]);

  async function submitSwitch() {
    if (!selectedTarget) return;
    setError(null);
    try {
      const csrfRes = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
      const csrf = await csrfRes.json();
      const csrfToken = typeof csrf?.csrfToken === 'string' ? csrf.csrfToken : '';
      const res = await fetch('/api/accounts/switch', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(buildSwitchRequestBody(agentId, selectedTarget.account)),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? 'switch request failed');
        return;
      }
      setJobId(data.jobId);
      setStatus({ status: 'running', elapsedMs: 0 });
      setConfirmOpen(false);
    } catch {
      setError('switch request failed');
    }
  }

  if (!targets) {
    return (
      <div className="text-xs text-amber-600 dark:text-amber-400">
        Account switching unavailable - CLI not yet deployed.
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-2 lg:min-w-56">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={selected} onValueChange={(value) => setSelected(value ?? '')} disabled={disabled}>
          <SelectTrigger size="sm" className="min-h-11 w-full sm:min-h-0 sm:w-44">
            <SelectValue placeholder={switchableOptions.length > 0 ? 'Switch account' : 'No targets'} />
          </SelectTrigger>
          <SelectContent>
            {options.map((target) => (
              <SelectItem key={target.account} value={target.account} disabled={target.account === currentAccount} className="min-h-10">
                <span>{target.account}</span>
                <span className="text-xs text-muted-foreground">
                  {target.account === currentAccount ? 'current' : capacityLabel(target)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="min-h-11 w-full sm:min-h-0 sm:w-auto"
          disabled={disabled || !selectedTarget}
          onClick={() => setConfirmOpen(true)}
        >
          Switch
        </Button>
      </div>

      {status?.status === 'running' && (
        <p className="text-xs text-muted-foreground">
          Switching... stop, wait, start, verify. Elapsed {durationLabel(status.elapsedMs)}.
        </p>
      )}
      {status && status.status !== 'running' && (
        <p className={`text-xs ${switchStatusTone(status.status)}`}>
          {status.resultSummary ?? status.error ?? status.status}
          {status.functionalSweepTaskId ? ` (${status.functionalSweepTaskId})` : ''}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch {agent}</DialogTitle>
            <DialogDescription>
              This restarts {agent} and usually takes 2-3 minutes: stop, 60 second wait, start, then auth verify.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Target: <span className="font-medium">{selectedTarget?.account}</span> ({selectedTarget ? capacityLabel(selectedTarget) : 'unknown capacity'})
            </p>
            <p>The agent is offline during the switch. Success means auth flip verified; functional sweep remains pending.</p>
            {isOrchestratorAgent(agentId) && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                This restarts the orchestrator. The switch completes in the background and the result remains readable after reconnect.
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="w-full sm:w-auto" />}>Cancel</DialogClose>
            <Button onClick={submitSwitch} className="w-full sm:w-auto">Confirm switch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function initialSwitchState(job: SwitchJobSummary | null | undefined): { jobId: string | null; status: SwitchStatus | null } {
  return {
    jobId: job?.jobId ?? null,
    status: job ? toSwitchStatus(job) : null,
  };
}

export function shouldPollInitialJob(job: SwitchJobSummary | null | undefined): boolean {
  return job?.status === 'running';
}

export function toSwitchStatus(job: SwitchJobSummary): SwitchStatus {
  return {
    status: job.status,
    elapsedMs: job.elapsedMs,
    ...(job.attributionPending ? { attributionPending: true } : {}),
    ...(job.resultSummary ? { resultSummary: job.resultSummary } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.functionalSweepTaskId ? { functionalSweepTaskId: job.functionalSweepTaskId } : {}),
  };
}

export function buildSwitchRequestBody(agentId: string, targetAccount: string) {
  return { agent: agentId, targetAccount };
}

export function isOrchestratorAgent(agentId: string): boolean {
  return agentId === 'the-orchestrator';
}

export function switchStatusTone(status: SwitchStatus['status']): string {
  if (status === 'succeeded') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'suspect') return 'text-amber-700 dark:text-amber-300';
  return 'text-destructive';
}

function capacityLabel(target: VaultAccountOption): string {
  if (target.metered === true) return 'metered: safe';
  if (target.metered === false) return 'unmetered: hard-cap';
  return 'capacity unknown';
}

function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`;
}
