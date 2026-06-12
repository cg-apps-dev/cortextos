import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-accounts-reports-'));
process.env.CTX_ROOT = root;

type Reports = typeof import('../data/reports');
let reports: Reports;

beforeAll(async () => {
  reports = await import('../data/reports');
});

afterAll(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
});

const usageDir = path.join(root, 'state', 'usage');
beforeEach(() => {
  fs.rmSync(usageDir, { recursive: true, force: true });
  fs.mkdirSync(usageDir, { recursive: true });
});

describe('shortAgentName', () => {
  it('strips a leading the- prefix', () => {
    expect(reports.shortAgentName('the-orchestrator')).toBe('orchestrator');
  });

  it('strips a trailing -agent suffix', () => {
    expect(reports.shortAgentName('cro-agent')).toBe('cro');
  });

  it('strips suffix first and then prefix', () => {
    expect(reports.shortAgentName('the-cortextos-dev-agent')).toBe('cortextos-dev');
  });

  it('passes through names with neither marker', () => {
    expect(reports.shortAgentName('research')).toBe('research');
  });
});

describe('getAgentAccounts', () => {
  function writeSnapshot(agents: unknown[]) {
    fs.writeFileSync(path.join(usageDir, 'agent-accounts.json'), JSON.stringify({
      generated_at: '2026-06-12T12:00:00.000Z',
      agents,
    }));
  }

  it('returns null when the snapshot is absent', () => {
    expect(reports.getAgentAccounts()).toBeNull();
  });

  it('groups sorted short names by account and surfaces unassigned agents', () => {
    writeSnapshot([
      { org: 'o1', agent: 'meta-ads-agent', account: 'B', source: 'token-match' },
      { org: 'o1', agent: 'the-orchestrator', account: null, source: null },
      { org: 'o1', agent: 'cro-agent', account: 'A', source: 'login-marker' },
      { org: 'o1', agent: 'cortextos-dev-agent', account: 'A', source: 'login-marker' },
    ]);

    expect(reports.getAgentAccounts()).toEqual({
      byAccount: {
        A: ['cortextos-dev', 'cro'],
        B: ['meta-ads'],
      },
      unassigned: ['orchestrator'],
    });
  });
});
