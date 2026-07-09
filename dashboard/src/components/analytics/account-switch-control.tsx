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
import type { VaultAccountOption } from '@/lib/account-switch';

interface AccountSwitchControlProps {
  agent: string;
  currentAccount: string | null;
  targets: VaultAccountOption[] | null;
}

interface SwitchStatus {
  status: 'running' | 'succeeded' | 'failed' | 'crashed';
  elapsedMs: number;
  resultSummary?: string;
  error?: string;
  functionalSweepTaskId?: string;
}

export function AccountSwitchControl({ agent, currentAccount, targets }: AccountSwitchControlProps) {
  const [selected, setSelected] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<SwitchStatus | null>(null);
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
  }, [jobId]);

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
        body: JSON.stringify({ agent, targetAccount: selectedTarget.account }),
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
    <div className="flex min-w-56 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={selected} onValueChange={(value) => setSelected(value ?? '')} disabled={disabled}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue placeholder={switchableOptions.length > 0 ? 'Switch account' : 'No targets'} />
          </SelectTrigger>
          <SelectContent>
            {options.map((target) => (
              <SelectItem key={target.account} value={target.account} disabled={target.account === currentAccount}>
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
        <p className={`text-xs ${status.status === 'succeeded' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}>
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
            {agent === 'the-orchestrator' && (
              <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-300">
                This restarts the orchestrator. The switch completes in the background and the result remains readable after reconnect.
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={submitSwitch}>Confirm switch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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
