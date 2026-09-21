import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  applyPhase1,
  buildPlan,
  latestSessionRefreshAt,
  revertPhase1,
  runSelfTest,
  type Target,
} from '../../../scripts/session-rollover-jitter';

describe('session-rollover-jitter', () => {
  let root: string;
  let logsRoot: string;
  let statePath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'session-rollover-jitter-test-'));
    logsRoot = join(root, 'logs');
    statePath = join(root, '.cortextOS', 'state', 'session-rollover-jitter.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function seed(target: Target, baselineSeconds: number, refreshIso: string) {
    const cfgPath = join(root, 'orgs', target.org, 'agents', target.agent, 'config.json');
    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, JSON.stringify({
      agent_name: target.agent,
      enabled: true,
      max_session_seconds: baselineSeconds,
    }, null, 2) + '\n');

    const logPath = join(logsRoot, target.agent, 'crashes.log');
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileSync(logPath, [
      '2026-09-20T19:00:00.000Z type=daemon-stop reason=test',
      `${refreshIso} type=session-refresh reason=session-time-cap rollover session=test`,
      '',
    ].join('\n'));
    return { cfgPath, logPath };
  }

  it('parses the latest session-refresh from crashes.log', () => {
    const target = { org: 'org', agent: 'agent-a', group: 'daily' };
    const { logPath } = seed(target, 86400, '2026-09-21T19:00:10.000Z');
    writeFileSync(logPath, '2026-09-21T19:00:20.000Z type=session-refresh reason=session-time-cap rollover session=test\n', { flag: 'a' });

    expect(latestSessionRefreshAt(logPath)?.toISOString()).toBe('2026-09-21T19:00:20.000Z');
  });

  it('assigns offsets by current phase, not agent name', () => {
    const targets: Target[] = [
      { org: 'org', agent: 'z-agent', group: 'daily' },
      { org: 'org', agent: 'a-agent', group: 'daily' },
      { org: 'org', agent: 'm-agent', group: 'daily' },
    ];
    seed(targets[0], 86400, '2026-09-21T19:00:30.000Z');
    seed(targets[1], 86400, '2026-09-21T19:00:10.000Z');
    seed(targets[2], 86400, '2026-09-21T19:00:20.000Z');

    const plan = buildPlan({ repoRoot: root, logsRoot, statePath, targets });
    expect(plan.verdict).toBe('PASS');
    expect(plan.rows.map(row => [row.agent, row.offsetSeconds])).toEqual([
      ['a-agent', 120],
      ['m-agent', 210],
      ['z-agent', 300],
    ]);
  });

  it('fails the plan when a planted tight pair remains below the minimum landed gap', () => {
    const targets: Target[] = [
      { org: 'org', agent: 'agent-a', group: 'daily' },
      { org: 'org', agent: 'agent-b', group: 'daily' },
    ];
    seed(targets[0], 86400, '2026-09-21T19:00:00.000Z');
    seed(targets[1], 86400, '2026-09-21T19:00:10.000Z');

    const plan = buildPlan({
      repoRoot: root,
      logsRoot,
      statePath,
      targets,
      floorSeconds: 0,
      stepSeconds: 0,
      minOffsetSeconds: -1,
      minGapSeconds: 60,
    });
    expect(plan.verdict).toBe('FAIL');
    expect(plan.errors.some(error => error.includes('gap 10.000s'))).toBe(true);
  });

  it('applies phase1, refuses premature revert, then restores per-agent baselines after observed rolls', () => {
    const targets: Target[] = [
      { org: 'org', agent: 'daily-agent', group: 'daily' },
      { org: 'org', agent: 'long-agent', group: 'seventy-one-hour' },
    ];
    const daily = seed(targets[0], 86400, '2026-09-21T19:00:00.000Z');
    const long = seed(targets[1], 255600, '2026-09-20T18:30:00.000Z');

    applyPhase1({ repoRoot: root, logsRoot, statePath, targets }, new Date('2026-09-21T20:00:00.000Z'));
    expect(JSON.parse(readFileSync(daily.cfgPath, 'utf-8')).max_session_seconds).toBe(86520);
    expect(JSON.parse(readFileSync(long.cfgPath, 'utf-8')).max_session_seconds).toBe(255720);

    expect(() => revertPhase1({ statePath })).toThrow(/refusing revert/);

    writeFileSync(daily.logPath, '2026-09-21T20:05:00.000Z type=session-refresh reason=session-time-cap rollover session=test\n', { flag: 'a' });
    writeFileSync(long.logPath, '2026-09-21T20:06:00.000Z type=session-refresh reason=session-time-cap rollover session=test\n', { flag: 'a' });
    revertPhase1({ statePath });

    expect(JSON.parse(readFileSync(daily.cfgPath, 'utf-8')).max_session_seconds).toBe(86400);
    expect(JSON.parse(readFileSync(long.cfgPath, 'utf-8')).max_session_seconds).toBe(255600);
  });

  it('refuses double apply while active state exists', () => {
    const targets: Target[] = [{ org: 'org', agent: 'agent-a', group: 'daily' }];
    seed(targets[0], 86400, '2026-09-21T19:00:00.000Z');

    applyPhase1({ repoRoot: root, logsRoot, statePath, targets }, new Date('2026-09-21T20:00:00.000Z'));
    expect(() => applyPhase1({ repoRoot: root, logsRoot, statePath, targets }, new Date('2026-09-21T20:01:00.000Z'))).toThrow(/double apply/);
  });

  it('passes the built-in self-test matrix', () => {
    expect(runSelfTest()).toContain('self-test revert restore PASS');
  });
});
