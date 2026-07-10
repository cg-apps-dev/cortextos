import { describe, expect, it } from 'vitest';
import {
  buildSwitchRequestBody,
  initialSwitchState,
  isOrchestratorAgent,
  shouldPollInitialJob,
  switchStatusTone,
} from '../account-switch-control';
import type { SwitchJobSummary } from '@/lib/account-switch';

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

  it('resumes polling when mounted with an initial running job', () => {
    const job: SwitchJobSummary = {
      jobId: 'running-job',
      agent: 'the-analyst',
      targetAccount: 'moonlight-max',
      sourceAccount: 'me-com-max',
      status: 'running',
      startedAt: '2026-07-10T05:00:00.000Z',
      startedAtMs: 1_000,
      elapsedMs: 42_000,
    };

    expect(initialSwitchState(job)).toEqual({
      jobId: 'running-job',
      status: { status: 'running', elapsedMs: 42_000 },
    });
    expect(shouldPollInitialJob(job)).toBe(true);
  });

  it('renders terminal initial job state without requiring a status fetch', () => {
    const job: SwitchJobSummary = {
      jobId: 'terminal-job',
      agent: 'the-analyst',
      targetAccount: 'moonlight-max',
      sourceAccount: 'me-com-max',
      status: 'succeeded',
      startedAt: '2026-07-10T05:00:00.000Z',
      startedAtMs: 1_000,
      endedAt: '2026-07-10T05:03:00.000Z',
      elapsedMs: 180_000,
      resultSummary: 'auth flip verified; functional sweep pending',
      functionalSweepTaskId: 'task_123',
    };

    expect(initialSwitchState(job)).toEqual({
      jobId: 'terminal-job',
      status: {
        status: 'succeeded',
        elapsedMs: 180_000,
        resultSummary: 'auth flip verified; functional sweep pending',
        functionalSweepTaskId: 'task_123',
      },
    });
    expect(shouldPollInitialJob(job)).toBe(false);
  });

  it('renders suspect as amber-distinct, not success green or failure red', () => {
    expect(switchStatusTone('suspect')).toContain('text-amber');
    expect(switchStatusTone('suspect')).not.toContain('text-emerald');
    expect(switchStatusTone('suspect')).not.toContain('text-destructive');
  });
});
