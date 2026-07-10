import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentAccountMatrix, switchBreadcrumbText } from '../agent-account-matrix';
import type { SwitchJobSummary } from '@/lib/account-switch';
import type { AgentAccountMatrixGroup } from '@/lib/data/reports';

function job(status: SwitchJobSummary['status'], overrides: Partial<SwitchJobSummary> = {}): SwitchJobSummary {
  return {
    jobId: `${status}-job`,
    agent: 'the-analyst',
    targetAccount: 'moonlight-max',
    sourceAccount: 'me-com-max',
    status,
    startedAt: '2026-07-10T05:00:00.000Z',
    startedAtMs: 1_000,
    elapsedMs: 42_000,
    ...overrides,
  };
}

describe('AgentAccountMatrix switch breadcrumb', () => {
  it('describes an in-flight planned restart on the matrix row', () => {
    expect(switchBreadcrumbText(job('running'))).toBe('Switching to moonlight-max (42s)');
  });

  it('describes terminal success and failure states from server-provided jobs', () => {
    expect(switchBreadcrumbText(job('succeeded'))).toBe('Switched to moonlight-max');
    expect(switchBreadcrumbText(job('failed', { resultSummary: 'Switch failed before any change - the-analyst untouched.' })))
      .toBe('Switch failed before any change - the-analyst untouched.');
  });

  it('renders suspect as amber-distinct and not as success or failure', () => {
    expect(switchBreadcrumbText(job('suspect'))).toBe('Attribution NOT confirmed - moonlight-max? investigate');
    const groups: AgentAccountMatrixGroup[] = [{
      key: 'account:me-com-max',
      label: 'me-com-max',
      account: 'me-com-max',
      section: 'account',
      tier: 'CONFIRMED-PKCE',
      source: 'live',
      pendingRestartCount: 0,
      rows: [{
        agent: 'analyst',
        agentId: 'the-analyst',
        account: 'me-com-max',
        source: 'live',
        tier: 'CONFIRMED-PKCE',
        pending_restart: false,
        section: 'account',
      }],
    }];
    const html = renderToStaticMarkup(createElement(AgentAccountMatrix, {
      groups,
      vaultAccounts: [{ account: 'moonlight-max', hasToken: true }],
      switchJobsByAgent: { 'the-analyst': job('suspect') },
    }));

    expect(html).toContain('text-amber-700');
    expect(html).toContain('Attribution NOT confirmed');
    expect(html).not.toContain('text-emerald-600\">Attribution NOT confirmed');
    expect(html).not.toContain('text-destructive\">Attribution NOT confirmed');
  });
});
