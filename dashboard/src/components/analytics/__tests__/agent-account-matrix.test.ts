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

describe('AgentAccountMatrix responsive structure', () => {
  const groups: AgentAccountMatrixGroup[] = [
    {
      key: 'account:me-com-max',
      label: 'me-com-max',
      account: 'me-com-max',
      section: 'account',
      tier: 'CONFIRMED-PKCE',
      source: 'live',
      pendingRestartCount: 1,
      rows: [
        {
          agent: 'analyst',
          agentId: 'the-analyst',
          account: 'me-com-max',
          source: 'live',
          tier: 'CONFIRMED-PKCE',
          pending_restart: true,
          section: 'account',
        },
      ],
    },
    {
      key: 'runtime-excluded',
      label: 'Runtime excluded',
      account: null,
      section: 'runtime-excluded',
      pendingRestartCount: 0,
      rows: [
        {
          agent: 'codex',
          agentId: 'codex-dev-agent',
          account: null,
          source: 'runtime-excluded',
          tier: 'UNVERIFIED',
          pending_restart: false,
          section: 'runtime-excluded',
        },
      ],
    },
  ];

  function renderMatrix(): string {
    return renderToStaticMarkup(createElement(AgentAccountMatrix, {
      groups,
      org: 'clean-green-marketing',
      vaultAccounts: [
        { account: 'me-com-max', hasToken: true },
        { account: 'moonlight-max', hasToken: true },
      ],
    }));
  }

  it('renders one responsive tree with desktop headers and mobile field labels', () => {
    const html = renderMatrix();

    expect(html).toContain('Agent Account Matrix');
    expect(html).toContain('Pending restart');
    expect(html).toContain('Switch');
    expect(html).toContain('Account');
    expect(html).toContain('Source');
    expect(html).toContain('Tier');
    expect(html).toContain('Pending');
  });

  it('mounts exactly one switch control for each switchable account row', () => {
    const html = renderMatrix();

    expect(html.match(/data-agent-row=/g)).toHaveLength(2);
    expect(html.match(/data-agent-switch-control=/g)).toHaveLength(1);
    expect(html).toContain('data-agent-switch-control="the-analyst"');
    expect(html).not.toContain('data-agent-switch-control="codex-dev-agent"');
  });
});
