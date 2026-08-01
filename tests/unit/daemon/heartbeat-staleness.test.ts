import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CronDefinition } from '../../../src/types/index';
import {
  createHeartbeatStalenessMonitorLoop,
  scanHeartbeatStaleness,
  stalenessAlerts,
} from '../../../src/daemon/heartbeat-staleness';

let tmpRoot: string;
const originalCtxRoot = process.env.CTX_ROOT;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'heartbeat-staleness-test-'));
  process.env.CTX_ROOT = tmpRoot;
  vi.resetModules();
});

afterEach(() => {
  if (originalCtxRoot !== undefined) {
    process.env.CTX_ROOT = originalCtxRoot;
  } else {
    delete process.env.CTX_ROOT;
  }
  try { rmSync(tmpRoot, { recursive: true }); } catch { /* ignore */ }
});

const CRONS_DIR = '.cortextOS/state/agents';

function isoHoursAgo(now: Date, hours: number): string {
  return new Date(now.getTime() - hours * 3_600_000).toISOString();
}

function writeHeartbeat(agentName: string, lastHeartbeat: string, loopInterval = ''): void {
  const dir = join(tmpRoot, 'state', agentName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'heartbeat.json'),
    JSON.stringify({
      agent: agentName,
      org: 'test',
      status: 'online',
      current_task: '',
      mode: 'day',
      last_heartbeat: lastHeartbeat,
      loop_interval: loopInterval,
    }, null, 2),
  );
}

function writeCronsJson(agentName: string, crons: CronDefinition[]): void {
  const dir = join(tmpRoot, CRONS_DIR, agentName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'crons.json'),
    JSON.stringify({ updated_at: new Date().toISOString(), crons }, null, 2),
  );
}

function makeCron(name: string, schedule: string, extra: Partial<CronDefinition> = {}): CronDefinition {
  return {
    name,
    prompt: `Run ${name}.`,
    schedule,
    enabled: true,
    created_at: new Date(Date.now() - 86_400_000).toISOString(),
    ...extra,
  };
}

describe('stalenessAlerts', () => {
  it('returns no alerts for healthy heartbeats', () => {
    const now = new Date('2026-07-30T00:00:00.000Z');
    const alerts = stalenessAlerts({
      agents: {
        alice: { last_heartbeat: isoHoursAgo(now, 2) },
        bob: { last_heartbeat: isoHoursAgo(now, 12.4) },
      },
      cadences: { alice: 6, bob: 6 },
      now,
    });

    expect(alerts).toEqual([]);
  });

  it('fires at the 2x cadence plus 0.5h threshold', () => {
    const now = new Date('2026-07-30T00:00:00.000Z');

    expect(stalenessAlerts({
      agents: { alice: { last_heartbeat: isoHoursAgo(now, 12.4) } },
      cadences: { alice: 6 },
      now,
    })).toEqual([]);

    expect(stalenessAlerts({
      agents: { alice: { last_heartbeat: isoHoursAgo(now, 12.6) } },
      cadences: { alice: 6 },
      now,
    })).toMatchObject([{ agent: 'alice', thresholdHours: 12.5 }]);
  });

  it('is relative to per-agent heartbeat cadence', () => {
    const now = new Date('2026-07-30T00:00:00.000Z');

    expect(stalenessAlerts({
      agents: { alice: { last_heartbeat: isoHoursAgo(now, 3) } },
      cadences: { alice: 1 },
      now,
    })).toHaveLength(1);

    expect(stalenessAlerts({
      agents: { alice: { last_heartbeat: isoHoursAgo(now, 3) } },
      cadences: { alice: 6 },
      now,
    })).toHaveLength(0);
  });

  it('emits a blocked alert when cadence is unknown', () => {
    const now = new Date('2026-07-30T00:00:00.000Z');
    const alerts = stalenessAlerts({
      agents: { alice: { last_heartbeat: isoHoursAgo(now, 99) } },
      cadences: {},
      now,
    });

    expect(alerts).toEqual([{
      agent: 'alice',
      ageHours: null,
      thresholdHours: null,
      blocked: 'no cadence known',
    }]);
  });

  it('preserves the pure empty-input contract', () => {
    expect(stalenessAlerts({
      agents: {},
      cadences: {},
      now: new Date('2026-07-30T00:00:00.000Z'),
    })).toEqual([]);
  });
});

describe('scanHeartbeatStaleness', () => {
  it('derives cadence from heartbeat cron and ignores empty heartbeat loop_interval', () => {
    const now = new Date('2026-07-30T00:00:00.000Z');
    writeHeartbeat('alice', isoHoursAgo(now, 99), '');
    writeCronsJson('alice', [makeCron('heartbeat', '6h')]);

    const result = scanHeartbeatStaleness(tmpRoot, now);

    expect(result.scannedCount).toBe(1);
    expect(result.alerts).toMatchObject([{
      agent: 'alice',
      thresholdHours: 12.5,
    }]);
  });

  it('uses the explicit ctxRoot for cron cadence, not process.env.CTX_ROOT', () => {
    const otherRoot = mkdtempSync(join(tmpdir(), 'heartbeat-staleness-other-'));
    const previousCtxRoot = process.env.CTX_ROOT;
    try {
      process.env.CTX_ROOT = otherRoot;
      const now = new Date('2026-07-30T00:00:00.000Z');
      writeHeartbeat('alice', isoHoursAgo(now, 99), '');
      writeCronsJson('alice', [makeCron('heartbeat', '6h')]);

      const result = scanHeartbeatStaleness(tmpRoot, now);

      expect(result.alerts).toMatchObject([{
        agent: 'alice',
        thresholdHours: 12.5,
      }]);
    } finally {
      if (previousCtxRoot !== undefined) {
        process.env.CTX_ROOT = previousCtxRoot;
      } else {
        delete process.env.CTX_ROOT;
      }
      try { rmSync(otherRoot, { recursive: true }); } catch { /* ignore */ }
    }
  });

  it('derives cron-expression cadence for heartbeat crons', () => {
    const now = new Date('2026-07-30T00:00:00.000Z');
    writeHeartbeat('alice', isoHoursAgo(now, 3), '');
    writeCronsJson('alice', [makeCron('heartbeat', '0 */1 * * *')]);

    const result = scanHeartbeatStaleness(tmpRoot, now);

    expect(result.alerts).toMatchObject([{ agent: 'alice', thresholdHours: 2.5 }]);
  });

  it('refuses a clean sweep when no heartbeats were scanned', () => {
    const result = scanHeartbeatStaleness(tmpRoot, new Date('2026-07-30T00:00:00.000Z'));

    expect(result.scannedCount).toBe(0);
    expect(result.blocked).toBe(true);
    expect(result.alerts).toEqual([{
      agent: '*',
      ageHours: null,
      thresholdHours: null,
      blocked: 'no heartbeats scanned',
    }]);
  });
});

describe('createHeartbeatStalenessMonitorLoop', () => {
  it('emits scanned_count and dedupes repeated alerts within cooldown', () => {
    const messages: string[] = [];
    const loop = createHeartbeatStalenessMonitorLoop({
      ctxRoot: tmpRoot,
      frameworkRoot: '/tmp/nope',
      nowMs: () => Date.parse('2026-07-30T00:00:00.000Z'),
      scanner: () => ({
        scannedCount: 1,
        blocked: false,
        alerts: [{ agent: 'alice', ageHours: 18.1, thresholdHours: 12.5 }],
      }),
      notifier: (message) => messages.push(message),
      logger: () => {},
    });

    loop.runOnce();
    loop.runOnce();

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('scanned_count=1');
    expect(messages[0]).toContain('alice: 18.1h since heartbeat, threshold 12.5h');
  });
});
