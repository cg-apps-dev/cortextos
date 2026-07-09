import { describe, it, expect } from 'vitest';
import { formatOAuthAccountLines } from '../../../src/cli/bus';
import { fingerprint, type AccountUsage } from '../../../src/bus/usage-accounts';
import type { OAuthAccount } from '../../../src/bus/oauth';

const TOKEN = 'sk-ant-oat01-LISTOAUTHSECRETwTOK';
const NOW = '2026-07-08T18:07:12.000Z';
const FRESH_NOW_MS = Date.parse('2026-07-08T18:20:00.000Z');

function account(overrides: Partial<OAuthAccount> = {}): OAuthAccount {
  return {
    label: 'me-com-max',
    access_token: 'setup-token',
    refresh_token: 'refresh-token',
    expires_at: 0,
    last_refreshed: '2026-07-08T00:00:00.000Z',
    five_hour_utilization: 0,
    seven_day_utilization: 0,
    usage_credential: {
      access_token: TOKEN,
      refresh_token: 'refresh-usage',
      expires_at: Date.parse('2026-07-09T00:00:00.000Z'),
      source: 'pkce-authorize',
      captured_at: '2026-07-08T00:00:00.000Z',
    },
    ...overrides,
  };
}

function usage(overrides: Partial<AccountUsage> = {}): AccountUsage {
  return {
    account: 'me-com-max',
    ok: true,
    five_hour_pct: 10,
    seven_day_pct: 56,
    five_hour_resets: '2026-07-08T23:00:00.000Z',
    seven_day_resets: '2026-07-14T00:00:00.000Z',
    credential_fingerprint: fingerprint(TOKEN),
    credential_source: 'pkce-authorize',
    fetched_at: NOW,
    ...overrides,
  };
}

describe('list-oauth-accounts display reconciliation', () => {
  it('uses matching sampler usage instead of stale account zeros', () => {
    const lines = formatOAuthAccountLines(
      'me-com-max',
      account(),
      { active: 'other' },
      new Map([['me-com-max', usage()]]),
      FRESH_NOW_MS,
    );

    expect(lines[1]).toContain('5h: 10%');
    expect(lines[1]).toContain('7d: 56%');
    expect(lines[1]).not.toContain('stale');
    expect(lines[1]).not.toContain('5h: 0%');
    expect(lines[1]).toContain('resets: 5h 23:00Z  7d 00:00Z');
    expect(lines[1]).toContain('(sampler, fetched 18:07Z)');
  });

  it('falls back on fingerprint mismatch and renders unread zeros as n/a', () => {
    const lines = formatOAuthAccountLines(
      'me-com-max',
      account(),
      { active: 'other' },
      new Map([['me-com-max', usage({ credential_fingerprint: fingerprint('different-token') })]]),
      FRESH_NOW_MS,
    );

    expect(lines[1]).toContain('5h: n/a');
    expect(lines[1]).toContain('7d: n/a');
    expect(lines[1]).toContain('(accounts.json, stale)');
    // Anti-cross-attribution: the mismatched account's number must be truly absent.
    expect(lines[1]).not.toContain('56');
    expect(lines[1]).not.toContain('10%');
  });

  it('flags an ok:true sampler row with unparseable fetched_at as age-unknown, not confident-fresh', () => {
    const lines = formatOAuthAccountLines(
      'me-com-max',
      account(),
      { active: 'other' },
      new Map([['me-com-max', usage({ fetched_at: 'not-a-timestamp' })]]),
      FRESH_NOW_MS,
    );

    expect(lines[1]).toContain('5h: 10% (age unknown)');
    expect(lines[1]).toContain('7d: 56% (age unknown)');
  });

  it('falls back on failed sampler rows and renders unmanaged expiry without 1970', () => {
    const lines = formatOAuthAccountLines(
      'me-com-max',
      account(),
      { active: 'other' },
      new Map([['me-com-max', usage({ ok: false, error: 'no usage_credential' })]]),
      FRESH_NOW_MS,
    );

    expect(lines[1]).toContain('5h: n/a');
    expect(lines[1]).toContain('7d: n/a');
    expect(lines[1]).toContain('expires: unmanaged (setup-token)');
    expect(lines[1]).not.toContain('1970');
  });

  it('keeps real accounts.json usage, active marker, and usage credential display when no sampler exists', () => {
    const lines = formatOAuthAccountLines(
      'me-com-max',
      account({
        expires_at: Date.parse('2026-07-09T00:00:00.000Z'),
        five_hour_utilization: 0.42,
        seven_day_utilization: 0.18,
      }),
      { active: 'me-com-max' },
      new Map(),
      FRESH_NOW_MS,
    );

    expect(lines[0]).toBe('me-com-max (active)');
    expect(lines[1]).toContain('5h: 42%');
    expect(lines[1]).toContain('7d: 18%');
    expect(lines[1]).toContain('expires: 2026-07-09T00:00:00.000Z');
    expect(lines[2]).toBe(`  usage-cred: ${fingerprint(TOKEN)} (pkce-authorize) expires: 2026-07-09T00:00:00.000Z`);
  });

  it('labels stale sampler percentages instead of rendering them as fresh current values', () => {
    const lines = formatOAuthAccountLines(
      'me-com-max',
      account(),
      { active: 'other' },
      new Map([['me-com-max', usage({ fetched_at: '2026-07-08T15:07:12.000Z' })]]),
      Date.parse('2026-07-08T18:07:12.000Z'),
    );

    expect(lines[1]).toContain('5h: 10% (stale, 3h old)');
    expect(lines[1]).toContain('7d: 56% (stale, 3h old)');
    expect(lines[1]).toContain('(sampler, fetched 15:07Z)');
  });
});
