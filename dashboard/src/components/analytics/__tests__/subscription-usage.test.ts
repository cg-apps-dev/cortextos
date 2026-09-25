import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SubscriptionUsage } from '../subscription-usage';
import type { AccountUsagePanelEntry } from '@/lib/data/reports';

const fetchedAt = '2026-06-11T18:00:00.000Z';

function account(overrides: Partial<AccountUsagePanelEntry> = {}): AccountUsagePanelEntry {
  return {
    account: 'me-com-max',
    email: 'afolker@me.com',
    plan: 'Personal Claude MAX Plan',
    ok: true,
    status: 'ok',
    five_hour_pct: 9,
    seven_day_pct: 56,
    fetched_at: fetchedAt,
    extra_usage: {
      is_enabled: true,
      used_credits: 537155,
      used_usd: 5371.55,
      cap_usd: 10000,
    },
    ...overrides,
  };
}

function renderUsage(entry: AccountUsagePanelEntry): string {
  return renderToStaticMarkup(createElement(SubscriptionUsage, {
    data: {
      generatedAt: fetchedAt,
      accounts: [entry],
      stale: false,
      newestFetchedAt: fetchedAt,
    },
    suppressPanelStatus: true,
  }));
}

describe('SubscriptionUsage extra usage staleness', () => {
  it('marks extra usage stale when the account snapshot is stale', () => {
    const html = renderUsage(account({ status: 'stale' }));

    expect(html).toContain('Metered extra usage');
    expect(html).toContain('$5,371.55');
    expect(html).toContain('stale - as of Jun 11, 11:00 AM PT');
    expect(html.match(/stale - as of/g)).toHaveLength(3);
  });

  it('does not show an extra usage stale badge for a healthy row', () => {
    const html = renderUsage(account());

    expect(html).toContain('Metered extra usage');
    expect(html).not.toContain('stale - as of');
  });
});
