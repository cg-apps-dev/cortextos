import { describe, expect, it } from 'vitest';
import {
  computePromotionCandidates,
  degradeTier,
  deriveTiers,
  weakerTier,
  type AgentClusterRow,
} from '../../../src/bus/account-tiers';

function row(overrides: Partial<AgentClusterRow>): AgentClusterRow {
  return {
    agent: 'a1',
    account: 'acct',
    cluster_id: 'cluster-a',
    pkce_match: false,
    source: 'override',
    ...overrides,
  };
}

describe('deriveTiers', () => {
  it('marks pkce clusters confirmed even for a singleton', () => {
    expect(deriveTiers([row({ pkce_match: true })])[0].tier).toBe('CONFIRMED-PKCE');
  });

  it('marks consistent clusters with two or more agents asserted', () => {
    const tiers = deriveTiers([
      row({ agent: 'a1' }),
      row({ agent: 'a2' }),
    ]);

    expect(tiers.map((t) => t.tier)).toEqual(['ASSERTED', 'ASSERTED']);
    expect(tiers[0].cluster_size).toBe(2);
    expect(tiers[0].label_consistent).toBe(true);
  });

  it('marks singletons unverified', () => {
    expect(deriveTiers([row({})])[0].tier).toBe('UNVERIFIED');
  });

  it('marks label-inconsistent clusters unverified', () => {
    const tiers = deriveTiers([
      row({ agent: 'a1', account: 'acct-a' }),
      row({ agent: 'a2', account: 'acct-b' }),
    ]);

    expect(tiers.map((t) => t.tier)).toEqual(['UNVERIFIED', 'UNVERIFIED']);
    expect(tiers[0].label_consistent).toBe(false);
  });

  it('keeps login-marker unverified even if clustered', () => {
    const tiers = deriveTiers([
      row({ agent: 'a1', source: 'login-marker' }),
      row({ agent: 'a2', source: 'login-marker' }),
    ]);

    expect(tiers.map((t) => t.tier)).toEqual(['UNVERIFIED', 'UNVERIFIED']);
  });

  it('applies confirmed correlation only via override', () => {
    expect(deriveTiers([row({ agent: 'a1' }), row({ agent: 'a2' })])[0].tier).toBe('ASSERTED');
    expect(deriveTiers([row({ agent: 'a1' }), row({ agent: 'a2' })], {
      a1: { tier: 'CONFIRMED-CORRELATION', note: 'security reviewed' },
    })[0].tier).toBe('CONFIRMED-CORRELATION');
  });

  it('does not apply cluster-id keyed overrides because security keys by durable agent name', () => {
    expect(deriveTiers([row({ agent: 'a1' }), row({ agent: 'a2' })], {
      'cluster-a': { tier: 'CONFIRMED-CORRELATION', note: 'stale token hash key' },
    })[0].tier).toBe('ASSERTED');
  });

  it('supports stale demotion and weakest tier comparisons', () => {
    expect(degradeTier('CONFIRMED-PKCE')).toBe('CONFIRMED-CORRELATION');
    expect(degradeTier('CONFIRMED-CORRELATION')).toBe('ASSERTED');
    expect(degradeTier('ASSERTED')).toBe('UNVERIFIED');
    expect(degradeTier('UNVERIFIED')).toBe('UNVERIFIED');
    expect(weakerTier('ASSERTED', 'CONFIRMED-PKCE')).toBe('ASSERTED');
  });
});

describe('computePromotionCandidates', () => {
  it('emits full evidence and prefers nested spend percent for asserted clusters', () => {
    const rows = [
      row({ agent: 'a1', account: 'acct' }),
      row({ agent: 'a2', account: 'acct' }),
    ];

    expect(computePromotionCandidates(rows, [
      { account: 'acct', seven_day_pct: 4, five_hour_pct: 12, spend: { percent: 44 }, spend_pct: 55, extra_usage: { used_credits: 90 } },
    ], [
      { account: 'acct', seven_day_pct: 0 },
    ])).toEqual([{
      cluster_id: 'cluster-a',
      target_account: 'acct',
      seven_day_delta: 4,
      five_hour_pct: 12,
      spend_pct_or_extra_usage: 44,
      no_other_cluster_guard: 'pass',
    }]);
  });

  it('uses top-level spend_pct when nested spend percent is absent', () => {
    const rows = [
      row({ agent: 'a1', account: 'acct' }),
      row({ agent: 'a2', account: 'acct' }),
    ];

    expect(computePromotionCandidates(rows, [
      { account: 'acct', seven_day_pct: 4, spend_pct: 55, extra_usage: { used_credits: 90 } },
    ], [
      { account: 'acct', seven_day_pct: 0 },
    ])[0]?.spend_pct_or_extra_usage).toBe(55);
  });

  it('falls back to extra usage credits when spend_pct is absent', () => {
    const rows = [
      row({ agent: 'a1', account: 'acct' }),
      row({ agent: 'a2', account: 'acct' }),
    ];

    expect(computePromotionCandidates(rows, [
      { account: 'acct', seven_day_pct: 4, extra_usage: { used_credits: 90 } },
    ], [
      { account: 'acct', seven_day_pct: 0 },
    ])[0]?.spend_pct_or_extra_usage).toBe(90);
  });

  it('does not emit when another cluster maps to the same target account', () => {
    const rows = [
      row({ agent: 'a1', account: 'acct' }),
      row({ agent: 'a2', account: 'acct' }),
      row({ agent: 'a3', account: 'acct', cluster_id: 'cluster-b' }),
      row({ agent: 'a4', account: 'acct', cluster_id: 'cluster-b' }),
    ];

    expect(computePromotionCandidates(rows, [
      { account: 'acct', seven_day_pct: 4, five_hour_pct: 12 },
    ], [
      { account: 'acct', seven_day_pct: 0 },
    ])).toEqual([]);
  });

  it('candidate signal never changes the tier', () => {
    const rows = [
      row({ agent: 'a1', account: 'acct' }),
      row({ agent: 'a2', account: 'acct' }),
    ];
    const candidate = computePromotionCandidates(rows, [
      { account: 'acct', seven_day_pct: 4, five_hour_pct: 12 },
    ], [
      { account: 'acct', seven_day_pct: 0 },
    ])[0];

    expect(deriveTiers(rows, {}, { [candidate.cluster_id]: candidate })[0].tier).toBe('ASSERTED');
    expect(deriveTiers(rows, {}, { [candidate.cluster_id]: candidate })[0].promotion_candidate).toEqual(candidate);
  });
});
