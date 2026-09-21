/**
 * Plan, apply, and revert one-cycle max_session_seconds jitter for the
 * session-time-cap rollover herd.
 *
 * Exit codes:
 *   0 = requested operation succeeded
 *   1 = plan validation failed or operation refused
 *   2 = invalid CLI usage
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { atomicWriteSync } from '../src/utils/atomic';

const FLOOR_SECONDS = 120;
const STEP_SECONDS = 90;
const MIN_OFFSET_SECONDS = 5;
const MIN_LANDED_GAP_SECONDS = 60;

export interface Target {
  org: string;
  agent: string;
  group: 'daily' | 'seventy-one-hour' | string;
}

export interface JitterOptions {
  repoRoot: string;
  logsRoot: string;
  statePath: string;
  targets: Target[];
  floorSeconds?: number;
  stepSeconds?: number;
  minOffsetSeconds?: number;
  minGapSeconds?: number;
}

export interface PlanRow extends Target {
  configPath: string;
  logPath: string;
  baselineSeconds: number;
  phaseMs: number;
  lastRefreshAt: string;
  rank: number;
  offsetSeconds: number;
  phase1Seconds: number;
  landed1At: string;
  landed2At: string;
}

export interface PlanResult {
  rows: PlanRow[];
  errors: string[];
  verdict: 'PASS' | 'FAIL';
}

interface StateEntry extends Target {
  configPath: string;
  logPath: string;
  baselineSeconds: number;
  phase1Seconds: number;
  offsetSeconds: number;
}

interface JitterState {
  appliedAt: string;
  entries: StateEntry[];
  revertedAt?: string;
}

const DEFAULT_TARGETS: Target[] = [
  { org: 'clean-green-marketing', agent: 'claude-dev-agent', group: 'daily' },
  { org: 'clean-green-marketing', agent: 'cro-agent', group: 'daily' },
  { org: 'clean-green-marketing', agent: 'meta-ads-agent', group: 'daily' },
  { org: 'clean-green-marketing', agent: 'meta-compliance-agent', group: 'daily' },
  { org: 'clean-green-marketing', agent: 'meta-media-buyer-agent', group: 'daily' },
  { org: 'clean-green-marketing', agent: 'the-ad-strategist', group: 'daily' },
  { org: 'clean-green-marketing', agent: 'the-orchestrator', group: 'daily' },
  { org: 'clean-green-marketing', agent: 'the-team-lead', group: 'daily' },
  { org: 'atwood', agent: 'atwood-analyst', group: 'seventy-one-hour' },
  { org: 'atwood', agent: 'atwood-orchestrator', group: 'seventy-one-hour' },
  { org: 'clean-green-marketing', agent: 'research-agent', group: 'seventy-one-hour' },
  { org: 'clean-green-marketing', agent: 'the-axon-agent', group: 'seventy-one-hour' },
  { org: 'clean-green-marketing', agent: 'the-production-house', group: 'seventy-one-hour' },
  { org: 'clean-green-marketing', agent: 'vitalis', group: 'seventy-one-hour' },
];

function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function writeJsonAtomic(path: string, value: unknown): void {
  atomicWriteSync(path, JSON.stringify(value, null, 2));
}

function configPath(repoRoot: string, target: Target): string {
  return join(repoRoot, 'orgs', target.org, 'agents', target.agent, 'config.json');
}

function logPath(logsRoot: string, target: Target): string {
  return join(logsRoot, target.agent, 'crashes.log');
}

export function latestSessionRefreshAt(path: string): Date | null {
  if (!existsSync(path)) return null;

  let latest: Date | null = null;
  for (const line of readFileSync(path, 'utf-8').split(/\r?\n/)) {
    if (!line.includes('type=session-refresh')) continue;
    const match = line.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)/);
    if (!match) continue;
    const parsed = new Date(match[1]);
    if (Number.isNaN(parsed.getTime())) continue;
    if (latest === null || parsed > latest) latest = parsed;
  }
  return latest;
}

export function buildPlan(opts: JitterOptions): PlanResult {
  const floorSeconds = opts.floorSeconds ?? FLOOR_SECONDS;
  const stepSeconds = opts.stepSeconds ?? STEP_SECONDS;
  const minOffsetSeconds = opts.minOffsetSeconds ?? MIN_OFFSET_SECONDS;
  const minGapSeconds = opts.minGapSeconds ?? MIN_LANDED_GAP_SECONDS;
  const rows: PlanRow[] = [];
  const errors: string[] = [];
  const groups = new Map<string, PlanRow[]>();

  for (const target of opts.targets) {
    const cfgPath = configPath(opts.repoRoot, target);
    const crashLogPath = logPath(opts.logsRoot, target);
    if (!existsSync(cfgPath)) {
      errors.push(`${target.org}/${target.agent}: missing config ${cfgPath}`);
      continue;
    }

    const cfg = readJson(cfgPath);
    const baseline = cfg.max_session_seconds;
    if (typeof baseline !== 'number' || !Number.isFinite(baseline) || baseline <= 0) {
      errors.push(`${target.org}/${target.agent}: invalid max_session_seconds ${String(baseline)}`);
      continue;
    }

    const latest = latestSessionRefreshAt(crashLogPath);
    if (latest === null) {
      errors.push(`${target.org}/${target.agent}: no session-refresh found in ${crashLogPath}`);
      continue;
    }

    const row: PlanRow = {
      ...target,
      configPath: cfgPath,
      logPath: crashLogPath,
      baselineSeconds: baseline,
      phaseMs: positiveModulo(latest.getTime(), baseline * 1000),
      lastRefreshAt: latest.toISOString(),
      rank: -1,
      offsetSeconds: -1,
      phase1Seconds: -1,
      landed1At: '',
      landed2At: '',
    };
    rows.push(row);
    const groupRows = groups.get(target.group) ?? [];
    groupRows.push(row);
    groups.set(target.group, groupRows);
  }

  for (const [group, groupRows] of groups) {
    groupRows.sort((a, b) => a.phaseMs - b.phaseMs || a.agent.localeCompare(b.agent));
    for (const [idx, row] of groupRows.entries()) {
      const offsetSeconds = floorSeconds + idx * stepSeconds;
      const lastRefreshMs = new Date(row.lastRefreshAt).getTime();
      row.rank = idx;
      row.offsetSeconds = offsetSeconds;
      row.phase1Seconds = row.baselineSeconds + offsetSeconds;
      row.landed1At = new Date(lastRefreshMs + offsetSeconds * 1000).toISOString();
      row.landed2At = new Date(lastRefreshMs + offsetSeconds * 2000).toISOString();

      if (offsetSeconds <= minOffsetSeconds) {
        errors.push(`${row.org}/${row.agent}: offset ${offsetSeconds}s does not exceed ${minOffsetSeconds}s floor`);
      }
      if (row.phase1Seconds <= row.baselineSeconds) {
        errors.push(`${row.org}/${row.agent}: phase1 value is not add-only`);
      }
    }

    for (const model of ['landed1At', 'landed2At'] as const) {
      const sorted = [...groupRows].sort((a, b) => Date.parse(a[model]) - Date.parse(b[model]));
      for (let idx = 1; idx < sorted.length; idx++) {
        const prev = sorted[idx - 1];
        const curr = sorted[idx];
        const gapSeconds = (Date.parse(curr[model]) - Date.parse(prev[model])) / 1000;
        if (gapSeconds < minGapSeconds) {
          errors.push(`${group}: ${model} gap ${gapSeconds.toFixed(3)}s between ${prev.agent} and ${curr.agent} is below ${minGapSeconds}s`);
        }
      }
    }
  }

  rows.sort((a, b) => a.group.localeCompare(b.group) || a.rank - b.rank || a.agent.localeCompare(b.agent));
  return { rows, errors, verdict: errors.length === 0 ? 'PASS' : 'FAIL' };
}

function gapLines(rows: PlanRow[], model: 'landed1At' | 'landed2At'): string[] {
  const lines: string[] = [];
  const groups = new Map<string, PlanRow[]>();
  for (const row of rows) {
    const groupRows = groups.get(row.group) ?? [];
    groupRows.push(row);
    groups.set(row.group, groupRows);
  }

  for (const [group, groupRows] of groups) {
    const sorted = [...groupRows].sort((a, b) => Date.parse(a[model]) - Date.parse(b[model]));
    lines.push(`${group} ${model} adjacent gaps:`);
    for (let idx = 1; idx < sorted.length; idx++) {
      const prev = sorted[idx - 1];
      const curr = sorted[idx];
      const gapSeconds = (Date.parse(curr[model]) - Date.parse(prev[model])) / 1000;
      lines.push(`  ${prev.agent} -> ${curr.agent}: ${gapSeconds.toFixed(3)}s`);
    }
  }
  return lines;
}

export function formatPlan(result: PlanResult): string {
  const lines: string[] = [];
  lines.push('=== SESSION ROLLOVER JITTER PLAN ===');
  lines.push('No config files written in --plan mode.');
  lines.push('');
  lines.push('org/agent group rank baseline offset phase1 last_refresh landed_1x landed_2x');
  for (const row of result.rows) {
    lines.push(`${row.org}/${row.agent} ${row.group} ${row.rank} ${row.baselineSeconds}s +${row.offsetSeconds}s ${row.phase1Seconds}s ${row.lastRefreshAt} ${row.landed1At} ${row.landed2At}`);
  }
  lines.push('');
  lines.push(...gapLines(result.rows, 'landed1At'));
  lines.push('');
  lines.push(...gapLines(result.rows, 'landed2At'));
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Errors:');
    for (const error of result.errors) lines.push(`  ${error}`);
  }
  lines.push('');
  lines.push(`VERDICT=${result.verdict}`);
  return lines.join('\n');
}

function loadState(path: string): JitterState {
  return readJson(path) as unknown as JitterState;
}

function activeStateExists(path: string): boolean {
  if (!existsSync(path)) return false;
  const state = loadState(path);
  return !state.revertedAt;
}

export function applyPhase1(opts: JitterOptions, now = new Date()): JitterState {
  if (activeStateExists(opts.statePath)) {
    throw new Error(`refusing double apply: active state exists at ${opts.statePath}`);
  }

  const plan = buildPlan(opts);
  if (plan.verdict !== 'PASS') {
    throw new Error(`refusing apply: plan failed\n${plan.errors.join('\n')}`);
  }

  const entries: StateEntry[] = [];
  const writes: Array<{ path: string; cfg: Record<string, unknown> }> = [];
  for (const row of plan.rows) {
    const cfg = readJson(row.configPath);
    if (cfg.max_session_seconds === row.phase1Seconds) {
      throw new Error(`${row.org}/${row.agent}: already appears phase1-offset at ${row.phase1Seconds}`);
    }
    if (cfg.max_session_seconds !== row.baselineSeconds) {
      throw new Error(`${row.org}/${row.agent}: config changed since plan, expected ${row.baselineSeconds}, got ${String(cfg.max_session_seconds)}`);
    }
    entries.push({
      org: row.org,
      agent: row.agent,
      group: row.group,
      configPath: row.configPath,
      logPath: row.logPath,
      baselineSeconds: row.baselineSeconds,
      phase1Seconds: row.phase1Seconds,
      offsetSeconds: row.offsetSeconds,
    });
    writes.push({ path: row.configPath, cfg: { ...cfg, max_session_seconds: row.phase1Seconds } });
  }

  const state: JitterState = { appliedAt: now.toISOString(), entries };
  writeJsonAtomic(opts.statePath, state);
  for (const write of writes) {
    writeJsonAtomic(write.path, write.cfg);
  }
  return state;
}

export function revertPhase1(opts: Pick<JitterOptions, 'statePath'>): JitterState {
  if (!existsSync(opts.statePath)) {
    throw new Error(`missing state file ${opts.statePath}`);
  }

  const state = loadState(opts.statePath);
  if (state.revertedAt) {
    throw new Error(`state already reverted at ${state.revertedAt}`);
  }

  const appliedAtMs = Date.parse(state.appliedAt);
  const unobserved = state.entries.filter(entry => {
    const latest = latestSessionRefreshAt(entry.logPath);
    return latest === null || latest.getTime() <= appliedAtMs;
  });
  if (unobserved.length > 0) {
    throw new Error(`refusing revert: missing post-write session-refresh for ${unobserved.map(e => `${e.org}/${e.agent}`).join(', ')}`);
  }

  for (const entry of state.entries) {
    const cfg = readJson(entry.configPath);
    cfg.max_session_seconds = entry.baselineSeconds;
    writeJsonAtomic(entry.configPath, cfg);
  }

  const reverted: JitterState = { ...state, revertedAt: new Date().toISOString() };
  writeJsonAtomic(opts.statePath, reverted);
  return reverted;
}

function seedSelfTestAgent(root: string, logsRoot: string, target: Target, baselineSeconds: number, refreshIso: string): void {
  const cfgPath = configPath(root, target);
  mkdirSync(dirname(cfgPath), { recursive: true });
  writeFileSync(cfgPath, JSON.stringify({ agent_name: target.agent, enabled: true, max_session_seconds: baselineSeconds }, null, 2) + '\n');
  const crashPath = logPath(logsRoot, target);
  mkdirSync(dirname(crashPath), { recursive: true });
  writeFileSync(crashPath, `${refreshIso} type=session-refresh reason=session-time-cap rollover session=self-test\n`);
}

export function runSelfTest(): string[] {
  const root = mkdtempSync(join(tmpdir(), 'session-rollover-jitter-'));
  const logsRoot = join(root, 'logs');
  const statePath = join(root, '.cortextOS', 'state', 'session-rollover-jitter.json');
  const targets: Target[] = [
    { org: 'org', agent: 'zeta', group: 'daily' },
    { org: 'org', agent: 'alpha', group: 'daily' },
    { org: 'org', agent: 'middle', group: 'daily' },
  ];

  try {
    seedSelfTestAgent(root, logsRoot, targets[0], 86400, '2026-09-21T19:00:30.000Z');
    seedSelfTestAgent(root, logsRoot, targets[1], 86400, '2026-09-21T19:00:10.000Z');
    seedSelfTestAgent(root, logsRoot, targets[2], 86400, '2026-09-21T19:00:20.000Z');

    const opts: JitterOptions = { repoRoot: root, logsRoot, statePath, targets };
    const plan = buildPlan(opts);
    if (plan.verdict !== 'PASS') throw new Error(`healthy plan failed: ${plan.errors.join(', ')}`);
    const alpha = plan.rows.find(row => row.agent === 'alpha');
    const zeta = plan.rows.find(row => row.agent === 'zeta');
    if (!alpha || !zeta || alpha.offsetSeconds !== FLOOR_SECONDS || zeta.offsetSeconds !== FLOOR_SECONDS + 2 * STEP_SECONDS) {
      throw new Error('phase-rank offsets were not assigned by current phase');
    }

    const bad = buildPlan({ ...opts, minGapSeconds: 600, floorSeconds: 0, stepSeconds: 0, minOffsetSeconds: -1 });
    if (bad.verdict !== 'FAIL') throw new Error('planted tight-pair plan unexpectedly passed');

    const appliedAt = new Date('2026-09-21T20:00:00.000Z');
    applyPhase1(opts, appliedAt);
    const phase1Cfg = readJson(configPath(root, targets[0]));
    if (phase1Cfg.max_session_seconds !== 86400 + FLOOR_SECONDS + 2 * STEP_SECONDS) {
      throw new Error('apply did not write expected phase1 value');
    }

    let refused = false;
    try {
      revertPhase1({ statePath });
    } catch {
      refused = true;
    }
    if (!refused) throw new Error('revert did not refuse before observed post-write roll');

    for (const target of targets) {
      writeFileSync(logPath(logsRoot, target), `2026-09-21T20:01:00.000Z type=session-refresh reason=session-time-cap rollover session=self-test\n`, { flag: 'a' });
    }
    revertPhase1({ statePath });
    const revertedCfg = readJson(configPath(root, targets[0]));
    if (revertedCfg.max_session_seconds !== 86400) {
      throw new Error('revert did not restore baseline');
    }

    return [
      'self-test healthy plan PASS',
      'self-test phase-rank PASS',
      'self-test planted tight-pair FAIL observed',
      'self-test apply PASS',
      'self-test guarded revert PASS',
      'self-test revert restore PASS',
    ];
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function defaultOptions(argv: string[]): JitterOptions {
  const repoRoot = argValue(argv, '--repo-root') ?? process.env.CTX_FRAMEWORK_ROOT ?? process.cwd();
  const logsRoot = argValue(argv, '--logs-root') ?? join(process.env.CTX_ROOT ?? join(process.env.HOME ?? '', '.cortextos', 'default'), 'logs');
  const statePath = argValue(argv, '--state') ?? join(repoRoot, '.cortextOS', 'state', 'session-rollover-jitter.json');
  return {
    repoRoot: resolve(repoRoot),
    logsRoot: resolve(logsRoot),
    statePath: resolve(statePath),
    targets: DEFAULT_TARGETS,
  };
}

function argValue(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/session-rollover-jitter.ts --plan|--apply-phase1|--revert|--self-test',
    'Optional: --repo-root <path> --logs-root <path> --state <path>',
  ].join('\n');
}

const isMain = (() => {
  try {
    return Boolean(typeof require !== 'undefined' && require.main === module);
  } catch {
    return false;
  }
})();

if (isMain) {
  const argv = process.argv.slice(2);
  const modes = ['--plan', '--apply-phase1', '--revert', '--self-test'].filter(mode => argv.includes(mode));
  if (modes.length !== 1) {
    console.error(usage());
    process.exit(2);
  }

  try {
    if (modes[0] === '--self-test') {
      for (const line of runSelfTest()) console.log(line);
      process.exit(0);
    }

    const opts = defaultOptions(argv);
    if (modes[0] === '--plan') {
      const plan = buildPlan(opts);
      console.log(formatPlan(plan));
      process.exit(plan.verdict === 'PASS' ? 0 : 1);
    }

    if (modes[0] === '--apply-phase1') {
      const state = applyPhase1(opts);
      console.log(`APPLIED phase1 at ${state.appliedAt}`);
      console.log(`state=${opts.statePath}`);
      for (const entry of state.entries) {
        console.log(`${entry.org}/${entry.agent}: ${entry.baselineSeconds}s -> ${entry.phase1Seconds}s (+${entry.offsetSeconds}s)`);
      }
      process.exit(0);
    }

    const state = revertPhase1({ statePath: opts.statePath });
    console.log(`REVERTED at ${state.revertedAt}`);
    console.log(`state=${opts.statePath}`);
    for (const entry of state.entries) {
      console.log(`${entry.org}/${entry.agent}: restored ${entry.baselineSeconds}s`);
    }
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
