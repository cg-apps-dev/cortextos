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

  describe('evaluateAlerts', () => {
    const base: AccountUsage = { account: 'a', ok: true, fetched_at: NOW };

    it('fires 5h and 7d threshold alerts strictly above the thresholds', () => {
      const { alerts } = evaluateAlerts([
        { ...base, five_hour_pct: USAGE_ALERT_5H_PCT + 1, seven_day_pct: USAGE_ALERT_7D_PCT + 1 },
      ], {}, NOW);
      expect(alerts.some(a => a.startsWith('5H'))).toBe(true);
      expect(alerts.some(a => a.startsWith('7D'))).toBe(true);
    });

    it('stays quiet at exactly the thresholds', () => {
      const { alerts } = evaluateAlerts([
        { ...base, five_hour_pct: USAGE_ALERT_5H_PCT, seven_day_pct: USAGE_ALERT_7D_PCT },
      ], {}, NOW);
      expect(alerts).toEqual([]);
    });

    it('detects RISING extra-usage credits (the silent-billing detector)', () => {
      const usage: AccountUsage = { ...base, extra_usage: { is_enabled: true, used_credits: 7 } };
      const { alerts, nextExtra } = evaluateAlerts(
        [usage], { a: { used_credits: 3, at: NOW } }, NOW,
      );
      expect(alerts.some(a => a.includes('RISING 3 -> 7'))).toBe(true);
      expect(nextExtra.a.used_credits).toBe(7);
    });

    it('first sighting with credits already used alerts immediately', () => {
      const { alerts } = evaluateAlerts(
        [{ ...base, extra_usage: { is_enabled: true, used_credits: 5 } }], {}, NOW,
      );
      expect(alerts.some(a => a.includes('first sighting'))).toBe(true);
    });

    it('enabled-but-zero-credits gets a watch alert, not silence', () => {
      const { alerts } = evaluateAlerts(
        [{ ...base, extra_usage: { is_enabled: true, used_credits: 0 } }], {}, NOW,
      );
      expect(alerts.some(a => a.includes('watch'))).toBe(true);
    });

    it('flat credits stay VISIBLE as an explicit FLAT watch line (never overstated, never silent)', () => {
      const { alerts } = evaluateAlerts(
        [{ ...base, extra_usage: { is_enabled: true, used_credits: 5 } }],
        { a: { used_credits: 5, at: NOW } }, NOW,
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('meter FLAT at 5');
      expect(alerts[0]).toContain('delta +0');
    });

    it('rising credits carry the burn-rate delta + last-read PT time', () => {
      const { alerts } = evaluateAlerts(
        [{ ...base, extra_usage: { is_enabled: true, used_credits: 12 } }],
        { a: { used_credits: 7, at: '2026-06-11T02:00:00.000Z' } }, NOW,
      );
      expect(alerts[0]).toContain('RISING 7 -> 12');
      expect(alerts[0]).toContain('delta +5 since');
      expect(alerts[0]).toContain('PT');
    });

    it('a failed account fetch is an ALERT, never silent (monitoring-blind detector)', () => {
      const { alerts } = evaluateAlerts(
        [{ account: 'b', ok: false, error: 'HTTP 403', fetched_at: NOW }], {}, NOW,
      );
      expect(alerts.some(a => a.includes('USAGE-FETCH-FAIL b'))).toBe(true);
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
