import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readCodexUsage } from '../../../src/bus/codex-usage';

describe('readCodexUsage', () => {
  let home: string;
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'codex-home-')); });
  afterEach(() => { rmSync(home, { recursive: true, force: true }); });

  function writeRollout(dateParts: string[], name: string, lines: string[]) {
    const dir = join(home, 'sessions', ...dateParts);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), lines.join('\n') + '\n');
  }

  it('returns null when there are no sessions', () => {
    expect(readCodexUsage(home)).toBeNull();
  });

  it('parses primary/secondary/plan from the rate_limits in a rollout line', () => {
    writeRollout(['2026', '06', '11'], 'rollout-2026-06-11T10-00-00-abc.jsonl', [
      JSON.stringify({ type: 'event', payload: { rate_limits: {
        limit_id: 'codex', plan_type: 'pro',
        primary: { used_percent: 12, window_minutes: 300, resets_at: 1781153962 },
        secondary: { used_percent: 88, window_minutes: 10080, resets_at: 1781560275 },
        rate_limit_reached_type: null,
      } } }),
    ]);
    const u = readCodexUsage(home)!;
    expect(u.primary).toEqual({ used_percent: 12, window_minutes: 300, resets_at: 1781153962 });
    expect(u.secondary?.used_percent).toBe(88);
    expect(u.plan_type).toBe('pro');
    expect(u.rate_limit_reached).toBe(false);
  });

  it('takes the LAST rate_limits line in a file (most recent reading)', () => {
    writeRollout(['2026', '06', '11'], 'rollout-2026-06-11T11-00-00-def.jsonl', [
      JSON.stringify({ rate_limits: { primary: { used_percent: 5, window_minutes: 300 } } }),
      JSON.stringify({ other: 'event' }),
      JSON.stringify({ rate_limits: { primary: { used_percent: 40, window_minutes: 300 }, rate_limit_reached_type: 'primary' } }),
    ]);
    const u = readCodexUsage(home)!;
    expect(u.primary?.used_percent).toBe(40);
    expect(u.rate_limit_reached).toBe(true);
  });

  it('prefers the NEWEST rollout file across dates', () => {
    writeRollout(['2026', '06', '01'], 'rollout-2026-06-01T10-00-00-old.jsonl', [
      JSON.stringify({ rate_limits: { primary: { used_percent: 99, window_minutes: 300 } } }),
    ]);
    // newer file (later mtime by writing second) with a different value
    writeRollout(['2026', '06', '11'], 'rollout-2026-06-11T10-00-00-new.jsonl', [
      JSON.stringify({ rate_limits: { primary: { used_percent: 3, window_minutes: 300 } } }),
    ]);
    expect(readCodexUsage(home)!.primary?.used_percent).toBe(3);
  });

  it('skips files without rate_limits and tolerates malformed lines', () => {
    writeRollout(['2026', '06', '11'], 'rollout-2026-06-11T12-00-00-x.jsonl', [
      'not json at all',
      JSON.stringify({ no: 'limits here' }),
      '{ broken',
      JSON.stringify({ rate_limits: { secondary: { used_percent: 7, window_minutes: 10080 } } }),
    ]);
    expect(readCodexUsage(home)!.secondary?.used_percent).toBe(7);
  });
});
