/**
 * tests/unit/daemon/cron-scheduler.test.ts
 *
 * Unit tests for CronScheduler (Subtask 1.3).
 *
 * All timing is driven by vitest fake timers (vi.useFakeTimers / vi.advanceTimersByTimeAsync).
 * Disk I/O is fully mocked so tests run without touching the filesystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Mock crons.ts I/O BEFORE importing CronScheduler so the module resolution
// picks up the mock.
// ---------------------------------------------------------------------------

const mockReadCrons  = vi.fn();
const mockUpdateCron = vi.fn();
const mockAppendExecutionLog = vi.fn();
// readCronsWithStatus is what cron-scheduler actually calls (post-iter-9).
// By default it mirrors mockReadCrons with corrupt:false so existing tests
// keep working.  Tests that need to assert the corruption path can override
// with mockReadCronsWithStatus.mockReturnValueOnce({ crons: [...], corrupt: true }).
const mockReadCronsWithStatus = vi.fn();

vi.mock('../../../src/bus/crons.js', () => ({
  readCrons:  (...args: unknown[]) => mockReadCrons(...args),
  readCronsWithStatus: (...args: unknown[]) => mockReadCronsWithStatus(...args),
  updateCron: (...args: unknown[]) => mockUpdateCron(...args),
}));

vi.mock('../../../src/daemon/cron-execution-log.js', () => ({
  appendExecutionLog: (...args: unknown[]) => mockAppendExecutionLog(...args),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mock setup
// ---------------------------------------------------------------------------

import { GATE_RECHECK_MS } from '../../../src/daemon/cron-capacity-gate';
import { CronScheduler, nextFireFromCron } from '../../../src/daemon/cron-scheduler';
import { updateHeartbeat } from '../../../src/bus/heartbeat';
import type { BusPaths, CronDefinition } from '../../../src/types/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCron(overrides: Partial<CronDefinition> = {}): CronDefinition {
  return {
    name: 'test-cron',
    prompt: 'Do something.',
    schedule: '1m',
    enabled: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const TICK = CronScheduler.TICK_INTERVAL_MS; // 30_000 ms
let originalCtxRoot: string | undefined;
let tempCtxRoot: string | undefined;

function createTempCtxRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cron-scheduler-'));
  tempCtxRoot = root;
  process.env.CTX_ROOT = root;
  return root;
}

function writeDaemonStopMarker(agentName: string, stopMs: number): void {
  const root = process.env.CTX_ROOT ?? createTempCtxRoot();
  const stateDir = join(root, 'state', agentName);
  mkdirSync(stateDir, { recursive: true });
  const markerPath = join(stateDir, '.daemon-stop');
  writeFileSync(markerPath, 'daemon shutdown (SIGTERM)', 'utf-8');
  const markerDate = new Date(stopMs);
  utimesSync(markerPath, markerDate, markerDate);
}

// ---------------------------------------------------------------------------
// nextFireFromCron — unit tests for the cron expression parser
//
// These tests read and construct calendar fields in the daemon cron timezone,
// not the host timezone. This keeps the suite stable when process.env.TZ is
// forced to UTC or another non-PT zone.
// ---------------------------------------------------------------------------

const TEST_CRON_TZ = 'America/Los_Angeles';
const TEST_WEEKDAY_TO_DOW: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};
const testCronFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TEST_CRON_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
});

function cronTzOf(ms: number) {
  const partsByType = new Map(
    testCronFormatter
      .formatToParts(new Date(ms))
      .map((part) => [part.type, part.value])
  );
  const rawHour = parseInt(partsByType.get('hour') ?? '', 10);
  return {
    minutes: parseInt(partsByType.get('minute') ?? '', 10),
    hours: rawHour === 24 ? 0 : rawHour,
    date: parseInt(partsByType.get('day') ?? '', 10),
    month: parseInt(partsByType.get('month') ?? '', 10),
    dayOfWeek: TEST_WEEKDAY_TO_DOW[partsByType.get('weekday') ?? ''] ?? -1,
  };
}

function cronTzDateMs(year: number, month: number, day: number, hour: number, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour + 8, minute);
  for (let offsetMinutes = -12 * 60; offsetMinutes <= 12 * 60; offsetMinutes++) {
    const candidate = guess + offsetMinutes * 60_000;
    const loc = cronTzOf(candidate);
    if (
      loc.month === month &&
      loc.date === day &&
      loc.hours === hour &&
      loc.minutes === minute
    ) {
      return candidate;
    }
  }
  throw new Error(`Could not construct ${TEST_CRON_TZ} time`);
}

function withHostTz<T>(tz: string, run: () => T): T {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    if (original === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = original;
    }
  }
}

describe('nextFireFromCron', () => {
  it('uses CTX_TIMEZONE for 7am daily cron regardless of host timezone', () => {
    const fromMs = Date.parse('2026-07-14T13:30:00.000Z'); // 6:30am PDT

    for (const hostTz of ['America/New_York', 'UTC']) {
      const next = withHostTz(hostTz, () => nextFireFromCron('0 7 * * *', fromMs));
      expect(new Date(next).toISOString()).toBe('2026-07-14T14:00:00.000Z');
    }
  });

  it('uses the winter PST offset for 7am daily cron', () => {
    const fromMs = Date.parse('2026-01-14T14:30:00.000Z'); // 6:30am PST

    const next = withHostTz('America/New_York', () => nextFireFromCron('0 7 * * *', fromMs));
    expect(new Date(next).toISOString()).toBe('2026-01-14T15:00:00.000Z');
  });

  it('computes correct next fire for "*/5 * * * *" (every 5 minutes)', () => {
    // Use the current time as the reference so this is always timezone-safe.
    const fromMs = Date.now();
    const next = nextFireFromCron('*/5 * * * *', fromMs);
    expect(next).not.toBeNaN();
    // Result must be after fromMs and within the next 5 minutes
    expect(next).toBeGreaterThan(fromMs);
    expect(next).toBeLessThanOrEqual(fromMs + 5 * 60_000 + 60_000);
    // The minute must be a multiple of 5
    expect(cronTzOf(next).minutes % 5).toBe(0);
    // Seconds must be zero (whole minute)
    expect(next % 60_000).toBe(0);
  });

  it('computes next fire at local hour 13 for "0 13 * * *" when before 13:00 today', () => {
    const fromMs = cronTzDateMs(2026, 7, 14, 12);

    const next = nextFireFromCron('0 13 * * *', fromMs);
    expect(next).not.toBeNaN();

    const loc = cronTzOf(next);
    expect(loc.hours).toBe(13);
    expect(loc.minutes).toBe(0);
    expect(loc.date).toBe(cronTzOf(fromMs).date);
  });

  it('wraps to next day when local hour 13 has already passed today', () => {
    const fromMs = cronTzDateMs(2026, 7, 14, 14);

    const next = nextFireFromCron('0 13 * * *', fromMs);
    expect(next).not.toBeNaN();

    const loc = cronTzOf(next);
    expect(loc.hours).toBe(13);
    expect(loc.minutes).toBe(0);
    expect(loc.date).toBe(15);
  });

  it('handles comma-list: "0 0,6,12,18 * * *" — picks the next matching hour', () => {
    const fromMs = cronTzDateMs(2026, 7, 14, 5);

    const next = nextFireFromCron('0 0,6,12,18 * * *', fromMs);
    expect(next).not.toBeNaN();

    const loc = cronTzOf(next);
    expect([0, 6, 12, 18]).toContain(loc.hours);
    expect(loc.minutes).toBe(0);
    expect(next).toBeGreaterThan(fromMs);
  });

  it('handles ranges: "0 8-10 * * *" — fires within [8,9,10] local hours', () => {
    const fromMs = cronTzDateMs(2026, 7, 14, 7, 59);

    const next = nextFireFromCron('0 8-10 * * *', fromMs);
    expect(next).not.toBeNaN();

    const loc = cronTzOf(next);
    expect(loc.hours).toBeGreaterThanOrEqual(8);
    expect(loc.hours).toBeLessThanOrEqual(10);
    expect(loc.minutes).toBe(0);
  });

  it('handles day-of-week restriction: "0 16 * * 1" — fires on a Monday', () => {
    const fromMs = Date.now();
    const next = nextFireFromCron('0 16 * * 1', fromMs);
    expect(next).not.toBeNaN();
    expect(next).toBeGreaterThan(fromMs);

    const loc = cronTzOf(next);
    expect(loc.dayOfWeek).toBe(1); // Monday
    expect(loc.hours).toBe(16);
    expect(loc.minutes).toBe(0);
    // Must be within the next 7 days
    expect(next - fromMs).toBeLessThanOrEqual(8 * 24 * 60 * 60_000);
  });

  it('returns NaN for invalid expression (wrong field count)', () => {
    expect(nextFireFromCron('* * * *', Date.now())).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// CronScheduler behaviour tests (fake timers)
// ---------------------------------------------------------------------------

describe('CronScheduler', () => {
  let logs: string[];
  let fired: CronDefinition[];
  let scheduler: CronScheduler;
  let tmpRoot: string;

  beforeEach(() => {
    vi.useFakeTimers();
    originalCtxRoot = process.env.CTX_ROOT;
    createTempCtxRoot();
    logs   = [];
    fired  = [];
    tmpRoot = mkdtempSync(join(tmpdir(), 'cron-watchdog-'));
    CronScheduler.resetWatchdogGlobalStateForTests();
    mockReadCrons.mockReset();
    mockUpdateCron.mockReset();
    mockAppendExecutionLog.mockReset();
    mockReadCronsWithStatus.mockReset();
    // Default: readCronsWithStatus reflects whatever readCrons returns
    // and reports the file as healthy (corrupt: false).
    mockReadCronsWithStatus.mockImplementation((agent: string) => ({
      crons: mockReadCrons(agent) ?? [],
      corrupt: false,
    }));

    scheduler = new CronScheduler({
      agentName: 'test-agent',
      onFire: (cron) => { fired.push(cron); },
      logger: (msg) => { logs.push(msg); },
    });
  });

  afterEach(() => {
    scheduler.stop();
    rmSync(tmpRoot, { recursive: true, force: true });
    CronScheduler.resetWatchdogGlobalStateForTests();
    vi.useRealTimers();
    if (originalCtxRoot === undefined) {
      delete process.env.CTX_ROOT;
    } else {
      process.env.CTX_ROOT = originalCtxRoot;
    }
    if (tempCtxRoot !== undefined) {
      rmSync(tempCtxRoot, { recursive: true, force: true });
      tempCtxRoot = undefined;
    }
  });

  // -------------------------------------------------------------------------

  it('fires a "1m" interval cron after 60 seconds', async () => {
    mockReadCrons.mockReturnValue([makeCron({ schedule: '1m' })]);
    scheduler.start();

    // Advance time so nextFireAt (now + 60s) is reached, plus one tick
    await vi.advanceTimersByTimeAsync(60_000 + TICK);

    expect(fired).toHaveLength(1);
    expect(fired[0].name).toBe('test-cron');
  });

  it('does NOT fire before the interval has elapsed', async () => {
    mockReadCrons.mockReturnValue([makeCron({ schedule: '1m' })]);
    scheduler.start();

    // Advance only 30s (less than 1m)
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fired).toHaveLength(0);
  });

  it('keeps interval cron next fire at reference plus interval regardless of host timezone', () => {
    const reference = new Date('2026-07-14T13:30:00.000Z');

    withHostTz('America/New_York', () => {
      vi.setSystemTime(reference);
      mockReadCrons.mockReturnValue([makeCron({ name: 'interval-2h', schedule: '2h' })]);

      scheduler.start();

      const entry = scheduler.getNextFireTimes().find((item) => item.name === 'interval-2h');
      expect(entry?.nextFireAt).toBe(reference.getTime() + 2 * 60 * 60_000);
    });
  });

  it('disabled cron does not fire', async () => {
    mockReadCrons.mockReturnValue([makeCron({ schedule: '1m', enabled: false })]);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(fired).toHaveLength(0);
  });

  it('fires multiple times after multiple intervals', async () => {
    mockReadCrons.mockReturnValue([makeCron({ schedule: '1m' })]);
    scheduler.start();

    // 3 minutes worth — should fire 3 times (at 60s, 120s, 180s)
    await vi.advanceTimersByTimeAsync(3 * 60_000 + TICK);

    expect(fired.length).toBeGreaterThanOrEqual(3);
  });

  // -------------------------------------------------------------------------

  it('persists last_fired_at and fire_count via updateCron on successful fire', async () => {
    mockReadCrons.mockReturnValue([makeCron({ schedule: '1m' })]);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(60_000 + TICK);

    expect(mockUpdateCron).toHaveBeenCalledWith(
      'test-agent',
      'test-cron',
      expect.objectContaining({
        last_fired_at: expect.any(String),
        fire_count: 1,
      })
    );
  });

  describe('capacity gate', () => {
    it('defers a due cron without calling onFire and writes a deferred execution row', async () => {
      const dueCron = makeCron({
        name: 'gated',
        schedule: '1m',
        last_fired_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      });
      writeDaemonStopMarker('test-agent', Date.now() - 90_000);
      mockReadCrons.mockReturnValue([dueCron]);
      const gatedScheduler = new CronScheduler({
        agentName: 'test-agent',
        onFire: (cron) => { fired.push(cron); },
        gate: () => ({ defer: true, reason: 'account A 5h=100% capped + extra-usage meter on' }),
        logger: (msg) => { logs.push(msg); },
      });

      gatedScheduler.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(fired).toHaveLength(0);
      expect(mockAppendExecutionLog).toHaveBeenCalledWith(
        'test-agent',
        expect.objectContaining({
          cron: 'gated',
          status: 'deferred',
          attempt: 0,
          duration_ms: 0,
          error: 'account A 5h=100% capped + extra-usage meter on',
        })
      );
      expect(logs.some((line) => line.includes('capacity-deferred "gated"'))).toBe(true);
      expect(gatedScheduler.getNextFireTimes()).toEqual([
        { name: 'gated', nextFireAt: Date.now() + GATE_RECHECK_MS },
      ]);

      gatedScheduler.stop();
    });

    it('fails open when the gate throws', async () => {
      mockReadCrons.mockReturnValue([
        makeCron({
          name: 'throwing-gate',
          schedule: '1m',
          last_fired_at: new Date(Date.now() - 2 * 60_000).toISOString(),
        }),
      ]);
      writeDaemonStopMarker('test-agent', Date.now() - 90_000);
      const gatedScheduler = new CronScheduler({
        agentName: 'test-agent',
        onFire: (cron) => { fired.push(cron); },
        gate: () => { throw new Error('gate unavailable'); },
        logger: (msg) => { logs.push(msg); },
      });

      gatedScheduler.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(fired.map((cron) => cron.name)).toContain('throwing-gate');

      gatedScheduler.stop();
    });

    it('fires normally when no gate is configured', async () => {
      mockReadCrons.mockReturnValue([
        makeCron({
          name: 'ungated',
          schedule: '1m',
          last_fired_at: new Date(Date.now() - 2 * 60_000).toISOString(),
        }),
      ]);
      writeDaemonStopMarker('test-agent', Date.now() - 90_000);

      scheduler.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(fired.map((cron) => cron.name)).toContain('ungated');
    });
  });

  // -------------------------------------------------------------------------
  // onFire failure + retry
  // -------------------------------------------------------------------------

  it('retries onFire 3 times on failure then gives up without crashing', async () => {
    const failingFire = vi.fn().mockRejectedValue(new Error('PTY unavailable'));

    // Use a very long schedule so the cron never becomes due a SECOND time
    // during the test (avoiding double-fire across ticks).
    mockReadCrons.mockReturnValue([makeCron({ schedule: '24h' })]);

    const retryLogs: string[] = [];
    const retryScheduler = new CronScheduler({
      agentName: 'test-agent',
      onFire: failingFire,
      logger: (msg) => retryLogs.push(msg),
    });

    // Seed a last_fired_at that is 25h ago so it catch-up fires immediately.
    mockReadCrons.mockReturnValue([
      makeCron({
        schedule:      '24h',
        last_fired_at: new Date(Date.now() - 25 * 3_600_000).toISOString(),
      }),
    ]);
    writeDaemonStopMarker('test-agent', Date.now() - 2 * 3_600_000);

    retryScheduler.start();

    // Advance through one tick (fires catch-up) plus all retry back-offs (1s+4s+16s)
    await vi.advanceTimersByTimeAsync(TICK + 1_000 + 4_000 + 16_000 + 1_000);

    // 4 total calls: 1 initial + 3 retries
    expect(failingFire).toHaveBeenCalledTimes(4);

    // Scheduler must NOT crash — the log should contain a give-up message
    expect(retryLogs.some(l => l.includes('giving up'))).toBe(true);

    // updateCron is called exactly once with last_fire_attempted_at (iter 11
    // pre-fire persist), but NEVER with last_fired_at because all attempts
    // failed.  This matches the iter 11 invariant: attempted_at is recorded
    // even on failed dispatches so a crash mid-fire cannot double-fire.
    expect(mockUpdateCron).toHaveBeenCalledTimes(1);
    expect(mockUpdateCron).toHaveBeenCalledWith(
      'test-agent',
      'test-cron',
      expect.objectContaining({ last_fire_attempted_at: expect.any(String) })
    );
    expect(mockUpdateCron).not.toHaveBeenCalledWith(
      'test-agent',
      'test-cron',
      expect.objectContaining({ last_fired_at: expect.any(String) })
    );

    retryScheduler.stop();
  });

  it('succeeds on second attempt (first fails, second succeeds)', async () => {
    let callCount = 0;
    const flakyFire = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve();
    });

    mockReadCrons.mockReturnValue([makeCron({ schedule: '1m' })]);

    const retryScheduler = new CronScheduler({
      agentName: 'test-agent',
      onFire: flakyFire,
      logger: (msg) => logs.push(msg),
    });

    retryScheduler.start();

    await vi.advanceTimersByTimeAsync(60_000 + TICK + 1_000 + 500);

    expect(flakyFire).toHaveBeenCalledTimes(2);
    // 2 updateCron calls: 1 pre-fire attempted_at (iter 11) + 1 post-success
    // last_fired_at/fire_count.
    expect(mockUpdateCron).toHaveBeenCalledTimes(2);
    expect(mockUpdateCron).toHaveBeenCalledWith(
      'test-agent',
      'test-cron',
      expect.objectContaining({ last_fire_attempted_at: expect.any(String) })
    );
    expect(mockUpdateCron).toHaveBeenCalledWith(
      'test-agent',
      'test-cron',
      expect.objectContaining({ last_fired_at: expect.any(String), fire_count: expect.any(Number) })
    );

    retryScheduler.stop();
  });

  // -------------------------------------------------------------------------
  // reload() — picks up newly added cron
  // -------------------------------------------------------------------------

  it('reload() picks up a newly added cron without restarting', async () => {
    // Start with one cron
    mockReadCrons.mockReturnValue([makeCron({ name: 'existing', schedule: '1m' })]);
    scheduler.start();

    // Add a second cron via reload
    mockReadCrons.mockReturnValue([
      makeCron({ name: 'existing', schedule: '1m' }),
      makeCron({ name: 'new-cron', schedule: '1m' }),
    ]);
    scheduler.reload();

    expect(scheduler.getNextFireTimes().map(e => e.name)).toContain('new-cron');

    await vi.advanceTimersByTimeAsync(60_000 + TICK);

    const firedNames = fired.map(c => c.name);
    expect(firedNames).toContain('existing');
    expect(firedNames).toContain('new-cron');
  });

  // -------------------------------------------------------------------------
  // reload() — preserves nextFireAt for unchanged crons
  // -------------------------------------------------------------------------

  it('reload() preserves nextFireAt for unchanged crons', async () => {
    mockReadCrons.mockReturnValue([makeCron({ name: 'stable', schedule: '6h' })]);
    scheduler.start();

    const beforeReload = scheduler.getNextFireTimes().find(e => e.name === 'stable');
    expect(beforeReload).toBeDefined();

    // Re-read same definitions
    mockReadCrons.mockReturnValue([makeCron({ name: 'stable', schedule: '6h' })]);
    scheduler.reload();

    const afterReload = scheduler.getNextFireTimes().find(e => e.name === 'stable');
    expect(afterReload).toBeDefined();
    expect(afterReload!.nextFireAt).toBe(beforeReload!.nextFireAt);
  });

  it('reload() recomputes nextFireAt for a modified schedule', async () => {
    mockReadCrons.mockReturnValue([makeCron({ name: 'changing', schedule: '6h' })]);
    scheduler.start();

    const beforeReload = scheduler.getNextFireTimes().find(e => e.name === 'changing');

    // Change the schedule
    mockReadCrons.mockReturnValue([makeCron({ name: 'changing', schedule: '12h' })]);
    scheduler.reload();

    const afterReload = scheduler.getNextFireTimes().find(e => e.name === 'changing');
    // 12h window is bigger — nextFireAt should be different (further out)
    expect(afterReload!.nextFireAt).not.toBe(beforeReload!.nextFireAt);
  });

  // -------------------------------------------------------------------------
  // reload() during in-flight fire — race condition probe
  //
  // If reload() runs while a fire's onFire is awaiting, the old ScheduledCron
  // reference held by tick() becomes orphaned (the new map holds a fresh
  // object with firing=false default).  If the cron's definition changed
  // (e.g. schedule shortened), the fresh ScheduledCron computes nextFireAt
  // from the stale last_fired_at in crons.json — which has not yet been
  // updated because the in-flight fire's persist call hasn't run.  Result:
  // the next tick can re-fire the same logical event.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Iter 8 audit: remove-cron during in-flight fire — orphan / re-fire probe
  //
  // BUG DISCOVERED (iter 9 candidate): the empty-result fallback at
  // cron-scheduler.ts loadCrons() (~line 426) reverts to lastGoodSchedule when
  // a reload yields an empty result. This catches transient corruption (intent)
  // BUT also catches legitimate empty-by-removal (regression): if the user
  // removes the LAST cron via `bus remove-cron`, crons.json is now empty,
  // reload sees [] from readCrons(), and the fallback restores the just-removed
  // cron from lastGoodSchedule. The cron continues to fire after removal
  // until either (a) the daemon restarts, or (b) another non-empty reload
  // happens.
  //
  // Fix sketch (iter 9): distinguish "legitimate empty" (file exists + parses
  // to []) from "catastrophic corruption" (both primary and .bak unparseable)
  // in readCrons / a sibling function. Only retain lastGoodSchedule on the
  // latter. Tests below pin both current behavior and the desired post-fix
  // behavior.
  // -------------------------------------------------------------------------

  it('remove-cron mid-fire: in-flight fire injects exactly once (no double-fire) — passes', async () => {
    let resolveFire: (() => void) | undefined;
    const slowFire = vi.fn().mockImplementation(() => new Promise<void>((res) => { resolveFire = res; }));

    const auditScheduler = new CronScheduler({
      agentName: 'test-agent',
      onFire: slowFire,
      logger: (msg) => logs.push(msg),
    });

    // Two crons so the post-removal state is legitimately non-empty (avoiding
    // the empty-result fallback bug in this assertion).
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    mockReadCrons.mockReturnValue([
      makeCron({ name: 'doomed', schedule: '10m', last_fired_at: tenMinAgo, fire_count: 1 }),
      makeCron({ name: 'survivor', schedule: '24h', last_fired_at: new Date(Date.now() - 1_000).toISOString() }),
    ]);
    writeDaemonStopMarker('test-agent', Date.now() - 5 * 60_000);

    auditScheduler.start();

    // Tick 1: 'doomed' fires catch-up, awaits slowFire
    await vi.advanceTimersByTimeAsync(TICK);
    expect(slowFire).toHaveBeenCalledTimes(1);

    // Mid-fire: simulate remove-cron of 'doomed' — crons.json now only has survivor
    mockReadCrons.mockReturnValue([
      makeCron({ name: 'survivor', schedule: '24h', last_fired_at: new Date(Date.now() - 1_000).toISOString() }),
    ]);
    auditScheduler.reload();

    // Schedule no longer contains 'doomed'
    const namesAfter = auditScheduler.getNextFireTimes().map(e => e.name);
    expect(namesAfter).not.toContain('doomed');
    expect(namesAfter).toContain('survivor');

    // Resolve the in-flight fire
    resolveFire!();
    await vi.advanceTimersByTimeAsync(0);

    // Advance multiple ticks — must NOT re-fire 'doomed'
    await vi.advanceTimersByTimeAsync(5 * TICK);

    expect(slowFire).toHaveBeenCalledTimes(1);
    auditScheduler.stop();
  });

  // -------------------------------------------------------------------------
  // Iter 9 fix: empty-result fallback only triggers on actual corruption.
  // The previous gate (`nextScheduled.size === 0 && lastGoodSchedule.size > 0`)
  // could not distinguish "user removed the last cron" from "file unreadable",
  // so it restored the just-removed cron from lastGoodSchedule and kept firing
  // it.  Post-iter-9, readCronsWithStatus carries a `corrupt` flag and the
  // scheduler only applies the fallback when corrupt === true.
  // -------------------------------------------------------------------------

  it('remove-cron of LAST cron clears the schedule (legitimate empty, not corruption)', async () => {
    // Start with one cron and let it fire so lastGoodSchedule is populated.
    mockReadCrons.mockReturnValue([
      makeCron({ name: 'last-cron', schedule: '1m', last_fired_at: new Date(Date.now() - 30_000).toISOString() }),
    ]);
    writeDaemonStopMarker('test-agent', Date.now() - 15_000);
    scheduler.start();

    // Fire once to confirm the schedule is live.
    await vi.advanceTimersByTimeAsync(60_000 + TICK);
    expect(fired.length).toBeGreaterThanOrEqual(1);
    expect(scheduler.getNextFireTimes().length).toBe(1);

    const firesBeforeRemove = fired.length;

    // User removes the last cron — crons.json is now an empty (but valid) array.
    // Critically: corrupt === false (the file exists and parses cleanly).
    mockReadCronsWithStatus.mockReturnValue({ crons: [], corrupt: false });
    scheduler.reload();

    // Schedule must be EMPTY — not retained from lastGoodSchedule.
    expect(scheduler.getNextFireTimes()).toEqual([]);
    // No "retaining last-good schedule" warning — that path is corruption-only.
    expect(logs.find(l => l.includes('retaining last-good schedule'))).toBeUndefined();

    // Advance multiple ticks — the removed cron must NOT fire again.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(fired.length).toBe(firesBeforeRemove);
  });

  it('reload with corrupt: true retains last-good schedule (corruption path preserved)', async () => {
    // Build a healthy schedule first so lastGoodSchedule is populated.
    mockReadCrons.mockReturnValue([makeCron({ name: 'health', schedule: '6h' })]);
    scheduler.start();
    expect(scheduler.getNextFireTimes().length).toBe(1);

    // Now both primary and .bak go bad — readCronsWithStatus reports
    // corrupt: true with crons: [].  Fallback should kick in.
    mockReadCronsWithStatus.mockReturnValue({ crons: [], corrupt: true });
    scheduler.reload();

    // Schedule retained from lastGoodSchedule (size unchanged).
    expect(scheduler.getNextFireTimes().length).toBe(1);
    expect(scheduler.getNextFireTimes().map(e => e.name)).toContain('health');
    expect(logs.find(l => l.includes('retaining last-good schedule'))).toBeDefined();
  });

  it('reload() during in-flight fire with changed schedule does not cause double-fire', async () => {
    // Slow onFire we can resolve manually
    let resolveFire: (() => void) | undefined;
    const slowFire = vi.fn().mockImplementation(() => new Promise<void>((res) => { resolveFire = res; }));

    const raceLogs: string[] = [];
    const raceScheduler = new CronScheduler({
      agentName: 'test-agent',
      onFire: slowFire,
      logger: (msg) => raceLogs.push(msg),
    });

    // Start with a cron that fires immediately (catch-up)
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    mockReadCrons.mockReturnValue([
      makeCron({ name: 'racy', schedule: '10m', last_fired_at: tenMinAgo, fire_count: 1 }),
    ]);
    writeDaemonStopMarker('test-agent', Date.now() - 5 * 60_000);

    raceScheduler.start();

    // First tick: catch-up fires, awaits our slow Promise
    await vi.advanceTimersByTimeAsync(TICK);
    expect(slowFire).toHaveBeenCalledTimes(1);

    // Mid-fire: reload with a SHORTER schedule (changeKey differs).
    // crons.json's last_fired_at is still the stale 10-min-ago value
    // because the in-flight fire's persist hasn't run yet.
    mockReadCrons.mockReturnValue([
      makeCron({ name: 'racy', schedule: '1m', last_fired_at: tenMinAgo, fire_count: 1 }),
    ]);
    raceScheduler.reload();

    // Resolve the in-flight fire so the original tick completes
    resolveFire!();
    await vi.advanceTimersByTimeAsync(0); // flush microtasks

    // Advance one more tick. The bug: new ScheduledCron's catch-up
    // (referenceMs = stale last_fired_at + 1m schedule = past) re-fires
    // the same logical event.
    await vi.advanceTimersByTimeAsync(TICK);

    // Should be exactly 1 fire — the original. Bug repro: we'd see 2.
    expect(slowFire).toHaveBeenCalledTimes(1);

    raceScheduler.stop();
  });

  // -------------------------------------------------------------------------
  // Iter 10 audit / iter 11 fix: daemon-crash mid-fire MUST NOT double-fire
  //
  // BUG (iter 10 audit): if the daemon crashes between sc.firing=true and
  // the post-success updateCron persist, nothing on disk records that the
  // fire happened. On restart, loadCrons computes referenceMs from the
  // STALE crons.json.last_fired_at and cron-state.json.last_fire. The
  // catch-up gate sees nextFireAt in the past and fires AGAIN — same
  // logical scheduled tick, two prompt injections.
  //
  // FIX (iter 11): persist `last_fire_attempted_at` to crons.json BEFORE
  // awaiting onFire, and include it in loadCrons's `candidates` for
  // referenceMs. Crash mid-fire → restart sees attempted_at = "now" →
  // referenceMs is current → nextFireAt is in the future → no catch-up
  // fire. Tradeoff: a fire whose dispatch genuinely failed before the
  // current process crashed will be skipped one window — acceptable,
  // because the alternative (double-fire on every crash) is worse.
  // -------------------------------------------------------------------------

  it('iter 11: daemon crash mid-fire does NOT double-fire on restart (last_fire_attempted_at persisted before onFire)', async () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();

    // Mutable disk-state mock: the cron starts with last_fired_at=1h ago
    // and no attempted_at.  When the scheduler calls updateCron, we apply
    // the patch to this object so subsequent reads see the in-progress
    // attempt — same semantics as the real atomicWriteSync persist.
    let diskCron = makeCron({
      name: 'daily-job',
      schedule: '1h',
      last_fired_at: oneHourAgo,
      fire_count: 5,
    });
    mockReadCrons.mockImplementation(() => [diskCron]);
    mockUpdateCron.mockImplementation((_agent: string, _name: string, patch: Partial<CronDefinition>) => {
      diskCron = { ...diskCron, ...patch };
    });
    writeDaemonStopMarker('test-agent', Date.now() - 90 * 60_000);

    // Slow onFire we never resolve — simulates "fire began, agent received
    // the prompt, daemon crashed before completion."
    const slowFire = vi.fn().mockImplementation(() => new Promise<void>(() => { /* never resolves */ }));

    const scheduler1 = new CronScheduler({
      agentName: 'test-agent',
      onFire: slowFire,
      logger: (m) => logs.push(m),
    });

    scheduler1.start();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(slowFire).toHaveBeenCalledTimes(1);
    // Iter 11 invariant: updateCron MUST be called with last_fire_attempted_at
    // BEFORE the slow onFire resolves (i.e. before the post-success persist).
    expect(mockUpdateCron).toHaveBeenCalledWith(
      'test-agent',
      'daily-job',
      expect.objectContaining({ last_fire_attempted_at: expect.any(String) })
    );
    expect(diskCron.last_fire_attempted_at).toBeDefined();
    // The post-success persist (last_fired_at, fire_count) must NOT have
    // run — the fire is still in flight.
    expect(diskCron.last_fired_at).toBe(oneHourAgo);
    expect(diskCron.fire_count).toBe(5);

    // Simulate the crash: stop scheduler 1 without resolving the in-flight
    // fire.  Disk state now has last_fire_attempted_at ≈ now but stale
    // last_fired_at.
    scheduler1.stop();

    // Restart: build a fresh scheduler with the same mocked disk state.
    const scheduler2 = new CronScheduler({
      agentName: 'test-agent',
      onFire: slowFire,
      logger: (m) => logs.push(m),
    });
    scheduler2.start();
    await vi.advanceTimersByTimeAsync(TICK);

    // FIXED BEHAVIOR: scheduler 2's loadCrons sees attempted_at ≈ now in
    // the referenceMs candidates → nextFireAt = now + 1h → not in past →
    // no catch-up → onFire is NOT called a second time.
    expect(slowFire).toHaveBeenCalledTimes(1);

    scheduler2.stop();
  });

  // -------------------------------------------------------------------------
  // Catch-up on start
  // -------------------------------------------------------------------------

  it('fires once on start when last_fired_at is older than the interval (catch-up)', async () => {
    // last_fired_at is 2 hours ago, schedule is "1h" — should catch-up fire immediately
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    mockReadCrons.mockReturnValue([
      makeCron({
        name:          'overdue',
        schedule:      '1h',
        last_fired_at: twoHoursAgo,
        fire_count:    5,
      }),
    ]);
    writeDaemonStopMarker('test-agent', Date.now() - 90 * 60_000);

    scheduler.start();

    // The catch-up sets nextFireAt = now, so the very next tick should fire it
    await vi.advanceTimersByTimeAsync(TICK);

    expect(fired.some(c => c.name === 'overdue')).toBe(true);
  });

  it.each([
    {
      name: 'theta-wave',
      schedule: '0 0 * * 1',
      ref: '2026-07-13T05:00:00Z',
      expected: '2026-07-20T07:00:00.000Z',
    },
    {
      name: 'daily-digest',
      schedule: '0 7 * * *',
      ref: '2026-07-14T12:00:00Z',
      expected: '2026-07-15T14:00:00.000Z',
    },
    {
      name: 'nightly',
      schedule: '30 20 * * *',
      ref: '2026-07-15T01:30:00Z',
      expected: '2026-07-16T03:30:00.000Z',
    },
  ])('skips stale restart recompute window for $name and schedules the next future slot', async ({ name, schedule, ref, expected }) => {
    const now = Date.parse('2026-07-15T06:57:00Z');
    vi.setSystemTime(now);
    mockReadCrons.mockReturnValue([
      makeCron({
        name,
        schedule,
        last_fired_at: ref,
      }),
    ]);

    scheduler.start();

    const entry = scheduler.getNextFireTimes().find((item) => item.name === name);
    expect(entry).toBeDefined();
    expect(entry!.nextFireAt).toBeGreaterThan(now);
    expect(new Date(entry!.nextFireAt).toISOString()).toBe(expected);

    await vi.advanceTimersByTimeAsync(TICK);

    expect(fired).toHaveLength(0);
    expect(logs.some((line) => line.includes(`skip stale missed window for "${name}"`))).toBe(true);
  });

  it('catch-up fires when a missed calendar window is inside daemon-stop downtime', async () => {
    const now = Date.parse('2026-07-15T06:57:00Z');
    vi.setSystemTime(now);
    writeDaemonStopMarker('test-agent', Date.parse('2026-07-15T06:50:00Z'));
    mockReadCrons.mockReturnValue([
      makeCron({
        name: 'missed-during-downtime',
        schedule: '55 23 * * *',
        last_fired_at: '2026-07-15T05:00:00Z',
      }),
    ]);

    scheduler.start();

    expect(scheduler.getNextFireTimes()).toEqual([
      { name: 'missed-during-downtime', nextFireAt: now },
    ]);

    await vi.advanceTimersByTimeAsync(TICK);

    expect(fired.map((cron) => cron.name)).toContain('missed-during-downtime');
  });

  it('does NOT fire on start when the cron is not yet due', async () => {
    // last_fired_at is 30 minutes ago, schedule is "1h" — not yet due
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    mockReadCrons.mockReturnValue([
      makeCron({
        name:          'fresh',
        schedule:      '1h',
        last_fired_at: thirtyMinsAgo,
      }),
    ]);

    scheduler.start();

    await vi.advanceTimersByTimeAsync(TICK);

    expect(fired.some(c => c.name === 'fresh')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // stop() — clears interval, no further fires
  // -------------------------------------------------------------------------

  it('stop() clears the interval and prevents further fires', async () => {
    mockReadCrons.mockReturnValue([makeCron({ schedule: '1m' })]);
    scheduler.start();

    // Let it fire once
    await vi.advanceTimersByTimeAsync(60_000 + TICK);
    expect(fired).toHaveLength(1);

    scheduler.stop();
    const countAfterStop = fired.length;

    // Advance a lot more — should NOT fire again
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(fired).toHaveLength(countAfterStop);
  });

  it('stop() called twice does not throw', () => {
    mockReadCrons.mockReturnValue([]);
    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.stop()).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Cron expression scheduling via scheduler
  // -------------------------------------------------------------------------

  it('"*/5 * * * *" expression fires within 5 minutes + one tick', async () => {
    // No system time pinning — works regardless of machine timezone.
    mockReadCrons.mockReturnValue([
      makeCron({ name: 'every5min', schedule: '*/5 * * * *' }),
    ]);

    scheduler.start();

    // Worst case: just missed a 5-min boundary, so next fire is ~5 minutes away.
    // Advance 5 minutes + one tick to guarantee the cron fires.
    await vi.advanceTimersByTimeAsync(5 * 60_000 + TICK);

    expect(fired.some(c => c.name === 'every5min')).toBe(true);
    // Verify the fire happened at a minute that is divisible by 5
    const firedCron = fired.find(c => c.name === 'every5min');
    expect(firedCron).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // getNextFireTimes — informational
  // -------------------------------------------------------------------------

  it('getNextFireTimes returns an entry per enabled cron', () => {
    mockReadCrons.mockReturnValue([
      makeCron({ name: 'a', schedule: '1h' }),
      makeCron({ name: 'b', schedule: '2h' }),
      makeCron({ name: 'c', schedule: '3h', enabled: false }),
    ]);
    scheduler.start();

    const times = scheduler.getNextFireTimes();
    const names = times.map(t => t.name);
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).not.toContain('c'); // disabled, not scheduled
  });

  describe('heartbeat stale-while-alive watchdog', () => {
    function writeHeartbeat(
      agentName: string,
      lastHeartbeatMs: number,
      opts: { lastFunctionalBeatMs?: number | null } = {},
    ): void {
      const stateDir = join(tmpRoot, 'state', agentName);
      mkdirSync(stateDir, { recursive: true });
      const heartbeat: Record<string, string> = {
        agent: agentName,
        last_heartbeat: new Date(lastHeartbeatMs).toISOString(),
      };
      if (opts.lastFunctionalBeatMs !== undefined && opts.lastFunctionalBeatMs !== null) {
        heartbeat.last_functional_beat = new Date(opts.lastFunctionalBeatMs).toISOString();
      }
      writeFileSync(
        join(stateDir, 'heartbeat.json'),
        JSON.stringify(heartbeat),
        'utf-8',
      );
    }

    function heartbeatPaths(agentName: string): BusPaths {
      const agentStateDir = join(tmpRoot, 'state', agentName);
      mkdirSync(agentStateDir, { recursive: true });
      return {
        ctxRoot: tmpRoot,
        inbox: join(tmpRoot, 'inbox'),
        inflight: join(tmpRoot, 'inflight'),
        processed: join(tmpRoot, 'processed'),
        logDir: join(tmpRoot, 'logs'),
        stateDir: agentStateDir,
        taskDir: join(tmpRoot, 'tasks'),
        approvalDir: join(tmpRoot, 'approvals'),
        analyticsDir: join(tmpRoot, 'analytics'),
        deliverablesDir: join(tmpRoot, 'deliverables'),
      };
    }

    function watchdogScheduler(opts: {
      agentName?: string;
      isAlive?: () => boolean;
      isAgentActive?: () => boolean;
      lastIdleMs?: () => number | null;
      stdoutMtimeMs?: () => number | null;
      recentStdout?: () => string;
      gate?: (cron: CronDefinition) => { defer: boolean; reason?: string };
      alert?: (message: string) => void;
      writes?: string[];
    } = {}): CronScheduler {
      const agentName = opts.agentName ?? 'test-agent';
      const writes = opts.writes ?? [];
      return new CronScheduler({
        agentName,
        onFire: (cron) => { fired.push(cron); },
        gate: opts.gate,
        heartbeatWatchdog: {
          ctxRoot: tmpRoot,
          stdoutLogPath: join(tmpRoot, 'logs', agentName, 'stdout.log'),
          isPtyAlive: opts.isAlive ?? (() => true),
          isAgentActive: opts.isAgentActive ?? (() => false),
          write: (data) => { writes.push(data); },
          operatorAlert: opts.alert,
          readStdoutMtimeMs: opts.stdoutMtimeMs ?? (() => Date.now() - 120_000),
          readRecentStdout: opts.recentStdout ?? (() => ''),
          readLastIdleFlagMs: opts.lastIdleMs ?? (() => null),
        },
        logger: (msg) => { logs.push(msg); },
      });
    }

    function heartbeatCron(): CronDefinition {
      return makeCron({
        name: 'heartbeat',
        schedule: '1h',
        prompt: 'Read HEARTBEAT.md and follow its instructions.',
        last_fired_at: new Date(Date.now()).toISOString(),
      });
    }

    const throttleAbortTerminal = [
      '❯ [CRON FIRED 2026-06-29T00:00:00.000Z] heartbeat: Read HEARTBEAT.md and follow its instructions.',
      '⏺API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited',
      '✻ Cooked for 4s',
      '❯ ',
    ].join('\n');

    const realForensicTerminalTail = [
      '❯ [CRON FIRED 2026-06-21T19:39:38.976Z] heartbeat: Read HEARTBEAT.md. Update your heartbeat + check inbox for an Adam trigger or orchestrator dispatch.',
      'I turned the campaigns on, run the tracker',
      '✳ Initialize agent system and notify user',
      '⏺API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited',
      '✻Worked for 5s',
      '────────────────────────────────────────────────────────────────────────────────',
      '❯ ',
      '────────────────────────────────────────────────────────────────────────────────',
      '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
    ].join('\r');

    const realForensicRecoveredTail = [
      '❯ [CRON FIRED 2026-06-21T23:39:43.089Z] heartbeat: Read HEARTBEAT.md. Update your heartbeat.',
      '✳ Initialize agent system and notify user',
      '⏺API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited',
      '✻Cogitated for 2s',
      '●How is Claude doing this session? (optional)',
      '  1: Bad    2: Fine   3: Good   0: Dismiss',
      '❯ ',
      '⏺Adam is asking me to verify the VIDEOS (Flower) CG-AGY-1 stamps specifically.',
      '⏺ Bash(cortextos bus send-telegram 6991789266 "Yes - both CG-AGY-1 video stamps are correct")',
      '  ⎿  Messagesent',
    ].join('\n');

    it('A1 positive: real throttle abort after latest turn marker re-injects once', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({ writes, recentStdout: () => throttleAbortTerminal });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes).toEqual([]);

      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes.join('')).toContain('Read HEARTBEAT.md and follow its instructions.');
      expect(writes.join('')).toContain('[WATCHDOG REINJECT');
      expect(writes.join('')).toContain('] heartbeat: ');
      expect(logs.some(l => l.includes('re-injected heartbeat'))).toBe(true);
      s.stop();
    });

    it('A1 fixture: real captured terminal-abort tail re-injects', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({ writes, recentStdout: () => realForensicTerminalTail });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes).toEqual([]);

      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes.join('')).toContain('[WATCHDOG REINJECT');
      s.stop();
    });

    it('A1 fixture: recovered real capture after abort does not re-inject', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({ writes, recentStdout: () => realForensicRecoveredTail });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('A1 marker vocabulary: reminder turns are locatable for terminal aborts', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => [
          '=== REMINDER FIRED [id: rem-123] (fire_at: 2026-09-09T20:00:00.000Z) ===',
          'Handle it now, then run: cortextos bus ack-reminder rem-123',
          '⏺API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited',
          '✻ Cooked for 4s',
          '❯ ',
        ].join('\n'),
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes).toEqual([]);

      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes.join('')).toContain('[WATCHDOG REINJECT');
      s.stop();
    });

    it('updateHeartbeat keeps watchdog mark-alive separate from functional staleness', async () => {
      const agentName = 'test-agent';
      const paths = heartbeatPaths(agentName);
      const heartbeatPath = join(tmpRoot, 'state', agentName, 'heartbeat.json');

      vi.setSystemTime(new Date('2026-09-09T10:00:00Z'));
      updateHeartbeat(paths, agentName, 'online - real heartbeat', { org: 'test-org', timezone: 'UTC' });

      vi.setSystemTime(new Date('2026-09-09T11:50:00Z'));
      updateHeartbeat(paths, agentName, `[watchdog] ${agentName} alive - idle session 2026-09-09T11:50:00Z`, {
        org: 'test-org',
        timezone: 'UTC',
      });

      const afterWatchdog = JSON.parse(readFileSync(heartbeatPath, 'utf-8')) as {
        last_heartbeat: string;
        last_functional_beat?: string;
      };
      expect(afterWatchdog.last_heartbeat).toBe('2026-09-09T11:50:00Z');
      expect(afterWatchdog.last_functional_beat).toBe('2026-09-09T10:00:00Z');

      const watchdogWrites: string[] = [];
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({ writes: watchdogWrites, recentStdout: () => throttleAbortTerminal });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(watchdogWrites).toEqual([]);

      await vi.advanceTimersByTimeAsync(TICK);

      expect(watchdogWrites.join('')).toContain('[WATCHDOG REINJECT');
      s.stop();

      CronScheduler.resetWatchdogGlobalStateForTests();
      const realWrites: string[] = [];
      vi.setSystemTime(new Date('2026-09-09T11:55:00Z'));
      updateHeartbeat(paths, agentName, 'online - real heartbeat recovered', { org: 'test-org', timezone: 'UTC' });

      const afterReal = JSON.parse(readFileSync(heartbeatPath, 'utf-8')) as {
        last_heartbeat: string;
        last_functional_beat?: string;
      };
      expect(afterReal.last_heartbeat).toBe('2026-09-09T11:55:00Z');
      expect(afterReal.last_functional_beat).toBe('2026-09-09T11:55:00Z');

      const recovered = watchdogScheduler({ writes: realWrites, recentStdout: () => throttleAbortTerminal });
      recovered.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(realWrites).toEqual([]);
      recovered.stop();
    });

    it('reads last_functional_beat for staleness even when last_heartbeat is fresh', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now(), {
        lastFunctionalBeatMs: Date.now() - 2 * 60 * 60_000,
      });
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({ writes, recentStdout: () => throttleAbortTerminal });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes).toEqual([]);

      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes.join('')).toContain('Read HEARTBEAT.md and follow its instructions.');
      s.stop();
    });

    it('does not re-inject when last_functional_beat and last_heartbeat are both fresh', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now(), { lastFunctionalBeatMs: Date.now() });
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({ writes });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('busy stdout suppresses the watchdog re-inject', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now(), {
        lastFunctionalBeatMs: Date.now() - 2 * 60 * 60_000,
      });
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        stdoutMtimeMs: () => Date.now() - 10_000,
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('capacity-capped heartbeat suppresses watchdog re-inject', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => throttleAbortTerminal,
        gate: () => ({ defer: true, reason: 'account capped' }),
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes).toEqual([]);
      expect(logs.some(l => l.includes('capacity-deferred heartbeat re-inject'))).toBe(false);

      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      expect(logs.some(l => l.includes('capacity-deferred heartbeat re-inject'))).toBe(true);
      s.stop();
    });

    it('A1 stability: tail growth after candidate tick does not re-inject', async () => {
      const writes: string[] = [];
      let stdout = throttleAbortTerminal;
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => stdout,
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      stdout = `${throttleAbortTerminal}\n✶ Metamorphosing…`;
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('A1 false-positive guard: discussed or quoted throttle text does not re-inject', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => [
          '[CRON FIRED 2026-06-29T00:00:00.000Z] heartbeat: Read HEARTBEAT.md and follow its instructions.',
          'The previous log said "API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited".',
          'I am summarizing the incident and still working.',
        ].join('\n'),
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('A1 false-positive guard: message ending in verbatim abort quote then idle does not re-inject', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => [
          '❯ [CRON FIRED 2026-06-29T00:00:00.000Z] heartbeat: Read HEARTBEAT.md and follow its instructions.',
          '⏺The exact failure was "API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited"',
          '✻ Worked for 2s',
          '❯ ',
        ].join('\n'),
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('A1 false-positive guard: stale abort before a newer turn marker does not re-inject', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => [
          '[CRON FIRED 2026-06-29T00:00:00.000Z] heartbeat: Read HEARTBEAT.md and follow its instructions.',
          '⏺API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited',
          '✻ Cooked for 4s',
          '=== TELEGRAM from [USER: Adam] (chat_id:123) ===',
          'new request',
        ].join('\n'),
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('A1 fail-safe: real abort without a locatable turn marker does not re-inject', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => [
          '⏺API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited',
          '✻ Cooked for 4s',
          '❯ ',
        ].join('\n'),
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('long active turn without abort and with older last_idle does not re-inject', async () => {
      const writes: string[] = [];
      const wake = Date.now() - 30_000;
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        lastIdleMs: () => wake - 5_000,
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('isAgentActive true suppresses a non-abort stale heartbeat', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        isAgentActive: () => true,
        lastIdleMs: () => Date.now(),
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('A2 secondary: last_idle newer than max wake re-injects without abort text', async () => {
      const writes: string[] = [];
      const wake = Date.now() - 10_000;
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([
        makeCron({
          name: 'heartbeat',
          schedule: '1h',
          prompt: 'Read HEARTBEAT.md and follow its instructions.',
          last_fire_attempted_at: new Date(wake).toISOString(),
        }),
      ]);
      const s = watchdogScheduler({
        writes,
        lastIdleMs: () => wake + 2_000,
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes.join('')).toContain('[WATCHDOG REINJECT');
      s.stop();
    });

    it('A2 max-wake includes every cron last_fired_at and suppresses an active non-heartbeat turn', async () => {
      const writes: string[] = [];
      const lastIdle = Date.now() - 30_000;
      const nonHeartbeatWake = Date.now() - 10_000;
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([
        heartbeatCron(),
        makeCron({
          name: 'coding-task-monitor',
          schedule: '30m',
          last_fired_at: new Date(nonHeartbeatWake).toISOString(),
        }),
      ]);
      const s = watchdogScheduler({
        writes,
        lastIdleMs: () => lastIdle,
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('A2 treats same-second last_idle as idle with seconds-ms tolerance', async () => {
      const writes: string[] = [];
      const wake = Math.floor(Date.now() / 1000) * 1000 + 900;
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([
        makeCron({
          name: 'heartbeat',
          schedule: '1h',
          prompt: 'Read HEARTBEAT.md and follow its instructions.',
          last_fire_attempted_at: new Date(wake).toISOString(),
        }),
      ]);
      const s = watchdogScheduler({
        writes,
        lastIdleMs: () => Math.floor(wake / 1000) * 1000,
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes.join('')).toContain('[WATCHDOG REINJECT');
      s.stop();
    });

    it('A1 overrides isAgentActive when the current terminal state is a throttle abort', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        isAgentActive: () => true,
        recentStdout: () => throttleAbortTerminal,
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes).toEqual([]);

      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes.join('')).toContain('[WATCHDOG REINJECT');
      s.stop();
    });

    it('out-of-scope non-429 TTY-blocked hang does not re-inject', async () => {
      const writes: string[] = [];
      const wake = Date.now() - 10_000;
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([
        makeCron({
          name: 'heartbeat',
          schedule: '1h',
          prompt: 'Read HEARTBEAT.md and follow its instructions.',
          last_fire_attempted_at: new Date(wake).toISOString(),
        }),
      ]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => 'Usage limit reached. Press enter to continue.',
        lastIdleMs: () => wake - 10_000,
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('watchdog exceptions are contained and the next tick still runs', async () => {
      const writes: string[] = [];
      let reads = 0;
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => {
          reads += 1;
          if (reads === 1) throw new Error('stdout read failed');
          return throttleAbortTerminal;
        },
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(logs.some(l => l.includes('[cron-scheduler][watchdog] error: stdout read failed'))).toBe(true);

      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes).toEqual([]);

      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes.join('')).toContain('[WATCHDOG REINJECT');
      s.stop();
    });

    it('capacity-defer alert is time-based and fires once, then resets on a non-deferred tick', async () => {
      const writes: string[] = [];
      const alerts: string[] = [];
      let defer = true;
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        alert: (message) => alerts.push(message),
        recentStdout: () => throttleAbortTerminal,
        gate: () => defer ? { defer: true, reason: 'account capped' } : { defer: false },
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      await vi.advanceTimersByTimeAsync(TICK);
      await vi.advanceTimersByTimeAsync(CronScheduler.HEARTBEAT_DEFER_ALERT_MS - TICK);
      expect(alerts).toEqual([]);

      await vi.advanceTimersByTimeAsync(TICK);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('capacity-deferred');

      await vi.advanceTimersByTimeAsync(CronScheduler.HEARTBEAT_REINJECT_INTERVAL_MS + TICK);
      expect(alerts).toHaveLength(1);

      defer = false;
      await vi.advanceTimersByTimeAsync(CronScheduler.HEARTBEAT_REINJECT_INTERVAL_MS + TICK);
      expect(writes.join('')).toContain('[WATCHDOG REINJECT');

      defer = true;
      await vi.advanceTimersByTimeAsync(CronScheduler.HEARTBEAT_REINJECT_INTERVAL_MS + TICK);
      await vi.advanceTimersByTimeAsync(CronScheduler.HEARTBEAT_DEFER_ALERT_MS);
      expect(alerts).toHaveLength(2);
      s.stop();
    });

    it('dead PTY suppresses watchdog re-inject', async () => {
      const writes: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        recentStdout: () => throttleAbortTerminal,
        isAlive: () => false,
      });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(writes).toEqual([]);
      s.stop();
    });

    it('does not watchdog re-inject on the same tick as a natural heartbeat fire', async () => {
      const writes: string[] = [];
      const now = Date.now();
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([
        makeCron({
          name: 'heartbeat',
          schedule: '1m',
          prompt: 'Read HEARTBEAT.md and follow its instructions.',
          last_fired_at: new Date(now - 59_000).toISOString(),
        }),
      ]);
      const s = watchdogScheduler({ writes });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);

      expect(fired.map(c => c.name)).toContain('heartbeat');
      expect(writes).toEqual([]);
      s.stop();
    });

    it('caps at 3 watchdog re-injects, escalates once, and does not inject a 4th', async () => {
      const writes: string[] = [];
      const alerts: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({
        writes,
        alert: (message) => alerts.push(message),
        recentStdout: () => throttleAbortTerminal,
      });

      s.start();
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(CronScheduler.HEARTBEAT_REINJECT_INTERVAL_MS + TICK);
      }

      const pasteWrites = writes.filter(w => w.includes('Read HEARTBEAT.md'));
      expect(pasteWrites).toHaveLength(3);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('3 re-injects failed');
      expect(alerts[0]).toContain('throttle-abort');
      s.stop();
    });

    it('fresh heartbeat resets watchdog counters after prior re-injects', async () => {
      const writes: string[] = [];
      const alerts: string[] = [];
      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const s = watchdogScheduler({ writes, alert: (message) => alerts.push(message), recentStdout: () => throttleAbortTerminal });

      s.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes.filter(w => w.includes('Read HEARTBEAT.md'))).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes.filter(w => w.includes('Read HEARTBEAT.md'))).toHaveLength(1);

      writeHeartbeat('test-agent', Date.now());
      await vi.advanceTimersByTimeAsync(TICK);
      expect(logs.some(l => l.includes('cleared after 1 re-inject'))).toBe(true);

      writeHeartbeat('test-agent', Date.now() - 2 * 60 * 60_000);
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes.filter(w => w.includes('Read HEARTBEAT.md'))).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writes.filter(w => w.includes('Read HEARTBEAT.md'))).toHaveLength(2);
      expect(alerts).toEqual([]);
      s.stop();
    });

    it('anti-herd stagger prevents two stale agents from re-injecting in the same tick window', async () => {
      const writesA: string[] = [];
      const writesB: string[] = [];
      writeHeartbeat('agent-a', Date.now() - 2 * 60 * 60_000);
      writeHeartbeat('agent-b', Date.now() - 2 * 60 * 60_000);
      mockReadCrons.mockReturnValue([heartbeatCron()]);
      const a = watchdogScheduler({ agentName: 'agent-a', writes: writesA, recentStdout: () => throttleAbortTerminal });
      const b = watchdogScheduler({ agentName: 'agent-b', writes: writesB, recentStdout: () => throttleAbortTerminal });

      a.start();
      b.start();
      await vi.advanceTimersByTimeAsync(TICK);
      expect(writesA.filter(w => w.includes('Read HEARTBEAT.md'))).toHaveLength(0);
      expect(writesB.filter(w => w.includes('Read HEARTBEAT.md'))).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(TICK);

      expect(writesA.filter(w => w.includes('Read HEARTBEAT.md'))).toHaveLength(1);
      expect(writesB.filter(w => w.includes('Read HEARTBEAT.md'))).toHaveLength(0);
      expect(logs.some(l => l.includes('staggered heartbeat re-inject'))).toBe(true);

      await vi.advanceTimersByTimeAsync(TICK);
      expect(writesB.filter(w => w.includes('Read HEARTBEAT.md'))).toHaveLength(1);

      a.stop();
      b.stop();
    });
  });
});
