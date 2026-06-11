import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  fingerprint,
  ptTime,
  parseUsageResponse,
  evaluateAlerts,
  captureKeychainUsageCredential,
  resolveUsageToken,
  beginUsageAuth,
  assertGrantedScopeSafe,
  USAGE_ALERT_5H_PCT,
  USAGE_ALERT_7D_PCT,
  type AccountUsage,
} from '../../../src/bus/usage-accounts';
import { atomicWriteSync } from '../../../src/utils/atomic';

const NOW = '2026-06-11T03:00:00.000Z';

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
  afterEach(() => { rmSync(ctxRoot, { recursive: true, force: true }); });

  describe('fingerprint', () => {
    it('never reveals the token middle', () => {
      const t = 'sk-ant-oat01-mABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789wQAA';
      const f = fingerprint(t);
      expect(f).toBe('sk-ant-oat01-m...wQAA');
      expect(f.length).toBeLessThan(25);
    });
    it('handles short/empty safely', () => {
      expect(fingerprint('')).toBe('(empty)');
      expect(fingerprint('short')).toBe('shor...');
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

    it('normalizes 0-1 fractional utilization to percent', () => {
      const u = parseUsageResponse('seat', { five_hour: { utilization: 0.85 } }, NOW);
      expect(u.five_hour_pct).toBe(85);
    });

    it('tolerates missing extra_usage', () => {
      const u = parseUsageResponse('seat', { five_hour: { utilization: 10 } }, NOW);
      expect(u.extra_usage).toBeUndefined();
    });
  });

  describe('evaluateAlerts (edge-triggered dedup)', () => {
    const base: AccountUsage = { account: 'a', ok: true, fetched_at: NOW };
    // Build a prev alert-state for account 'a'.
    const st = (o: Partial<{ five_h_over: boolean; seven_d_over: boolean; extra_enabled: boolean; extra_credits: number; fetch_failing: boolean }>) => ({
      a: { five_h_over: false, seven_d_over: false, extra_enabled: false, extra_credits: 0, fetch_failing: false, at: '2026-06-11T02:00:00.000Z', ...o },
    });

    it('fires 5h + 7d on the CROSS-UP edge from empty state', () => {
      const { alerts, nextState } = evaluateAlerts([
        { ...base, five_hour_pct: USAGE_ALERT_5H_PCT + 1, seven_day_pct: USAGE_ALERT_7D_PCT + 1 },
      ], {}, NOW);
      expect(alerts.some(a => a.startsWith('5H'))).toBe(true);
      expect(alerts.some(a => a.startsWith('7D'))).toBe(true);
      expect(nextState.a.five_h_over).toBe(true);
      expect(nextState.a.seven_d_over).toBe(true);
    });

    it('QUIETS a persistent over-threshold (the 15-min no-spam case)', () => {
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

    it('fetch-fail fires on the failure EDGE then QUIETS while persistent, RECOVERS on restore', () => {
      const failing = { account: 'b', ok: false, error: 'HTTP 403', fetched_at: NOW };
      const first = evaluateAlerts([failing], {}, NOW);
      expect(first.alerts.some(a => a.includes('USAGE-FETCH-FAIL b'))).toBe(true);
      const second = evaluateAlerts([failing], first.nextState, NOW);
      expect(second.alerts).toEqual([]); // persistent failure -> quiet
      const recovered = evaluateAlerts([{ account: 'b', ok: true, fetched_at: NOW }], second.nextState, NOW);
      expect(recovered.alerts.some(a => a.startsWith('RECOVERED') && a.includes('fetch restored'))).toBe(true);
    });

    it('a failing fetch does NOT reset the 5h/7d/extra edges (carried forward)', () => {
      const prev = st({ seven_d_over: true, extra_enabled: true, extra_credits: 100 });
      const { nextState } = evaluateAlerts([{ account: 'a', ok: false, error: 'HTTP 500', fetched_at: NOW }], prev, NOW);
      expect(nextState.a.seven_d_over).toBe(true);
      expect(nextState.a.extra_enabled).toBe(true);
      expect(nextState.a.extra_credits).toBe(100);
      expect(nextState.a.fetch_failing).toBe(true);
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
      expect(r.fingerprint).toBe('sk-ant-oat01-m...wQAA');
      expect(JSON.stringify(r)).not.toContain('SECRET');
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
