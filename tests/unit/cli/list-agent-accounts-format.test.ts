import { describe, expect, it } from 'vitest';
import { formatAgentAccountRow } from '../../../src/cli/bus';

describe('formatAgentAccountRow', () => {
  it('renders runtime-excluded rows distinctly from unresolved rows', () => {
    expect(formatAgentAccountRow({
      org: 'o1',
      agent: 'codex-dev-agent',
      account: null,
      source: 'runtime-excluded',
      reason: 'codex-app-server runtime bills the Codex plan, not a Claude account',
    })).toEqual({
      account: 'EXCLUDED',
      source: 'runtime-excluded (codex-app-server runtime bills the Codex plan, not a Claude account)',
    });
  });

  it('keeps unresolved rows generic', () => {
    expect(formatAgentAccountRow({
      org: 'o1',
      agent: 'unknown-agent',
      account: null,
      source: null,
      reason: 'agent billing account unresolved',
    })).toEqual({
      account: 'UNRESOLVED',
      source: '- (agent billing account unresolved)',
    });
  });
});
