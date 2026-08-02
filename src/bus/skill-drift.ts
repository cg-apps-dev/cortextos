import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

export interface SkillSyncPair {
  name: string;
  tracked: string;
  live: string;
}

export const SKILL_SYNC_PAIRS: SkillSyncPair[] = [
  {
    name: 'meta-intake',
    tracked: 'agents/meta-ads-agent/skills/meta-intake',
    live: 'orgs/clean-green-marketing/agents/meta-ads-agent/skills/meta-intake',
  },
];

export type SkillDriftStatus = 'in-sync' | 'content-DIFF' | 'live-MISSING' | 'live-ONLY';

export interface SkillDriftFile {
  path: string;
  status: SkillDriftStatus;
  trackedHash?: string;
  liveHash?: string;
}

export interface SkillDriftPairReport {
  name: string;
  tracked: string;
  live: string;
  inSync: number;
  diff: SkillDriftFile[];
  liveOnly: SkillDriftFile[];
  liveMissing: SkillDriftFile[];
  files: SkillDriftFile[];
  driftCount: number;
}

export interface SkillDriftReport {
  pairs: SkillDriftPairReport[];
  driftCount: number;
}

export interface SkillDriftOptions {
  pair?: string;
  pairs?: SkillSyncPair[];
}

export interface SkillDriftDeps {
  listMainFiles?: (projectRoot: string, trackedPath: string) => string[];
  readMainFile?: (projectRoot: string, path: string) => Buffer;
  listLiveFiles?: (projectRoot: string, livePath: string) => string[];
  readLiveFile?: (projectRoot: string, path: string) => Buffer | undefined;
}

const LEAK_UNSAFE_RE = /(^|\/)(\.env|[^/]*\.env|secrets?[^/]*)(\/|$)/i;
const BUILD_ARTIFACT_RE = /(^|\/)__pycache__\/|\.pyc$|(^|\/)\.DS_Store$/;

function safeRelativePath(path: string): boolean {
  return !path.split('/').includes('..') && !LEAK_UNSAFE_RE.test(path) && !BUILD_ARTIFACT_RE.test(path);
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function stripTrackedPrefix(path: string, trackedPath: string): string {
  return path === trackedPath ? '' : path.slice(trackedPath.length + 1);
}

function defaultListMainFiles(projectRoot: string, trackedPath: string): string[] {
  const out = execFileSync('git', ['ls-tree', '-r', '--name-only', 'main', '--', trackedPath], {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  return out.split('\n').map(line => line.trim()).filter(Boolean);
}

function defaultReadMainFile(projectRoot: string, path: string): Buffer {
  return execFileSync('git', ['show', `main:${path}`], {
    cwd: projectRoot,
    encoding: 'buffer',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  }) as Buffer;
}

function defaultListLiveFiles(projectRoot: string, livePath: string): string[] {
  const root = join(projectRoot, livePath);
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const rel = relative(root, full).split(sep).join('/');
      if (!safeRelativePath(rel)) continue;
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        files.push(rel);
      }
    }
  };
  walk(root);
  return files.sort();
}

function defaultReadLiveFile(projectRoot: string, path: string): Buffer | undefined {
  if (!safeRelativePath(path)) return undefined;
  const full = join(projectRoot, path);
  if (!existsSync(full) || !statSync(full).isFile()) return undefined;
  return readFileSync(full);
}

function selectedPairs(options: SkillDriftOptions): SkillSyncPair[] {
  const pairs = options.pairs ?? SKILL_SYNC_PAIRS;
  if (!options.pair) return pairs;
  const match = pairs.find(pair => pair.name === options.pair);
  if (!match) {
    throw new Error(`Unknown skill sync pair '${options.pair}'. Known pairs: ${pairs.map(p => p.name).join(', ')}`);
  }
  return [match];
}

export function checkSkillDrift(
  projectRoot: string,
  options: SkillDriftOptions = {},
  deps: SkillDriftDeps = {},
): SkillDriftReport {
  const listMainFiles = deps.listMainFiles ?? defaultListMainFiles;
  const readMainFile = deps.readMainFile ?? defaultReadMainFile;
  const listLiveFiles = deps.listLiveFiles ?? defaultListLiveFiles;
  const readLiveFile = deps.readLiveFile ?? defaultReadLiveFile;

  const reports = selectedPairs(options).map((pair): SkillDriftPairReport => {
    const mainFiles = listMainFiles(projectRoot, pair.tracked)
      .filter(path => path.startsWith(`${pair.tracked}/`))
      .map(path => stripTrackedPrefix(path, pair.tracked))
      .filter(safeRelativePath)
      .sort();
    const liveFiles = listLiveFiles(projectRoot, pair.live).filter(safeRelativePath).sort();
    const allFiles = Array.from(new Set([...mainFiles, ...liveFiles])).sort();

    const files = allFiles.map((relPath): SkillDriftFile => {
      const trackedPath = `${pair.tracked}/${relPath}`;
      const livePath = `${pair.live}/${relPath}`;
      const inMain = mainFiles.includes(relPath);
      const inLive = liveFiles.includes(relPath);

      if (!inMain) {
        const live = readLiveFile(projectRoot, livePath);
        return { path: relPath, status: 'live-ONLY', liveHash: live ? sha256(live) : undefined };
      }
      const main = readMainFile(projectRoot, trackedPath);
      const trackedHash = sha256(main);
      if (!inLive) {
        return { path: relPath, status: 'live-MISSING', trackedHash };
      }
      const live = readLiveFile(projectRoot, livePath);
      if (!live) {
        return { path: relPath, status: 'live-MISSING', trackedHash };
      }
      const liveHash = sha256(live);
      if (trackedHash !== liveHash) {
        return { path: relPath, status: 'content-DIFF', trackedHash, liveHash };
      }
      return { path: relPath, status: 'in-sync', trackedHash, liveHash };
    });

    const diff = files.filter(file => file.status === 'content-DIFF');
    const liveOnly = files.filter(file => file.status === 'live-ONLY');
    const liveMissing = files.filter(file => file.status === 'live-MISSING');
    const inSync = files.filter(file => file.status === 'in-sync').length;
    const driftCount = diff.length + liveOnly.length + liveMissing.length;

    return {
      name: pair.name,
      tracked: pair.tracked,
      live: pair.live,
      inSync,
      diff,
      liveOnly,
      liveMissing,
      files,
      driftCount,
    };
  });

  return {
    pairs: reports,
    driftCount: reports.reduce((sum, report) => sum + report.driftCount, 0),
  };
}

function hashLabel(hash?: string): string {
  return hash ? hash.slice(0, 12) : 'missing';
}

function renderFiles(title: string, files: SkillDriftFile[]): string[] {
  if (files.length === 0) return [];
  return [
    `  ${title}:`,
    ...files.map(file =>
      `    - ${file.path} [${file.status}] tracked=${hashLabel(file.trackedHash)} live=${hashLabel(file.liveHash)}`,
    ),
  ];
}

export function formatSkillDriftReport(report: SkillDriftReport): string {
  const lines = [`Skill drift check: ${report.driftCount} drift file${report.driftCount === 1 ? '' : 's'}`];
  for (const pair of report.pairs) {
    lines.push(`\n${pair.name}: ${pair.inSync} in-sync, ${pair.diff.length} diff, ${pair.liveOnly.length} live-only, ${pair.liveMissing.length} live-missing`);
    lines.push(`  tracked(main): ${pair.tracked}`);
    lines.push(`  live: ${pair.live}`);
    lines.push(...renderFiles('content-DIFF', pair.diff));
    lines.push(...renderFiles('live-ONLY', pair.liveOnly));
    lines.push(...renderFiles('live-MISSING', pair.liveMissing));
  }
  return lines.join('\n');
}

export function skillDriftExitCode(report: SkillDriftReport): number {
  return report.driftCount === 0 ? 0 : 1;
}
