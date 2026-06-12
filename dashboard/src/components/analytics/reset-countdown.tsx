'use client';

import { useEffect, useState } from 'react';

export function formatResetCountdown(diffMs: number): string {
  if (diffMs <= 0) return 'Resets soon';
  if (diffMs < 60_000) return 'Resets in <1 min';

  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return `Resets in ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `Resets in ${hours}h ${remainingMinutes}m`;
}

export function ResetCountdown({ resets, fallback }: { resets?: string; fallback: string }) {
  const [now, setNow] = useState<number | null>(null);
  const resetTime = resets ? Date.parse(resets) : NaN;

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const text = now === null || isNaN(resetTime) ? fallback : formatResetCountdown(resetTime - now);

  return <p className="text-[10px] text-muted-foreground">{text}</p>;
}
