import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

const execFileMock = vi.fn();
vi.mock('child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

import {
  readMaxCrashesPerDay,
  notifyAgents,
  classifyFromMarkers,
  buildCrashLogEventArgs,
  readLatestCrashReason,
  main,
} from '../../../src/hooks/hook-crash-alert';
import { clearEndMarkers } from '../../../src/bus/heartbeat';

describe('readMaxCrashesPerDay', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'crashalert-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('returns null when agentDir is undefined', () => {
    expect(readMaxCrashesPerDay(undefined)).toBeNull();
  });

  it('returns null when config.json is missing', () => {
    expect(readMaxCrashesPerDay(tmp)).toBeNull();
  });

  it('returns null when config.json is malformed', () => {
    writeFileSync(join(tmp, 'config.json'), '{ not valid json', 'utf-8');
    expect(readMaxCrashesPerDay(tmp)).toBeNull();
  });

  it('returns null when max_crashes_per_day is missing', () => {
    writeFileSync(join(tmp, 'config.json'), JSON.stringify({ agent_name: 'x' }), 'utf-8');
    expect(readMaxCrashesPerDay(tmp)).toBeNull();
  });

  it('returns the configured number when present', () => {
    writeFileSync(join(tmp, 'config.json'), JSON.stringify({ max_crashes_per_day: 10 }), 'utf-8');
    expect(readMaxCrashesPerDay(tmp)).toBe(10);
  });

  it('returns null when max_crashes_per_day is not a number', () => {
    writeFileSync(join(tmp, 'config.json'), JSON.stringify({ max_crashes_per_day: 'ten' }), 'utf-8');
    expect(readMaxCrashesPerDay(tmp)).toBeNull();
  });
});

describe('notifyAgents', () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it('sends one bus send-message per recipient', () => {
    notifyAgents({
      agentName: 'dev',
      endType: 'crash',
      reason: 'uncaught exception',
      lastTask: 'building hooks',
      crashCount: 2,
      restartAttempted: true,
      recipients: ['the-analyst', 'the-orchestrator'],
    });
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });

  it('uses cortextos bus send-message with priority high', () => {
    notifyAgents({
      agentName: 'dev',
      endType: 'crash',
      reason: 'r',
      lastTask: 't',
      crashCount: 1,
      restartAttempted: true,
      recipients: ['the-analyst'],
    });
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe('cortextos');
    expect(args.slice(0, 4)).toEqual(['bus', 'send-message', 'the-analyst', 'high']);
  });

  it('routes crash bus alerts only to canonical recipients', () => {
    notifyAgents({
      agentName: 'dev',
      endType: 'crash',
      reason: 'r',
      lastTask: 't',
      crashCount: 1,
      restartAttempted: true,
      recipients: ['the-analyst', 'the-orchestrator'],
    });
    const recipients = execFileMock.mock.calls.map((call) => call[1][2]);
    expect(recipients).toEqual(['the-analyst', 'the-orchestrator']);
    expect(recipients).not.toContain('chief');
    expect(recipients).not.toContain('analyst');
  });

  it('main crash route uses canonical recipients', () => {
    const source = readFileSync(join(process.cwd(), 'src/hooks/hook-crash-alert.ts'), 'utf-8');
    const callSite = source.match(/notifyAgents\(\{[\s\S]*?recipients: \[([^\]]+)\]/);
    expect(callSite?.[1]).toBe("'the-analyst', 'the-orchestrator'");
    expect(callSite?.[1]).not.toContain("'chief'");
    expect(callSite?.[1]).not.toContain("'analyst'");
  });

  it('body includes all required fields', () => {
    notifyAgents({
      agentName: 'dev',
      endType: 'daemon-crashed',
      reason: 'PTY null write',
      lastTask: 'idle',
      crashCount: 3,
      restartAttempted: false,
      recipients: ['the-analyst'],
    });
    const body: string = execFileMock.mock.calls[0][1][4];
    expect(body).toContain('agent=dev');
    expect(body).toContain('type=daemon-crashed');
    expect(body).toContain('reason: PTY null write');
    expect(body).toContain('last status: idle');
    expect(body).toContain('crashes today: 3');
    expect(body).toContain('restart attempted: no');
  });

  it('marks restart attempted yes when crashCount under limit', () => {
    notifyAgents({
      agentName: 'dev',
      endType: 'crash',
      reason: '',
      lastTask: '',
      crashCount: 1,
      restartAttempted: true,
      recipients: ['the-analyst'],
    });
    expect(execFileMock.mock.calls[0][1][4]).toContain('restart attempted: yes');
  });

  it('uses fallback strings when reason and lastTask are empty', () => {
    notifyAgents({
      agentName: 'dev',
      endType: 'crash',
      reason: '',
      lastTask: '',
      crashCount: 1,
      restartAttempted: true,
      recipients: ['the-analyst'],
    });
    const body: string = execFileMock.mock.calls[0][1][4];
    expect(body).toContain('reason: none');
    expect(body).toContain('last status: unknown');
  });

  it('does not throw when execFile throws synchronously', () => {
    execFileMock.mockImplementationOnce(() => { throw new Error('exec failed'); });
    expect(() => notifyAgents({
      agentName: 'dev',
      endType: 'crash',
      reason: '',
      lastTask: '',
      crashCount: 1,
      restartAttempted: true,
      recipients: ['the-analyst', 'the-orchestrator'],
    })).not.toThrow();
    // Second recipient still attempted
    expect(execFileMock).toHaveBeenCalledTimes(2);
  });
});

describe('buildCrashLogEventArgs', () => {
  it('builds a durable crash event independent of alert recipients', () => {
    const args = buildCrashLogEventArgs({
      agentName: 'dev',
      endType: 'crash',
      reason: 'uncaught',
      lastTask: 'task x',
      crashCount: 4,
      restartAttempted: false,
    });

    expect(args.slice(0, 5)).toEqual(['bus', 'log-event', 'error', 'agent_crash', 'error']);
    expect(args[5]).toBe('--meta');
    expect(JSON.parse(args[6])).toEqual({
      agent: 'dev',
      end_type: 'crash',
      reason: 'uncaught',
      last_status: 'task x',
      crashes_today: 4,
      restart_attempted: false,
    });
  });

  it('uses fallback values for empty reason and status', () => {
    const args = buildCrashLogEventArgs({
      agentName: 'dev',
      endType: 'daemon-crashed',
      reason: '',
      lastTask: '',
      crashCount: 0,
      restartAttempted: true,
    });

    expect(JSON.parse(args[6])).toMatchObject({
      reason: 'none',
      last_status: 'unknown',
    });
  });
});

describe('readLatestCrashReason', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'crashalert-reason-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('uses the latest temporally-matching unplanned restart entry for real crash reasons', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'restarts.log'), [
      '[2026-07-25T01:00:00Z] SELF-RESTART: routine',
      '[2026-07-25T01:01:00Z] CRASH: exit_code=1 crash_count=1 backoff_s=5',
      '[2026-07-25T01:02:00Z] CRASH_LOOP: exit_code=1 crash_count=3 backoff_s=0',
    ].join('\n') + '\n', 'utf-8');

    expect(readLatestCrashReason(tmp, 'crash', '', new Date('2026-07-25T01:02:03Z'))).toBe(
      'CRASH_LOOP exit_code=1 crash_count=3 backoff_s=0',
    );
  });

  it('prefers none over a stale restart entry from a different crash', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'restarts.log'), [
      '[2026-06-07T21:52:57Z] CRASH: exit_code=143 crash_count=1 backoff_s=5',
    ].join('\n') + '\n', 'utf-8');

    expect(readLatestCrashReason(tmp, 'crash', 'none', new Date('2026-07-25T01:02:03Z'))).toBe('none');
  });

  it('adds bounded stderr detail when available', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'restarts.log'), '[2026-07-25T01:01:00Z] CRASH: exit_code=1 crash_count=1 backoff_s=5\n', 'utf-8');
    writeFileSync(join(tmp, 'stderr.log'), 'older\nTypeError: pty.write is not a function\nat worker-process.ts:93\n', 'utf-8');

    expect(readLatestCrashReason(tmp, 'crash', '', new Date('2026-07-25T01:01:04Z'))).toBe(
      'CRASH exit_code=1 crash_count=1 backoff_s=5 stderr_tail=older | TypeError: pty.write is not a function | at worker-process.ts:93',
    );
  });

  it('does not attach stderr detail to an otherwise un-attributed crash', () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, 'stderr.log'), 'old unrelated stderr\n', 'utf-8');

    expect(readLatestCrashReason(tmp, 'crash', 'none', new Date('2026-07-25T01:01:04Z'))).toBe('none');
  });

  it('keeps marker reasons for non-crash end types and falls back when no crash detail exists', () => {
    expect(readLatestCrashReason(tmp, 'daemon-crashed', '2026-07-25T01:00:00Z')).toBe('2026-07-25T01:00:00Z');
    expect(readLatestCrashReason(tmp, 'crash', 'none')).toBe('none');
  });
});

describe('classifyFromMarkers', () => {
  let tmp: string;
  const MARKERS = [
    { file: '.restart-planned', type: 'planned-restart' },
    { file: '.session-refresh', type: 'session-refresh' },
    { file: '.user-restart', type: 'user-restart' },
    { file: '.user-stop', type: 'user-stop' },
  ];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'crashalert-markers-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('no marker present → endType crash', () => {
    expect(classifyFromMarkers(tmp, MARKERS).endType).toBe('crash');
  });

  it('fresh marker → classified by type, with its reason', () => {
    writeFileSync(join(tmp, '.restart-planned'), 'planned reboot', 'utf-8');
    const r = classifyFromMarkers(tmp, MARKERS);
    expect(r.endType).toBe('planned-restart');
    expect(r.reason).toBe('planned reboot');
  });

  it('does NOT consume the marker — both firings of a restart see it', () => {
    writeFileSync(join(tmp, '.session-refresh'), 'rollover', 'utf-8');
    // Firing #1 — the dying PTY's SessionEnd.
    expect(classifyFromMarkers(tmp, MARKERS).endType).toBe('session-refresh');
    // Firing #2 — the next PTY's fresh-launch cleanup. Marker must still be
    // there: this is the FP that the old unlink-on-read code produced.
    expect(classifyFromMarkers(tmp, MARKERS).endType).toBe('session-refresh');
    expect(existsSync(join(tmp, '.session-refresh'))).toBe(true);
  });

  it('marker older than the TTL → treated as stale: ignored AND lazy-unlinked', () => {
    const markerPath = join(tmp, '.restart-planned');
    writeFileSync(markerPath, 'stale planned restart', 'utf-8');
    // Simulate a marker whose first-heartbeat clear never fired (failed
    // start): classify with a "now" well past the 5-minute TTL.
    const farFuture = Date.now() + 10 * 60 * 1000;
    const r = classifyFromMarkers(tmp, MARKERS, farFuture);
    expect(r.endType).toBe('crash'); // stale marker must NOT mask a real crash
    expect(existsSync(markerPath)).toBe(false); // lazy-unlinked
  });

  it('first matching marker wins (precedence order preserved)', () => {
    writeFileSync(join(tmp, '.restart-planned'), 'planned', 'utf-8');
    writeFileSync(join(tmp, '.user-stop'), 'stopped', 'utf-8');
    expect(classifyFromMarkers(tmp, MARKERS).endType).toBe('planned-restart');
  });
});

describe('clearEndMarkers (via heartbeat)', () => {
  let tmp: string;
  const ALL = ['.restart-planned', '.session-refresh', '.user-restart', '.user-stop', '.daemon-stop'];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'crashalert-clear-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('a post-grace heartbeat removes every pending end-type marker', () => {
    for (const f of ALL) writeFileSync(join(tmp, f), 'x', 'utf-8');
    // nowMs well past the grace window — the markers are no longer in-flight.
    clearEndMarkers(tmp, Date.now() + 10 * 60 * 1000);
    for (const f of ALL) expect(existsSync(join(tmp, f))).toBe(false);
  });

  it('leaves a fresh (within-grace) marker in place — an in-flight restart', () => {
    for (const f of ALL) writeFileSync(join(tmp, f), 'x', 'utf-8');
    // nowMs ≈ marker mtime → every marker is within the grace window.
    clearEndMarkers(tmp);
    for (const f of ALL) expect(existsSync(join(tmp, f))).toBe(true);
  });

  it('is a no-op when no markers are present', () => {
    expect(() => clearEndMarkers(tmp)).not.toThrow();
  });
});

describe('marker lifecycle (classify → clearEndMarkers → classify)', () => {
  let tmp: string;
  const MARKERS = [
    { file: '.restart-planned', type: 'planned-restart' },
    { file: '.session-refresh', type: 'session-refresh' },
    { file: '.user-restart', type: 'user-restart' },
    { file: '.user-stop', type: 'user-stop' },
  ];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'crashalert-lifecycle-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('both restart firings classify, a post-grace heartbeat clears, then a real crash classifies as crash', () => {
    writeFileSync(join(tmp, '.restart-planned'), 'planned reboot', 'utf-8');
    // Firing #1 and #2 of the dying restart — both must see the marker.
    expect(classifyFromMarkers(tmp, MARKERS).endType).toBe('planned-restart');
    expect(classifyFromMarkers(tmp, MARKERS).endType).toBe('planned-restart');
    // Post-restart session heartbeats past the grace window → marker cleared.
    clearEndMarkers(tmp, Date.now() + 10 * 60 * 1000);
    expect(existsSync(join(tmp, '.restart-planned'))).toBe(false);
    // A genuine crash AFTER the clear must classify as crash — not be masked.
    expect(classifyFromMarkers(tmp, MARKERS).endType).toBe('crash');
  });

  it('a heartbeat DURING the in-flight restart (within grace) does NOT wipe the marker — firing#2 still classifies', () => {
    // This is the Finding-1 race: a fast-booting successor heartbeats before
    // the dying restart's second SessionEnd firing lands.
    writeFileSync(join(tmp, '.session-refresh'), 'rollover', 'utf-8');
    expect(classifyFromMarkers(tmp, MARKERS).endType).toBe('session-refresh'); // firing #1
    clearEndMarkers(tmp); // successor's first heartbeat — marker still within grace
    expect(existsSync(join(tmp, '.session-refresh'))).toBe(true);
    expect(classifyFromMarkers(tmp, MARKERS).endType).toBe('session-refresh'); // firing #2 — no false crash
  });
});

describe('main SessionEnd reason classification', () => {
  const originalEnv = { ...process.env };
  let roots: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-16T19:00:00Z'));
    execFileMock.mockReset();
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (typeof cb === 'function') cb(null, '', '');
      return {};
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots = [];
  });

  async function runHook(payload: Record<string, unknown>, setup?: (paths: {
    root: string;
    stateDir: string;
    logDir: string;
    agentDir: string;
  }) => void) {
    const instanceId = `crashalert-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const root = join(homedir(), '.cortextos', instanceId);
    const agentName = 'dev-agent';
    const stateDir = join(root, 'state', agentName);
    const logDir = join(root, 'logs', agentName);
    const agentDir = mkdtempSync(join(tmpdir(), 'crashalert-agent-'));
    roots.push(root, agentDir);
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(stateDir, 'heartbeat.json'), JSON.stringify({ status: 'idle' }), 'utf-8');
    writeFileSync(join(agentDir, 'config.json'), JSON.stringify({ max_crashes_per_day: 10 }), 'utf-8');
    setup?.({ root, stateDir, logDir, agentDir });

    process.env.CTX_AGENT_NAME = agentName;
    process.env.CTX_INSTANCE_ID = instanceId;
    process.env.CTX_AGENT_DIR = agentDir;
    process.env.CTX_FRAMEWORK_ROOT = '/tmp/fake-framework-root';

    const done = main();
    process.nextTick(() => {
      process.stdin.emit('data', Buffer.from(JSON.stringify(payload)));
      process.stdin.emit('end');
    });
    await done;

    const crashLog = readFileSync(join(logDir, 'crashes.log'), 'utf-8').trim();
    const countPath = join(stateDir, '.crash_count_today');
    const countText = existsSync(countPath) ? readFileSync(countPath, 'utf-8') : '';
    const calls = execFileMock.mock.calls.map((call) => ({
      cmd: call[0],
      args: call[1] as string[],
    }));
    return { stateDir, logDir, crashLog, countText, calls };
  }

  function cliArgs(calls: { args: string[] }[]): string[][] {
    return calls.map((call) => call.args.slice(1));
  }

  it('reason=clear with no marker records session-end without crash count or notifyAgents', async () => {
    const result = await runHook({ session_id: 's-clear', reason: 'clear' });

    expect(result.crashLog).toContain('type=session-end');
    expect(result.crashLog).toContain('session=s-clear');
    expect(result.crashLog).toContain('end_reason=clear');
    expect(result.countText).toBe('');
    expect(cliArgs(result.calls).some((args) => args.includes('send-message'))).toBe(false);
    const gracefulEvent = cliArgs(result.calls).find((args) => args.includes('graceful_session_end'));
    expect(gracefulEvent).toBeTruthy();
    expect(JSON.parse(gracefulEvent?.at(-1) ?? '{}')).toEqual({ agent: 'dev-agent', reason: 'clear' });
  });

  it.each(['resume', 'logout'])('reason=%s with no marker records session-end', async (reason) => {
    const result = await runHook({ session_id: `s-${reason}`, reason });

    expect(result.crashLog).toContain('type=session-end');
    expect(result.crashLog).toContain(`end_reason=${reason}`);
    expect(result.countText).toBe('');
    expect(cliArgs(result.calls).some((args) => args.includes('send-message'))).toBe(false);
  });

  it('NEGATIVE CONTROL reason=other with no marker still records crash, increments count, and notifies agents', async () => {
    const result = await runHook({ session_id: 's-other', reason: 'other' });

    expect(result.crashLog).toContain('type=crash');
    expect(result.crashLog).toContain('end_reason=other');
    expect(result.countText).toMatch(/^\d{4}-\d{2}-\d{2}:1$/);
    const sendMessageCalls = cliArgs(result.calls).filter((args) => args.includes('send-message'));
    expect(sendMessageCalls).toHaveLength(2);
    expect(sendMessageCalls.map((args) => args[2])).toEqual(['the-analyst', 'the-orchestrator']);
  });

  it('NEGATIVE CONTROL reason=prompt_input_exit with no marker still records crash', async () => {
    const result = await runHook({ session_id: 's-prompt', reason: 'prompt_input_exit' });

    expect(result.crashLog).toContain('type=crash');
    expect(result.crashLog).toContain('end_reason=prompt_input_exit');
    expect(result.countText).toMatch(/^\d{4}-\d{2}-\d{2}:1$/);
  });

  it('NEGATIVE CONTROL missing reason with no marker still records crash and end_reason=none', async () => {
    const result = await runHook({ session_id: 's-missing' });

    expect(result.crashLog).toContain('type=crash');
    expect(result.crashLog).toContain('end_reason=none');
    expect(result.countText).toMatch(/^\d{4}-\d{2}-\d{2}:1$/);
  });

  it('marker precedence: session-refresh marker wins even when reason=other', async () => {
    const result = await runHook(
      { session_id: 's-marker', reason: 'other' },
      ({ stateDir }) => writeFileSync(join(stateDir, '.session-refresh'), 'rollover', 'utf-8'),
    );

    expect(result.crashLog).toContain('type=session-refresh');
    expect(result.crashLog).toContain('reason=rollover');
    expect(result.crashLog).toContain('end_reason=other');
    expect(result.countText).toBe('');
    expect(cliArgs(result.calls).some((args) => args.includes('context_session_refresh'))).toBe(true);
  });
});
