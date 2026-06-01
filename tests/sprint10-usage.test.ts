import { describe, it, expect } from 'vitest';
import { toPlanUsageSnapshot } from '../src/bus/oauth.js';

/**
 * Pure transformer: raw Anthropic OAuth usage API response → dashboard snapshot.
 * No credentials, no network, no I/O — just the shape mapping.
 */
describe('Sprint 10: toPlanUsageSnapshot', () => {
  const now = '2026-06-01T12:00:00.000Z';

  it('maps nested 5h/7d utilization + resets into the dashboard shape (rounded)', () => {
    const snap = toPlanUsageSnapshot(
      {
        five_hour: { utilization: 42.6, resets_at: '2026-06-01T17:00:00Z' },
        seven_day: { utilization: 80, resets_at: '2026-06-08T00:00:00Z' },
      },
      'keychain',
      now,
    );
    expect(snap.account).toBe('keychain');
    expect(snap.timestamp).toBe(now);
    expect(snap.five_hour).toEqual({ used_pct: 43, resets: '2026-06-01T17:00:00Z' });
    expect(snap.seven_day).toEqual({ used_pct: 80, resets: '2026-06-08T00:00:00Z' });
  });

  it('omits a window the API did not return', () => {
    const snap = toPlanUsageSnapshot({ seven_day: { utilization: 10, resets_at: 'r' } }, 'env', now);
    expect(snap.five_hour).toBeUndefined();
    expect(snap.seven_day?.used_pct).toBe(10);
  });

  it('treats a missing utilization as 0 (still carries reset time)', () => {
    const snap = toPlanUsageSnapshot({ five_hour: { resets_at: 'x' } }, 'env', now);
    expect(snap.five_hour?.used_pct).toBe(0);
    expect(snap.five_hour?.resets).toBe('x');
  });

  it('never carries a token field (snapshot is usage-only)', () => {
    const snap = toPlanUsageSnapshot(
      { five_hour: { utilization: 5 }, seven_day: { utilization: 5 } },
      'keychain',
      now,
    );
    expect(JSON.stringify(snap)).not.toMatch(/token|accessToken|Bearer/i);
  });
});
