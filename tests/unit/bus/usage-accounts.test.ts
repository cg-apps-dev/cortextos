import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';
import {
  fingerprint,
  ptTime,
  parseUsageResponse,
  evaluateAlerts,
  captureKeychainUsageCredential,
  fetchAccountUsage,
  checkAllUsage,
  resolveUsageToken,
  beginUsageAuth,
  assertGrantedScopeSafe,
  USAGE_ALERT_5H_PCT,
  USAGE_ALERT_7D_PCT,
  type AccountUsage,
} from '../../../src/bus/usage-accounts';
import { atomicWriteSync } from '../../../src/utils/atomic';

const NOW = '2026-06-11T03:00:00.000Z';

function hash8(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

function makeCtxRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'usage-accounts-test-'));
  mkdirSync(join(dir, 'state', 'oauth'), { recursive: true });
  atomicWriteSync(join(dir, 'state', 'oauth', 'accounts.json'), JSON.stringify({
    active: 'cg-team-seat',
    accounts: {
      'cg-team-seat': {
        label: 'seat', access_token: 'sk-ant-inference-token', refresh_token: 'rt',
        expires_at: 0, last_refreshed: '', five_hour_utilization: 0, seven_day_utilization: 0,
      },
    },
    rotation_log: [],
  }, null, 2));
  return dir;
}

describe('usage-accounts', () => {
  let ctxRoot: string;

  beforeEach(() => { ctxRoot = makeCtxRoot(); });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    rmSync(ctxRoot, { recursive: true, force: true });
  });

  describe('fingerprint', () => {
    it('returns a stable hash and never reveals token bytes', () => {
      const t = 'sk-ant-oat01-mABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789wQAA';
      const f = fingerprint(t);
      expect(f).toBe(hash8(t));
      expect(f).toMatch(/^[a-f0-9]{8}$/);
      expect(f).not.toContain('sk-ant');
      expect(f).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    });
    it('handles short/empty safely', () => {
      expect(fingerprint('')).toBe('(empty)');
      expect(fingerprint('short')).toBe(hash8('short'));
    });
  });

  describe('ptTime', () => {
    it('renders ISO timestamps in Pacific time for humans', () => {
      // 2026-06-11T05:09:59Z = 10:09 PM PT (PDT, UTC-7) on Jun 10
      const s = ptTime('2026-06-11T05:09:59Z');
      expect(s).toContain('PT');
      expect(s).toContain('Jun 10');
      expect(s).toContain('10:09');
    });
    it('passes through garbage unchanged and empties safely', () => {
      expect(ptTime(undefined)).toBe('');
      expect(ptTime('not-a-date')).toBe('not-a-date');
    });
  });

  describe('parseUsageResponse', () => {
    it('parses nested utilization + extra_usage (the proven live shape)', () => {
      const u = parseUsageResponse('seat', {
        five_hour: { utilization: 42, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 17, resets_at: '2026-06-15T00:00:00Z' },
        extra_usage: { is_enabled: true, used_credits: 3 },
      }, NOW);
      expect(u.ok).toBe(true);
      expect(u.five_hour_pct).toBe(42);
      expect(u.seven_day_pct).toBe(17);
      expect(u.extra_usage).toEqual({ is_enabled: true, used_credits: 3 });
    });

    it('treats utilization as an already-0-100 percentage with clamping', () => {
      const u = parseUsageResponse('seat', {
        five_hour: { utilization: 0, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 101, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u.ok).toBe(true);
      expect(u.five_hour_pct).toBe(0);
      expect(u.seven_day_pct).toBe(100);
    });

    it('utilization of 1 is one percent, not one hundred (me-com/icloud anchor)', () => {
      const u = parseUsageResponse('me-com-max', {
        five_hour: { utilization: 1, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 1, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      // Load-bearing regression for the 2026-06-13 wrong-numbers incident.
      expect(u.ok).toBe(true);
      expect(u.five_hour_pct).toBe(1);
      expect(u.seven_day_pct).toBe(1);
    });

    it('tolerates missing extra_usage', () => {
      const u = parseUsageResponse('seat', { five_hour: { utilization: 10, resets_at: '2026-06-11T05:00:00Z' } }, NOW);
      expect(u.ok).toBe(true);
      expect(u.extra_usage).toBeUndefined();
    });

    it('marks POSITIVE utilization with null reset metadata as an impossible read', () => {
      const u = parseUsageResponse('seat', {
        five_hour: { utilization: 5, resets_at: null },
        seven_day: { utilization: 17, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u.ok).toBe(false);
      expect(u.status).toBe('impossible-read');
      expect(u.error).toBe('impossible-read: five_hour utilization without resets_at');
      expect(JSON.stringify(u)).not.toContain('sk-ant');
    });

    it('marks a full five-hour cap with raw zero seven-day usage as an impossible subset read', () => {
      const u = parseUsageResponse('cg-team-seat', {
        five_hour: { utilization: 100, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 0, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u.ok).toBe(false);
      expect(u.status).toBe('impossible-read');
      expect(u.error).toContain('subset-invariant');
      expect(u.five_hour_pct).toBe(100);
      expect(u.seven_day_pct).toBe(0);
    });

    it('does not mark raw nonzero seven-day usage that rounds to zero as impossible', () => {
      const u = parseUsageResponse('fresh-window', {
        five_hour: { utilization: 100, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 0.3, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u.ok).toBe(true);
      expect(u.status).toBeUndefined();
      expect(u.five_hour_pct).toBe(100);
      expect(u.seven_day_pct).toBe(0);
    });

    it('keeps a full five-hour cap with raw nonzero seven-day usage legitimate', () => {
      const u = parseUsageResponse('real-cap', {
        five_hour: { utilization: 100, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 3, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u.ok).toBe(true);
      expect(u.status).toBeUndefined();
      expect(u.five_hour_pct).toBe(100);
      expect(u.seven_day_pct).toBe(3);
    });

    it('does not mark partial five-hour usage with raw zero seven-day usage as impossible', () => {
      const u = parseUsageResponse('partial-5h', {
        five_hour: { utilization: 50, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 0, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u.ok).toBe(true);
      expect(u.status).toBeUndefined();
      expect(u.five_hour_pct).toBe(50);
      expect(u.seven_day_pct).toBe(0);
    });

    it('does not mark just-under-full five-hour usage with raw zero seven-day usage as impossible', () => {
      const u = parseUsageResponse('under-full-5h', {
        five_hour: { utilization: 99.9, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 0, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u.ok).toBe(true);
      expect(u.status).toBeUndefined();
      expect(u.five_hour_pct).toBe(100);
      expect(u.seven_day_pct).toBe(0);
    });

    it('keeps all-idle null-reset windows legitimate', () => {
      const u = parseUsageResponse('all-idle', {
        five_hour: { utilization: 0, resets_at: null },
        seven_day: { utilization: 0, resets_at: null },
      }, NOW);
      expect(u.ok).toBe(true);
      expect(u.status).toBeUndefined();
      expect(u.five_hour_pct).toBe(0);
      expect(u.seven_day_pct).toBe(0);
    });

    it('does not mark missing raw utilization as a subset impossible read', () => {
      const missingFiveHour = parseUsageResponse('missing-5h', {
        five_hour: { resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 0, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      const missingSevenDay = parseUsageResponse('missing-7d', {
        five_hour: { utilization: 100, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);

      expect(missingFiveHour.ok).toBe(true);
      expect(missingFiveHour.status).toBeUndefined();
      expect(missingSevenDay.ok).toBe(true);
      expect(missingSevenDay.status).toBeUndefined();
    });

    it('joins reset metadata and subset impossible-read reasons distinctly', () => {
      const u = parseUsageResponse('double-impossible', {
        five_hour: { utilization: 100, resets_at: null },
        seven_day: { utilization: 0, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u.ok).toBe(false);
      expect(u.status).toBe('impossible-read');
      expect(u.error).toBe(
        'impossible-read: five_hour utilization without resets_at; five_hour>=100 with seven_day==0 (subset-invariant violation)',
      );
    });

    it('treats zero utilization with null reset as a VALID IDLE window (not impossible)', () => {
      // Anthropic returns utilization:0 + resets_at:null for a window with no
      // recent usage (no active rolling window -> no reset time). A legit idle 0
      // must read ok:true/0%, NOT impossible-read. (Raw-payload-verified fix.)
      const u = parseUsageResponse('idle', {
        five_hour: { utilization: 0, resets_at: null },
        seven_day: { utilization: 1, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u.ok).toBe(true);
      expect(u.status).toBeUndefined();
      expect(u.five_hour_pct).toBe(0);
      expect(u.seven_day_pct).toBe(1);
    });

    it('keeps zero utilization with valid reset metadata as legitimate idle state', () => {
      const u = parseUsageResponse('me-com-max', {
        five_hour: { utilization: 0, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 0, resets_at: '2026-06-15T00:00:00Z' },
      }, NOW);
      expect(u).toMatchObject({
        ok: true,
        five_hour_pct: 0,
        seven_day_pct: 0,
      });
    });

    it('does not classify a missing utilization with null reset as impossible-read', () => {
      const u = parseUsageResponse('fresh', { five_hour: { resets_at: null } }, NOW);
      expect(u.ok).toBe(true);
      expect(u.status).toBeUndefined();
      expect(u.five_hour_pct).toBeUndefined();
    });
  });

  describe('evaluateAlerts (edge-triggered dedup)', () => {
    const base: AccountUsage = { account: 'a', ok: true, fetched_at: NOW };
    // Build a prev alert-state for account 'a'.
    const st = (o: Partial<{ five_h_over: boolean; seven_d_over: boolean; five_h_pending: boolean; seven_d_pending: boolean; extra_enabled: boolean; extra_credits: number; fetch_failing: boolean; fail_consecutive: number; fetch_fail_alerted: boolean }>) => ({
      a: { five_h_over: false, seven_d_over: false, five_h_pending: false, seven_d_pending: false, extra_enabled: false, extra_credits: 0, fetch_failing: false, fail_consecutive: 0, fetch_fail_alerted: false, at: '2026-06-11T02:00:00.000Z', ...o },
    });

    it('a SINGLE over-read from empty state is a candidate, NOT an alert (2-consecutive rule)', () => {
      const { alerts, nextState } = evaluateAlerts([
        { ...base, five_hour_pct: USAGE_ALERT_5H_PCT + 1, seven_day_pct: USAGE_ALERT_7D_PCT + 1 },
      ], {}, NOW);
      expect(alerts).toEqual([]);
      expect(nextState.a.five_h_pending).toBe(true);
      expect(nextState.a.five_h_over).toBe(false);
      expect(nextState.a.seven_d_pending).toBe(true);
    });

    it('CONFIRMS the alert on the 2nd consecutive over-read', () => {
      const { alerts, nextState } = evaluateAlerts(
        [{ ...base, five_hour_pct: 90, seven_day_pct: 95 }],
        st({ five_h_pending: true, seven_d_pending: true }), NOW,
      );
      expect(alerts.some(a => a.startsWith('5H'))).toBe(true);
      expect(alerts.some(a => a.startsWith('7D'))).toBe(true);
      expect(nextState.a.five_h_over).toBe(true);
      expect(nextState.a.five_h_pending).toBe(false);
    });

    it('ABSORBS a single-read anomaly (21 -> 100 -> 2 = ZERO alerts) - the regression case', () => {
      let state = {};
      let allAlerts: string[] = [];
      for (const pct of [21, 100, 2]) {
        const r = evaluateAlerts([{ ...base, five_hour_pct: pct }], state, NOW);
        state = r.nextState;
        allAlerts = allAlerts.concat(r.alerts);
      }
      expect(allAlerts).toEqual([]);
    });

    it('fires a SUSTAINED spike on the 2nd consecutive (88 -> 90 = one 5H alert)', () => {
      let state = {};
      let allAlerts: string[] = [];
      for (const pct of [88, 90]) {
        const r = evaluateAlerts([{ ...base, five_hour_pct: pct }], state, NOW);
        state = r.nextState;
        allAlerts = allAlerts.concat(r.alerts);
      }
      expect(allAlerts.filter(a => a.startsWith('5H'))).toHaveLength(1);
    });

    it('candidates are PER-ACCOUNT per-bucket (icloud over then seat over = two candidates, no cross-confirm)', () => {
      // Read 1: icloud over, seat under.
      let r = evaluateAlerts([
        { account: 'icloud', ok: true, five_hour_pct: 90, fetched_at: NOW },
        { account: 'seat', ok: true, five_hour_pct: 10, fetched_at: NOW },
      ], {}, NOW);
      expect(r.alerts).toEqual([]);
      expect(r.nextState.icloud.five_h_pending).toBe(true);
      // Read 2: icloud BACK under, seat now over. Neither should fire - icloud's
      // candidate is absorbed; seat is a fresh first candidate.
      r = evaluateAlerts([
        { account: 'icloud', ok: true, five_hour_pct: 10, fetched_at: NOW },
        { account: 'seat', ok: true, five_hour_pct: 90, fetched_at: NOW },
      ], r.nextState, NOW);
      expect(r.alerts).toEqual([]);
      expect(r.nextState.icloud.five_h_pending).toBe(false);
      expect(r.nextState.seat.five_h_pending).toBe(true);
    });

    it('QUIETS a persistent (confirmed) over-threshold (the 15-min no-spam case)', () => {
      const usage = { ...base, five_hour_pct: 90, seven_day_pct: 95 };
      const { alerts } = evaluateAlerts([usage], st({ five_h_over: true, seven_d_over: true }), NOW);
      expect(alerts).toEqual([]);
    });

    it('fires a RECOVERY when 7d drops back under threshold (Sunday reset clears 95%)', () => {
      const { alerts, nextState } = evaluateAlerts(
        [{ ...base, seven_day_pct: 10 }], st({ seven_d_over: true }), NOW,
      );
      expect(alerts.some(a => a.startsWith('RECOVERED') && a.includes('7d'))).toBe(true);
      expect(nextState.a.seven_d_over).toBe(false);
    });

    it('stays quiet at exactly the thresholds (strictly-above)', () => {
      const { alerts } = evaluateAlerts([
        { ...base, five_hour_pct: USAGE_ALERT_5H_PCT, seven_day_pct: USAGE_ALERT_7D_PCT },
      ], {}, NOW);
      expect(alerts).toEqual([]);
    });

    it('extra-usage: ENABLE edge fires once, then QUIET while flat', () => {
      const usage = { ...base, extra_usage: { is_enabled: true, used_credits: 5 } };
      const first = evaluateAlerts([usage], {}, NOW);
      expect(first.alerts.some(a => a.includes('ENABLED with 5 credits'))).toBe(true);
      // Same flat reading next cycle -> no alert.
      const second = evaluateAlerts([usage], first.nextState, NOW);
      expect(second.alerts).toEqual([]);
    });

    it('extra-usage: RISE edge fires with burn-rate delta + PT time', () => {
      const { alerts } = evaluateAlerts(
        [{ ...base, extra_usage: { is_enabled: true, used_credits: 12 } }],
        st({ extra_enabled: true, extra_credits: 7 }), NOW,
      );
      expect(alerts[0]).toContain('RISING 7 -> 12');
      expect(alerts[0]).toContain('delta +5 since');
      expect(alerts[0]).toContain('PT');
    });

    it('extra-usage: DISABLE edge fires once (meter walled off)', () => {
      const { alerts, nextState } = evaluateAlerts(
        [{ ...base, extra_usage: { is_enabled: false, used_credits: 0 } }],
        st({ extra_enabled: true, extra_credits: 537155 }), NOW,
      );
      expect(alerts.some(a => a.includes('DISABLED') && a.includes('537155'))).toBe(true);
      expect(nextState.a.extra_enabled).toBe(false);
    });

    it('suppresses a 1-cycle fetch-fail blip and does not recover-alert', () => {
      const failing = { account: 'b', ok: false, error: 'HTTP 403', fetched_at: NOW };
      const first = evaluateAlerts([failing], {}, NOW);
      expect(first.alerts).toEqual([]);
      expect(first.nextState.b.fail_consecutive).toBe(1);
      const recovered = evaluateAlerts([{ account: 'b', ok: true, fetched_at: NOW }], first.nextState, NOW);
      expect(recovered.alerts).toEqual([]);
      expect(recovered.nextState.b.fail_consecutive).toBe(0);
      expect(recovered.nextState.b.fetch_fail_alerted).toBe(false);
    });

    it('suppresses a 2-cycle fetch-fail blip and does not recover-alert', () => {
      const failing = { account: 'b', ok: false, error: 'HTTP 403', fetched_at: NOW };
      const first = evaluateAlerts([failing], {}, NOW);
      const second = evaluateAlerts([failing], first.nextState, NOW);
      expect(first.alerts).toEqual([]);
      expect(second.alerts).toEqual([]);
      const recovered = evaluateAlerts([{ account: 'b', ok: true, fetched_at: NOW }], second.nextState, NOW);
      expect(recovered.alerts).toEqual([]);
    });

    it('fetch-fail fires once on the 3rd consecutive failure', () => {
      const failing = { account: 'b', ok: false, error: 'HTTP 403', fetched_at: NOW };
      let state = {};
      const allAlerts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = evaluateAlerts([failing], state, NOW);
        state = r.nextState;
        allAlerts.push(...r.alerts);
      }
      expect(allAlerts.filter(a => a.includes('USAGE-FETCH-FAIL b'))).toHaveLength(1);
      expect(allAlerts[0]).toContain('HTTP 403');
    });

    it('persistent fetch-fail stays quiet after the one confirmed alert', () => {
      const failing = { account: 'b', ok: false, error: 'HTTP 403', fetched_at: NOW };
      let state = {};
      const allAlerts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = evaluateAlerts([failing], state, NOW);
        state = r.nextState;
        allAlerts.push(...r.alerts);
      }
      expect(allAlerts.filter(a => a.includes('USAGE-FETCH-FAIL b'))).toHaveLength(1);
      expect(allAlerts.some(a => a.includes('RECOVERED'))).toBe(false);
    });

    it('recovery fires only after a confirmed fetch-fail alert', () => {
      const failing = { account: 'b', ok: false, error: 'HTTP 403', fetched_at: NOW };
      let state = {};
      for (let i = 0; i < 3; i++) {
        const r = evaluateAlerts([failing], state, NOW);
        state = r.nextState;
      }
      const recovered = evaluateAlerts([{ account: 'b', ok: true, fetched_at: NOW }], state, NOW);
      expect(recovered.alerts.some(a => a.startsWith('RECOVERED') && a.includes('fetch restored'))).toBe(true);
      expect(recovered.nextState.b.fail_consecutive).toBe(0);
      expect(recovered.nextState.b.fetch_fail_alerted).toBe(false);
    });

    it('re-fail after recovery needs 3 more failures to alert again', () => {
      const failing = { account: 'b', ok: false, error: 'HTTP 403', fetched_at: NOW };
      let state = {};
      const allAlerts: string[] = [];
      for (let i = 0; i < 3; i++) {
        const r = evaluateAlerts([failing], state, NOW);
        state = r.nextState;
        allAlerts.push(...r.alerts);
      }
      const recovered = evaluateAlerts([{ account: 'b', ok: true, fetched_at: NOW }], state, NOW);
      state = recovered.nextState;
      allAlerts.push(...recovered.alerts);
      for (let i = 0; i < 3; i++) {
        const r = evaluateAlerts([failing], state, NOW);
        state = r.nextState;
        allAlerts.push(...r.alerts);
      }
      expect(allAlerts.filter(a => a.includes('USAGE-FETCH-FAIL b'))).toHaveLength(2);
      expect(allAlerts.filter(a => a.includes('RECOVERED b'))).toHaveLength(1);
    });

    it('back-compatible old fetch state behaves as fresh and does not crash', () => {
      const failing = { account: 'a', ok: false, error: 'HTTP 403', fetched_at: NOW };
      const oldState = st({ fetch_failing: true });
      const r = evaluateAlerts([failing], oldState, NOW);
      expect(r.alerts).toEqual([]);
      expect(r.nextState.a.fail_consecutive).toBe(1);
      expect(r.nextState.a.fetch_fail_alerted).toBe(false);
    });

    it('incident replay: fail/ok flap sequence produces zero alerts', () => {
      let state = {};
      const allAlerts: string[] = [];
      for (const ok of [false, true, false, true, false, true, false, true]) {
        const row = ok
          ? { account: 'cg-team-seat', ok: true, fetched_at: NOW }
          : { account: 'cg-team-seat', ok: false, error: 'impossible-read', fetched_at: NOW };
        const r = evaluateAlerts([row], state, NOW);
        state = r.nextState;
        allAlerts.push(...r.alerts);
      }
      expect(allAlerts).toEqual([]);
    });

    it('suppresses 5h/7d threshold edges for a BENCHED account (data-driven) but keeps extra-usage + fetch-fail', () => {
      // Benched account over both thresholds AND extra-usage enabled + fetch ok.
      const benchedOver = { ...base, account: 'me-com-max', benched: true, five_hour_pct: 90, seven_day_pct: 95, extra_usage: { is_enabled: true, used_credits: 100 } };
      const { alerts } = evaluateAlerts([benchedOver], {}, NOW);
      // No 5H/7D threshold lines...
      expect(alerts.some(a => a.startsWith('5H'))).toBe(false);
      expect(alerts.some(a => a.startsWith('7D'))).toBe(false);
      // ...but extra-usage ENABLE still alerts (decision-relevant even benched).
      expect(alerts.some(a => a.includes('EXTRA-USAGE') && a.includes('ENABLED'))).toBe(true);
      // fetch-fail still alerts for a benched account too once confirmed.
      const benchedFail = { account: 'me-com-max', ok: false, error: 'HTTP 403', benched: true, fetched_at: NOW };
      let state = {};
      for (let i = 0; i < 2; i++) state = evaluateAlerts([benchedFail], state, NOW).nextState;
      expect(evaluateAlerts([benchedFail], state, NOW).alerts.some(a => a.includes('USAGE-FETCH-FAIL'))).toBe(true);
    });

    it('a failing fetch does NOT reset the 5h/7d/extra edges (carried forward)', () => {
      const prev = st({ seven_d_over: true, extra_enabled: true, extra_credits: 100 });
      const { nextState } = evaluateAlerts([{ account: 'a', ok: false, error: 'HTTP 500', fetched_at: NOW }], prev, NOW);
      expect(nextState.a.seven_d_over).toBe(true);
      expect(nextState.a.extra_enabled).toBe(true);
      expect(nextState.a.extra_credits).toBe(100);
      expect(nextState.a.fetch_failing).toBe(true);
      expect(nextState.a.fail_consecutive).toBe(1);
    });
  });

  describe('evaluateAlerts display names (email-led, Adam request)', () => {
    const base: AccountUsage = { account: 'me-com-max', ok: true, fetched_at: NOW };
    const display = { 'me-com-max': 'afolker@me.com (me-com-max)' };

    it('leads with email + pool label in parens when the display map has the account', () => {
      const { alerts } = evaluateAlerts(
        [{ ...base, extra_usage: { is_enabled: true, used_credits: 5 } }], {}, NOW, display,
      );
      expect(alerts[0]).toContain('EXTRA-USAGE afolker@me.com (me-com-max):');
    });

    it('falls back to the bare pool label when the account has no email', () => {
      const { alerts } = evaluateAlerts(
        [{ account: 'no-email-acct', ok: true, fetched_at: NOW, extra_usage: { is_enabled: true, used_credits: 5 } }],
        {}, NOW, display,
      );
      expect(alerts[0]).toContain('EXTRA-USAGE no-email-acct:');
      expect(alerts[0]).not.toContain('@');
    });

    it('threshold + fetch-fail strings use the display name too', () => {
      let r = evaluateAlerts([{ ...base, five_hour_pct: 90 }], {}, NOW, display);
      r = evaluateAlerts([{ ...base, five_hour_pct: 91 }], r.nextState, NOW, display);
      expect(r.alerts.some(a => a.startsWith('5H afolker@me.com (me-com-max):'))).toBe(true);
      const fail = { account: 'me-com-max', ok: false, error: 'HTTP 500', fetched_at: NOW };
      let state = {};
      for (let i = 0; i < 2; i++) state = evaluateAlerts([fail], state, NOW, display).nextState;
      const f = evaluateAlerts([fail], state, NOW, display);
      expect(f.alerts[0]).toContain('USAGE-FETCH-FAIL afolker@me.com (me-com-max):');
    });

    it('alert STATE stays keyed by pool label (email backfill cannot reset edges)', () => {
      const r = evaluateAlerts(
        [{ ...base, extra_usage: { is_enabled: true, used_credits: 5 } }], {}, NOW, display,
      );
      expect(Object.keys(r.nextState)).toEqual(['me-com-max']);
    });

    it('omitting the display map keeps legacy label-only strings (no behavior change)', () => {
      const { alerts } = evaluateAlerts(
        [{ ...base, extra_usage: { is_enabled: true, used_credits: 5 } }], {}, NOW,
      );
      expect(alerts[0]).toContain('EXTRA-USAGE me-com-max:');
    });
  });

  describe('captureKeychainUsageCredential', () => {
    const goodBlob = () => ({
      accessToken: 'sk-ant-oat01-mSECRETSECRETSECRETwQAA',
      refreshToken: 'sk-ant-ort01-rSECRETSECRETSECRETxQBB',
      expiresAt: Date.now() + 3600_000,
      scopes: ['user:inference', 'user:profile'],
    });

    it('stores the credential on the named account with source + fingerprint-only return', () => {
      const r = captureKeychainUsageCredential(ctxRoot, 'cg-team-seat', goodBlob);
      expect(r.fingerprint).toBe(hash8('sk-ant-oat01-mSECRETSECRETSECRETwQAA'));
      expect(JSON.stringify(r)).not.toContain('SECRET');
      expect(JSON.stringify(r)).not.toContain('sk-ant');
      const store = JSON.parse(readFileSync(join(ctxRoot, 'state', 'oauth', 'accounts.json'), 'utf-8'));
      const cred = store.accounts['cg-team-seat'].usage_credential;
      expect(cred.source).toBe('keychain-capture');
      expect(cred.access_token).toContain('SECRET'); // stored in full, returned only as fingerprint
      expect(cred.refresh_token).toContain('SECRET');
    });

    it('creates a usage-only stub for an unknown account (no inference tokens)', () => {
      captureKeychainUsageCredential(ctxRoot, 'icloud-max-20x', goodBlob);
      const store = JSON.parse(readFileSync(join(ctxRoot, 'state', 'oauth', 'accounts.json'), 'utf-8'));
      const acct = store.accounts['icloud-max-20x'];
      expect(acct.access_token).toBe('');
      expect(acct.usage_credential.access_token).toContain('SECRET');
    });

    it('rejects a blob without user:profile scope (setup-token detector)', () => {
      const setupBlob = () => ({ ...goodBlob(), scopes: ['user:inference'] });
      expect(() => captureKeychainUsageCredential(ctxRoot, 'cg-team-seat', setupBlob))
        .toThrow(/user:profile/);
    });

    it('rejects a missing/incomplete blob with a clear error', () => {
      expect(() => captureKeychainUsageCredential(ctxRoot, 'cg-team-seat', () => null))
        .toThrow(/missing or incomplete/);
    });

    it('keeps accounts.json at 0600 after write', () => {
      captureKeychainUsageCredential(ctxRoot, 'cg-team-seat', goodBlob);
      const mode = statSync(join(ctxRoot, 'state', 'oauth', 'accounts.json')).mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe('resolveUsageToken (source-branched: F - seat live keychain read)', () => {
    function seedCred(source: 'keychain-capture' | 'pkce-authorize', access: string, expiresAt: number) {
      const store = JSON.parse(readFileSync(join(ctxRoot, 'state', 'oauth', 'accounts.json'), 'utf-8'));
      store.accounts['cg-team-seat'].usage_credential = {
        access_token: access, refresh_token: 'rt-stored', expires_at: expiresAt,
        scopes: ['user:profile'], source, captured_at: NOW,
      };
      atomicWriteSync(join(ctxRoot, 'state', 'oauth', 'accounts.json'), JSON.stringify(store, null, 2));
    }

    it('keychain-capture: returns the LIVE keychain token even when the stored copy is expired (the 09:00Z rotation case)', async () => {
      seedCred('keychain-capture', 'sk-ant-oat01-STALEDEADTOKENwQAA', Date.now() - 3600_000);
      const liveBlob = () => ({
        accessToken: 'sk-ant-oat01-FRESHLIVEKEYwNEW', refreshToken: 'rt-fresh',
        expiresAt: Date.now() + 8 * 3600_000, scopes: ['user:profile', 'user:inference'],
      });
      const token = await resolveUsageToken(ctxRoot, 'cg-team-seat', liveBlob);
      expect(token).toBe('sk-ant-oat01-FRESHLIVEKEYwNEW');
    });

    it('keychain-capture: refreshes the stored metadata pointer to the live token (no manual re-capture)', async () => {
      seedCred('keychain-capture', 'sk-ant-oat01-STALEwQAA', Date.now() - 3600_000);
      const newExp = Date.now() + 8 * 3600_000;
      await resolveUsageToken(ctxRoot, 'cg-team-seat', () => ({
        accessToken: 'sk-ant-oat01-FRESHwNEW', refreshToken: 'rt-fresh', expiresAt: newExp, scopes: ['user:profile'],
      }));
      const store = JSON.parse(readFileSync(join(ctxRoot, 'state', 'oauth', 'accounts.json'), 'utf-8'));
      expect(store.accounts['cg-team-seat'].usage_credential.access_token).toBe('sk-ant-oat01-FRESHwNEW');
      expect(store.accounts['cg-team-seat'].usage_credential.expires_at).toBe(newExp);
    });

    it('keychain-capture: throws (not silently uses stale) when the machine is logged out', async () => {
      seedCred('keychain-capture', 'sk-ant-oat01-STALEwQAA', Date.now() - 3600_000);
      await expect(resolveUsageToken(ctxRoot, 'cg-team-seat', () => null))
        .rejects.toThrow(/keychain credential unavailable/);
    });

    it('pkce-authorize: uses the STORED token (does NOT read the keychain)', async () => {
      seedCred('pkce-authorize', 'sk-ant-oat01-PKCESTOREDwTOK', Date.now() + 3600_000);
      let keychainRead = false;
      const token = await resolveUsageToken(ctxRoot, 'cg-team-seat', () => { keychainRead = true; return null; });
      expect(token).toBe('sk-ant-oat01-PKCESTOREDwTOK');
      expect(keychainRead).toBe(false);
    });
  });

  describe('usage monitor hardening', () => {
    function seedAccounts(accounts: Record<string, { source?: 'keychain-capture' | 'pkce-authorize'; token?: string; benched?: boolean }>) {
      const shaped: Record<string, unknown> = {};
      for (const [name, account] of Object.entries(accounts)) {
        const row: Record<string, unknown> = {
          label: name,
          access_token: '',
          refresh_token: '',
          expires_at: 0,
          last_refreshed: '',
          five_hour_utilization: 0,
          seven_day_utilization: 0,
          benched: account.benched,
        };
        if (account.token && account.source) {
          row.usage_credential = {
            access_token: account.token,
            refresh_token: 'rt',
            expires_at: Date.now() + 3600_000,
            scopes: ['user:profile'],
            source: account.source,
            captured_at: NOW,
          };
        }
        shaped[name] = row;
      }
      atomicWriteSync(join(ctxRoot, 'state', 'oauth', 'accounts.json'), JSON.stringify({
        active: Object.keys(accounts)[0],
        accounts: shaped,
        rotation_log: [],
      }, null, 2));
    }

    function okResponse(body: unknown) {
      return { ok: true, status: 200, json: async () => body };
    }

    function stubUsageResponses(bodies: unknown[]) {
      const fetchMock = vi.fn();
      for (const body of bodies) fetchMock.mockResolvedValueOnce(okResponse(body));
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    function readJson(path: string): unknown {
      return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    }

    function diagnosticsPath(): string {
      return join(ctxRoot, 'state', 'usage', 'diagnostics.jsonl');
    }

    function multiAccountUsagePath(): string {
      return join(ctxRoot, 'state', 'usage', 'multi-account-usage.json');
    }

    function readDiagnostics(): Array<Record<string, unknown>> {
      return readFileSync(diagnosticsPath(), 'utf-8')
        .split(/\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    }

    it('fetchAccountUsage writes source attribution, fingerprint, and raw response without token material', async () => {
      seedAccounts({
        'cg-team-seat': { source: 'keychain-capture', token: 'sk-ant-oat01-STOREDSECRETwOLD' },
      });
      stubUsageResponses([{
        five_hour: { utilization: 12, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 34, resets_at: '2026-06-15T00:00:00Z' },
      }]);

      const usage = await fetchAccountUsage(ctxRoot, 'cg-team-seat', () => ({
        accessToken: 'sk-ant-oat01-LIVESECRETwNEW',
        refreshToken: 'rt-live',
        expiresAt: Date.now() + 3600_000,
        scopes: ['user:profile'],
      }));

      expect(usage.ok).toBe(true);
      expect(usage.credential_source).toBe('keychain-capture');
      expect(usage.credential_fingerprint).toBe(hash8('sk-ant-oat01-LIVESECRETwNEW'));
      expect(JSON.stringify(usage)).not.toContain('LIVESECRET');
      expect(JSON.stringify(usage)).not.toContain('sk-ant');
      const raw = readJson(join(ctxRoot, 'state', 'usage', 'raw', 'cg-team-seat.json')) as { entries: Array<{ response: unknown }> };
      expect(JSON.stringify(raw)).toContain('credential_fingerprint');
      expect(JSON.stringify(raw.entries[0].response)).not.toContain('sk-ant');
      expect(JSON.stringify(raw)).not.toContain('LIVESECRET');
      expect(JSON.stringify(raw)).not.toContain('sk-ant');
    });

    it('checkAllUsage carries pkce attribution into the multi-account row', async () => {
      seedAccounts({
        'icloud-max-20x': { source: 'pkce-authorize', token: 'sk-ant-oat01-PKCESECRETwTOK' },
      });
      stubUsageResponses([{
        five_hour: { utilization: 1, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 2, resets_at: '2026-06-15T00:00:00Z' },
      }]);

      const result = await checkAllUsage(ctxRoot);

      expect(result.accounts[0]).toMatchObject({
        account: 'icloud-max-20x',
        ok: true,
        credential_source: 'pkce-authorize',
        credential_fingerprint: hash8('sk-ant-oat01-PKCESECRETwTOK'),
      });
      const snapshot = readJson(join(ctxRoot, 'state', 'usage', 'multi-account-usage.json'));
      expect(JSON.stringify(snapshot)).not.toContain('PKCESECRET');
      expect(JSON.stringify(snapshot)).not.toContain('sk-ant');
    });

    it('skips live fetches for benched accounts even when a keychain credential exists', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-11T03:05:00.000Z'));
      seedAccounts({
        'moonlight-max': { source: 'keychain-capture', token: 'sk-ant-oat01-MOONOLDSECRETwTOK', benched: true },
      });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const blobReader = vi.fn(() => ({
        accessToken: 'sk-ant-oat01-MOONLIVESECRETwTOK',
        refreshToken: 'rt-live',
        expiresAt: Date.now() + 3600_000,
        scopes: ['user:profile'],
      }));

      const result = await checkAllUsage(ctxRoot, blobReader);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(blobReader).not.toHaveBeenCalled();
      expect(result.accounts).toEqual([{
        account: 'moonlight-max',
        ok: true,
        benched: true,
        status: 'benched',
        fetched_at: '2026-06-11T03:05:00.000Z',
      }]);
      expect(result.alerts).toEqual([]);
    });

    it('treats a benched account without a usage credential as ok inactive, not a fetch failure', async () => {
      seedAccounts({
        'moonlight-max': { benched: true },
      });
      const blobReader = vi.fn(() => null);

      const result = await checkAllUsage(ctxRoot, blobReader);

      expect(blobReader).not.toHaveBeenCalled();
      expect(result.accounts[0]).toMatchObject({
        account: 'moonlight-max',
        ok: true,
        benched: true,
        status: 'benched',
      });
      expect(result.accounts[0].error).toBeUndefined();
      expect(result.alerts).toEqual([]);
      expect(existsSync(diagnosticsPath())).toBe(false);
    });

    it('does not emit USAGE-FETCH-FAIL for a benched no-credential account across confirmed-failure cycles', async () => {
      seedAccounts({
        'moonlight-max': { benched: true },
      });
      const alerts: string[] = [];

      for (let i = 0; i < 4; i++) {
        alerts.push(...(await checkAllUsage(ctxRoot)).alerts);
      }

      expect(alerts.some((alert) => alert.includes('USAGE-FETCH-FAIL moonlight-max'))).toBe(false);
      const alertState = readJson(join(ctxRoot, 'state', 'usage', 'alert-state.json')) as {
        'moonlight-max': { fail_consecutive: number; fetch_fail_alerted: boolean; fetch_failing: boolean };
      };
      expect(alertState['moonlight-max'].fail_consecutive).toBe(0);
      expect(alertState['moonlight-max'].fetch_fail_alerted).toBe(false);
      expect(alertState['moonlight-max'].fetch_failing).toBe(false);
    });

    it('carries stored last_good percentages onto a benched inactive row', async () => {
      seedAccounts({
        'moonlight-max': { benched: true },
      });
      atomicWriteSync(multiAccountUsagePath(), JSON.stringify({
        generated_at: '2026-06-11T03:00:00.000Z',
        accounts: [{
          account: 'moonlight-max',
          ok: false,
          error: 'HTTP 403',
          fetched_at: '2026-06-11T03:00:00.000Z',
          last_good: {
            five_hour_pct: 44,
            seven_day_pct: 12,
            fetched_at: '2026-06-11T02:45:00.000Z',
          },
        }],
      }, null, 2));

      const row = (await checkAllUsage(ctxRoot)).accounts[0];

      expect(row).toMatchObject({
        account: 'moonlight-max',
        ok: true,
        benched: true,
        status: 'benched',
        five_hour_pct: 44,
        seven_day_pct: 12,
        last_good: {
          five_hour_pct: 44,
          seven_day_pct: 12,
          fetched_at: '2026-06-11T02:45:00.000Z',
        },
      });
    });

    it('omits live usage percentages on a benched inactive row when no last_good exists', async () => {
      seedAccounts({
        'moonlight-max': { benched: true },
      });

      const row = (await checkAllUsage(ctxRoot)).accounts[0];

      expect(row.ok).toBe(true);
      expect(row.status).toBe('benched');
      expect(row.five_hour_pct).toBeUndefined();
      expect(row.seven_day_pct).toBeUndefined();
      expect(row.last_good).toBeUndefined();
    });

    it('still fetches non-benched accounts with credentials', async () => {
      seedAccounts({
        'icloud-max-20x': { source: 'pkce-authorize', token: 'sk-ant-oat01-PKCESECRETwTOK' },
      });
      const fetchMock = stubUsageResponses([{
        five_hour: { utilization: 11, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 22, resets_at: '2026-06-15T00:00:00Z' },
      }]);

      const row = (await checkAllUsage(ctxRoot)).accounts[0];

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(row).toMatchObject({
        account: 'icloud-max-20x',
        ok: true,
        benched: false,
        five_hour_pct: 11,
        seven_day_pct: 22,
      });
      expect(row.status).toBeUndefined();
    });

    it('still reports non-benched accounts without credentials as fetch failures', async () => {
      seedAccounts({
        'icloud-max-20x': {},
      });

      const row = (await checkAllUsage(ctxRoot)).accounts[0];

      expect(row).toMatchObject({
        account: 'icloud-max-20x',
        ok: false,
        benched: false,
        error: 'no usage_credential',
      });
    });

    it('keeps last_good when an impossible read replaces a prior good row', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-11T03:05:00.000Z'));
      seedAccounts({
        'cg-team-seat': { source: 'pkce-authorize', token: 'sk-ant-oat01-PKCESECRETwTOK' },
      });
      atomicWriteSync(multiAccountUsagePath(), JSON.stringify({
        generated_at: '2026-06-11T03:00:00.000Z',
        accounts: [{
          account: 'cg-team-seat',
          ok: true,
          five_hour_pct: 44,
          seven_day_pct: 12,
          five_hour_resets: '2026-06-11T05:00:00Z',
          seven_day_resets: '2026-06-15T00:00:00Z',
          fetched_at: '2026-06-11T03:00:00.000Z',
          credential_source: 'pkce-authorize',
          credential_fingerprint: 'sk-ant-oat01-P...wTOK',
        }],
      }, null, 2));
      stubUsageResponses([{
        five_hour: { utilization: 5, resets_at: null },
        seven_day: { utilization: 5, resets_at: null },
      }]);

      const result = await checkAllUsage(ctxRoot);
      const row = result.accounts[0];
      expect(row.ok).toBe(false);
      expect(row.status).toBe('impossible-read');
      expect(row.last_good).toMatchObject({
        five_hour_pct: 44,
        seven_day_pct: 12,
        fetched_at: '2026-06-11T03:00:00.000Z',
      });
      expect(row.last_good?.credential_fingerprint).toBe(hash8('sk-ant-oat01-P...wTOK'));
      expect(result.alerts.some((a) => a.includes('USAGE-FETCH-FAIL cg-team-seat'))).toBe(false);
      const alertState = readJson(join(ctxRoot, 'state', 'usage', 'alert-state.json')) as {
        'cg-team-seat': { fail_consecutive: number; fetch_fail_alerted: boolean };
      };
      expect(alertState['cg-team-seat'].fail_consecutive).toBe(1);
      expect(alertState['cg-team-seat'].fetch_fail_alerted).toBe(false);
      expect(JSON.stringify(row)).not.toContain('PKCESECRET');
      expect(JSON.stringify(row)).not.toContain('sk-ant');
    });

    it('writes an impossible-read diagnostic entry with shape, cause, and no token material', async () => {
      seedAccounts({
        'cg-team-seat': { source: 'pkce-authorize', token: 'sk-ant-oat01-PKCESECRETwTOK' },
      });
      stubUsageResponses([{
        five_hour: { utilization: 5, resets_at: null },
        seven_day: { utilization: 5, resets_at: null },
      }]);

      await checkAllUsage(ctxRoot);

      const entries = readDiagnostics();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        account: 'cg-team-seat',
        credential_source: 'pkce-authorize',
        credential_fingerprint: hash8('sk-ant-oat01-PKCESECRETwTOK'),
        failure: 'impossible-read',
        status: 'impossible-read',
      });
      expect(entries[0].suggested_cause).toContain('null resets_at');
      expect(entries[0].which_check).toContain('utilization without resets_at');
      expect(JSON.stringify(entries[0])).toContain('has_utilization');
      expect(JSON.stringify(entries[0])).not.toContain('PKCESECRET');
      expect(JSON.stringify(entries[0])).not.toContain('sk-ant');
    });

    it('flags an implausible 7d rise within one cycle as suspect', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-11T03:05:00.000Z'));
      seedAccounts({
        moonlight: { source: 'pkce-authorize', token: 'sk-ant-oat01-MOONSECRETwTOK' },
      });
      atomicWriteSync(join(ctxRoot, 'state', 'usage', 'multi-account-usage.json'), JSON.stringify({
        generated_at: '2026-06-11T03:00:00.000Z',
        accounts: [{
          account: 'moonlight',
          ok: true,
          five_hour_pct: 7,
          seven_day_pct: 2,
          five_hour_resets: '2026-06-11T05:00:00Z',
          seven_day_resets: '2026-06-15T00:00:00Z',
          fetched_at: '2026-06-11T03:00:00.000Z',
        }],
      }, null, 2));
      stubUsageResponses([{
        five_hour: { utilization: 7, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 100, resets_at: '2026-06-15T00:00:00Z' },
      }]);

      const row = (await checkAllUsage(ctxRoot)).accounts[0];
      expect(row.ok).toBe(false);
      expect(row.status).toBe('suspect');
      expect(row.suspect).toBe(true);
      expect(row.last_good?.seven_day_pct).toBe(2);
      expect(JSON.stringify(row)).not.toContain('MOONSECRET');
      expect(JSON.stringify(row)).not.toContain('sk-ant');
    });

    it('writes a suspect diagnostic entry for a 7d spike with a mislabel cause', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-11T03:05:00.000Z'));
      seedAccounts({
        moonlight: { source: 'pkce-authorize', token: 'sk-ant-oat01-MOONSECRETwTOK' },
      });
      atomicWriteSync(join(ctxRoot, 'state', 'usage', 'multi-account-usage.json'), JSON.stringify({
        generated_at: '2026-06-11T03:00:00.000Z',
        accounts: [{
          account: 'moonlight',
          ok: true,
          five_hour_pct: 7,
          seven_day_pct: 2,
          five_hour_resets: '2026-06-11T05:00:00Z',
          seven_day_resets: '2026-06-15T00:00:00Z',
          fetched_at: '2026-06-11T03:00:00.000Z',
        }],
      }, null, 2));
      stubUsageResponses([{
        five_hour: { utilization: 7, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 100, resets_at: '2026-06-15T00:00:00Z' },
      }]);

      await checkAllUsage(ctxRoot);

      const [entry] = readDiagnostics();
      expect(entry.failure).toBe('suspect');
      expect(entry.error).toContain('7d rose');
      expect(entry.suggested_cause).toContain('cross-account credential mislabel');
      expect(entry.prior).toMatchObject({ seven_day_pct: 2, fetched_at: '2026-06-11T03:00:00.000Z' });
      expect(JSON.stringify(entry)).not.toContain('MOONSECRET');
      expect(JSON.stringify(entry)).not.toContain('sk-ant');
    });

    it('writes a fetch-fail diagnostic entry with the HTTP 401 auth cause', async () => {
      seedAccounts({
        'icloud-max-20x': { source: 'keychain-capture', token: 'sk-ant-oat01-STOREDSECRETwTOK' },
      });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

      await checkAllUsage(ctxRoot, () => ({
        accessToken: 'sk-ant-oat01-LIVESECRETwNEW',
        refreshToken: 'rt-live',
        expiresAt: Date.now() + 3600_000,
        scopes: ['user:profile'],
      }));

      const [entry] = readDiagnostics();
      expect(entry).toMatchObject({
        account: 'icloud-max-20x',
        failure: 'fetch-fail',
        error: 'HTTP 401',
        credential_source: 'keychain-capture',
        credential_fingerprint: hash8('sk-ant-oat01-LIVESECRETwNEW'),
      });
      expect(entry.suggested_cause).toContain('Auth rejected');
      expect(JSON.stringify(entry)).not.toContain('LIVESECRET');
      expect(JSON.stringify(entry)).not.toContain('sk-ant');
    });

    it('writes a no-credential diagnostic entry', async () => {
      await checkAllUsage(ctxRoot);

      const [entry] = readDiagnostics();
      expect(entry).toMatchObject({
        account: 'cg-team-seat',
        credential_source: null,
        credential_fingerprint: null,
        failure: 'no-credential',
        error: 'no usage_credential',
      });
      expect(entry.suggested_cause).toContain('capture-usage-credential');
      expect(JSON.stringify(entry)).not.toContain('sk-ant');
    });

    it('writes nothing for an all-ok cycle', async () => {
      seedAccounts({
        'icloud-max-20x': { source: 'pkce-authorize', token: 'sk-ant-oat01-PKCESECRETwTOK' },
      });
      stubUsageResponses([{
        five_hour: { utilization: 1, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 2, resets_at: '2026-06-15T00:00:00Z' },
      }]);

      await checkAllUsage(ctxRoot);

      expect(existsSync(diagnosticsPath())).toBe(false);
    });

    it('keeps diagnostics best-effort when the diagnostic write throws', async () => {
      seedAccounts({
        'icloud-max-20x': { source: 'pkce-authorize', token: 'sk-ant-oat01-PKCESECRETwTOK' },
      });
      mkdirSync(join(ctxRoot, 'state', 'usage'), { recursive: true });
      mkdirSync(diagnosticsPath());
      stubUsageResponses([{
        five_hour: { utilization: 5, resets_at: null },
        seven_day: { utilization: 5, resets_at: null },
      }]);

      const result = await checkAllUsage(ctxRoot);

      expect(result.accounts[0].ok).toBe(false);
      expect(existsSync(join(ctxRoot, 'state', 'usage', 'multi-account-usage.json'))).toBe(true);
    });

    it('caps diagnostics.jsonl to the last 500 entries', async () => {
      seedAccounts({
        'icloud-max-20x': { source: 'pkce-authorize', token: 'sk-ant-oat01-PKCESECRETwTOK' },
      });
      mkdirSync(join(ctxRoot, 'state', 'usage'), { recursive: true });
      const existing = Array.from({ length: 505 }, (_, i) => JSON.stringify({ ts: NOW, account: `old-${i}` })).join('\n');
      atomicWriteSync(diagnosticsPath(), existing);
      stubUsageResponses([{
        five_hour: { utilization: 5, resets_at: null },
        seven_day: { utilization: 5, resets_at: null },
      }]);

      await checkAllUsage(ctxRoot);

      const entries = readDiagnostics();
      expect(entries).toHaveLength(500);
      expect(entries[0].account).toBe('old-6');
      expect(entries.at(-1)?.account).toBe('icloud-max-20x');
    });

    it('does not carry forward a legacy diagnostic line containing sk-ant material', async () => {
      seedAccounts({
        'icloud-max-20x': { source: 'pkce-authorize', token: 'sk-ant-oat01-PKCESECRETwTOK' },
      });
      mkdirSync(join(ctxRoot, 'state', 'usage'), { recursive: true });
      atomicWriteSync(
        diagnosticsPath(),
        `${JSON.stringify({ account: 'legacy', credential_fingerprint: 'sk-ant-oat01-LEAK' })}\n${JSON.stringify({ account: 'safe-old' })}`,
      );
      stubUsageResponses([{
        five_hour: { utilization: 5, resets_at: null },
        seven_day: { utilization: 5, resets_at: null },
      }]);

      await checkAllUsage(ctxRoot);

      const entries = readDiagnostics();
      expect(entries.map((entry) => entry.account)).toEqual(['safe-old', 'icloud-max-20x']);
      expect(JSON.stringify(entries)).not.toContain('sk-ant');
      expect(JSON.stringify(entries)).not.toContain('PKCESECRET');
    });

    it('allows a 5h zero-drop after the prior reset timestamp has passed', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-11T03:05:00.000Z'));
      seedAccounts({
        seat: { source: 'pkce-authorize', token: 'sk-ant-oat01-SEATSECRETwTOK' },
      });
      atomicWriteSync(join(ctxRoot, 'state', 'usage', 'multi-account-usage.json'), JSON.stringify({
        generated_at: '2026-06-11T03:00:00.000Z',
        accounts: [{
          account: 'seat',
          ok: true,
          five_hour_pct: 100,
          seven_day_pct: 10,
          five_hour_resets: '2026-06-11T03:04:00.000Z',
          seven_day_resets: '2026-06-15T00:00:00Z',
          fetched_at: '2026-06-11T03:00:00.000Z',
        }],
      }, null, 2));
      stubUsageResponses([{
        five_hour: { utilization: 0, resets_at: '2026-06-11T08:04:00Z' },
        seven_day: { utilization: 10, resets_at: '2026-06-15T00:00:00Z' },
      }]);

      const row = (await checkAllUsage(ctxRoot)).accounts[0];
      expect(row.ok).toBe(true);
      expect(row.status).toBeUndefined();
      expect(row.five_hour_pct).toBe(0);
    });

    it('does not delta-flag first-ever reads with no prior snapshot', async () => {
      seedAccounts({
        moonlight: { source: 'pkce-authorize', token: 'sk-ant-oat01-MOONSECRETwTOK' },
      });
      stubUsageResponses([{
        five_hour: { utilization: 80, resets_at: '2026-06-11T05:00:00Z' },
        seven_day: { utilization: 100, resets_at: '2026-06-15T00:00:00Z' },
      }]);

      const row = (await checkAllUsage(ctxRoot)).accounts[0];
      expect(row.ok).toBe(true);
      expect(row.suspect).toBeUndefined();
    });

    it('incident replay: original zero-null snapshot plus moonlight mislabel writes four diagnostics', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-13T03:05:00.000Z'));
      seedAccounts({
        'cg-team-seat': { source: 'pkce-authorize', token: 'sk-ant-oat01-SEATSECRETwTOK' },
        'icloud-max-20x': { source: 'pkce-authorize', token: 'sk-ant-oat01-ICLOUDSECRETwTOK' },
        'me-com-max': { source: 'pkce-authorize', token: 'sk-ant-oat01-MECOMSECRETwTOK' },
        'moonlight-max': { source: 'keychain-capture', token: 'sk-ant-oat01-MOONOLDSECRETwTOK' },
      });
      atomicWriteSync(join(ctxRoot, 'state', 'usage', 'multi-account-usage.json'), JSON.stringify({
        generated_at: '2026-06-13T03:00:00.000Z',
        accounts: [{
          account: 'moonlight-max',
          ok: true,
          five_hour_pct: 7,
          seven_day_pct: 2,
          five_hour_resets: '2026-06-13T06:39:59Z',
          seven_day_resets: '2026-06-18T18:59:59Z',
          fetched_at: '2026-06-13T03:00:00.000Z',
        }],
      }, null, 2));
      stubUsageResponses([
        { five_hour: { utilization: 5, resets_at: null }, seven_day: { utilization: 5, resets_at: null } },
        { five_hour: { utilization: 5, resets_at: null }, seven_day: { utilization: 5, resets_at: null } },
        { five_hour: { utilization: 5, resets_at: null }, seven_day: { utilization: 5, resets_at: null } },
        {
          five_hour: { utilization: 7, resets_at: '2026-06-13T06:39:59Z' },
          seven_day: { utilization: 100, resets_at: '2026-06-18T18:59:59Z' },
        },
      ]);

      const result = await checkAllUsage(ctxRoot, () => ({
        accessToken: 'sk-ant-oat01-MOONLIVESECRETwTOK',
        refreshToken: 'rt-live',
        expiresAt: Date.now() + 3600_000,
        scopes: ['user:profile'],
      }));
      const impossible = result.accounts.filter((row) => row.status === 'impossible-read').map((row) => row.account);
      expect(impossible).toEqual(['cg-team-seat', 'icloud-max-20x', 'me-com-max']);
      expect(result.accounts.find((row) => row.account === 'moonlight-max')).toMatchObject({
        ok: false,
        status: 'suspect',
        credential_source: 'keychain-capture',
      });
      const diagnostics = readDiagnostics();
      expect(diagnostics).toHaveLength(4);
      expect(diagnostics.filter((entry) => entry.failure === 'impossible-read')).toHaveLength(3);
      expect(diagnostics.find((entry) => entry.account === 'moonlight-max')).toMatchObject({
        failure: 'suspect',
        credential_source: 'keychain-capture',
      });
      expect(JSON.stringify(diagnostics)).toContain('cross-account credential mislabel');
      expect(JSON.stringify(result)).not.toContain('SEATSECRET');
      expect(JSON.stringify(result)).not.toContain('ICLOUDSECRET');
      expect(JSON.stringify(result)).not.toContain('MECOMSECRET');
      expect(JSON.stringify(result)).not.toContain('MOONLIVESECRET');
      expect(JSON.stringify(result)).not.toContain('sk-ant');
      expect(JSON.stringify(diagnostics)).not.toContain('SEATSECRET');
      expect(JSON.stringify(diagnostics)).not.toContain('ICLOUDSECRET');
      expect(JSON.stringify(diagnostics)).not.toContain('MECOMSECRET');
      expect(JSON.stringify(diagnostics)).not.toContain('MOONLIVESECRET');
      expect(JSON.stringify(diagnostics)).not.toContain('sk-ant');
    });
  });

  describe('assertGrantedScopeSafe (fail-closed post-grant assertion)', () => {
    it('STORES (returns scopes) on a confirmed drop - scope present, no org:create_api_key', () => {
      const got = assertGrantedScopeSafe('user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload');
      expect(got).toContain('user:inference');
      expect(got).not.toContain('org:create_api_key');
    });

    it('TRIPS when granted scope INCLUDES org:create_api_key (key-mint present)', () => {
      expect(() => assertGrantedScopeSafe('org:create_api_key user:profile user:inference'))
        .toThrow(/GRANT-ASSERTION TRIP.*key-mint/);
    });

    it('TRIPS when the scope field is ABSENT (RFC6749: grant==request==key-mint, unconfirmable)', () => {
      expect(() => assertGrantedScopeSafe(undefined)).toThrow(/GRANT-ASSERTION TRIP.*omitted/);
    });

    it('TRIPS when the scope field is EMPTY/whitespace (unconfirmable)', () => {
      expect(() => assertGrantedScopeSafe('   ')).toThrow(/GRANT-ASSERTION TRIP/);
    });
  });

  describe('beginUsageAuth', () => {
    it('writes a 0600 pending file and returns a PKCE authorize URL without the verifier', () => {
      const r = beginUsageAuth(ctxRoot, 'me-com-max');
      // Consumer/Max authorize host (claude.com/cai) from the live binary.
      expect(r.url).toContain('https://claude.com/cai/oauth/authorize');
      expect(r.url).toContain('code_challenge_method=S256');
      // Full canonical Zq8 set is requested (post-grant assertion enforces at-rest class).
      expect(r.url).toContain(encodeURIComponent('org:create_api_key'));
      expect(r.url).toContain(encodeURIComponent('user:profile'));
      const path = join(ctxRoot, 'state', 'oauth', 'pending-usage-auth.json');
      expect(existsSync(path)).toBe(true);
      expect((statSync(path).mode & 0o777)).toBe(0o600);
      const pending = JSON.parse(readFileSync(path, 'utf-8'));
      expect(pending.account).toBe('me-com-max');
      // The verifier must never appear in the URL (only its S256 challenge).
      expect(r.url).not.toContain(pending.verifier);
    });

    it('honors a custom scope set with URLSearchParams (+) encoding', () => {
      const r = beginUsageAuth(ctxRoot, 'x', 'org:create_api_key user:profile user:inference');
      // URLSearchParams serializes spaces as + (matches the real client), not %20.
      expect(r.url).toContain('scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference');
    });

    it('emits scope spaces as + and a 43-char state (byte-match the real client)', () => {
      const r = beginUsageAuth(ctxRoot, 'me-com-max');
      const u = new URL(r.url);
      expect(u.searchParams.get('state')!.length).toBe(43);
      // The raw query keeps + for the scope separators (not %20).
      expect(r.url).toMatch(/scope=[^&]*\+[^&]*\+/);
      expect(r.url).not.toContain('%20');
    });
  });
});
