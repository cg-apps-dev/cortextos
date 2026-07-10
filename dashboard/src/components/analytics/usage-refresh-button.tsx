"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconRefresh } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';

interface UsageRefreshResult {
  refreshed?: boolean;
  asOf?: string;
  nextAllowedInMs?: number;
  error?: string;
}

export function UsageRefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextAllowedAt, setNextAllowedAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);

  useEffect(() => {
    if (nextAllowedAt === null) return;
    const tick = () => setRemainingMs(Math.max(0, nextAllowedAt - Date.now()));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [nextAllowedAt]);

  const disabled = loading || remainingMs > 0;

  async function refreshUsage() {
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      const csrfRes = await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' });
      const csrf = await csrfRes.json();
      const csrfToken = typeof csrf?.csrfToken === 'string' ? csrf.csrfToken : '';
      const res = await fetch('/api/usage/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrfToken },
      });
      const data = await res.json() as UsageRefreshResult;
      if (!res.ok) {
        setError(data.error ?? 'Usage refresh unavailable');
        return;
      }
      if (data.nextAllowedInMs) {
        setNextAllowedAt(Date.now() + data.nextAllowedInMs);
      } else {
        setNextAllowedAt(null);
        setRemainingMs(0);
      }
      if (data.error) {
        setError(data.error);
      } else if (data.refreshed) {
        setMessage(data.asOf ? `Refreshed sampler as of ${ptTime(data.asOf)}` : 'Refresh requested');
      } else {
        setMessage(data.asOf ? `Sampler already refreshed as of ${ptTime(data.asOf)}` : 'Refresh recently requested');
      }
      router.refresh();
    } catch {
      setError('Usage refresh unavailable');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={refreshUsage}
        disabled={disabled}
        title={remainingMs > 0 ? `Refresh available in ${durationLabel(remainingMs)}` : 'Refresh usage'}
      >
        <IconRefresh size={14} className={loading ? 'animate-spin' : ''} />
        {loading ? 'Refreshing...' : remainingMs > 0 ? `Refresh in ${durationLabel(remainingMs)}` : 'Refresh usage'}
      </Button>
      {(message || error) && (
        <p className={`max-w-72 text-right text-[10px] ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
          {error ?? message}
        </p>
      )}
    </div>
  );
}

function ptTime(iso: string): string {
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

function durationLabel(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}
