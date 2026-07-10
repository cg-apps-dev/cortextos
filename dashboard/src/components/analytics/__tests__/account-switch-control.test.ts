import { describe, expect, it } from 'vitest';
import { buildSwitchRequestBody, isOrchestratorAgent } from '../account-switch-control';

describe('AccountSwitchControl request identity', () => {
  it('builds the switch POST body from the full agent id, not the display name', () => {
    const body = buildSwitchRequestBody('the-analyst', 'moonlight-max');

    expect(body).toEqual({ agent: 'the-analyst', targetAccount: 'moonlight-max' });
    expect(body.agent).not.toBe('analyst');
  });

  it('checks the orchestrator warning against the full agent id', () => {
    expect(isOrchestratorAgent('the-orchestrator')).toBe(true);
    expect(isOrchestratorAgent('orchestrator')).toBe(false);
  });
});
