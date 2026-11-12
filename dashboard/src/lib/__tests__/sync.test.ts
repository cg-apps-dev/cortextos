import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

// Create temp dir and set CTX_ROOT BEFORE modules load.
// We rely on vitest running this file fresh (no prior config.ts cache).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
process.env.CTX_ROOT = tmpDir;

// Dynamic imports so CTX_ROOT is set before config.ts evaluates
let db: typeof import('../db')['db'];
let syncTasks: typeof import('../sync')['syncTasks'];
let syncApprovals: typeof import('../sync')['syncApprovals'];
let syncEvents: typeof import('../sync')['syncEvents'];
let syncHeartbeat: typeof import('../sync')['syncHeartbeat'];
let syncAll: typeof import('../sync')['syncAll'];
let syncFile: typeof import('../sync')['syncFile'];
let extractOrgFromPath: typeof import('../sync')['extractOrgFromPath'];
let extractOrgAndAgentFromEventPath: typeof import('../sync')['extractOrgAndAgentFromEventPath'];
let extractAgentFromStatePath: typeof import('../sync')['extractAgentFromStatePath'];
let getTaskThroughput: typeof import('../data/analytics')['getTaskThroughput'];
let getAgentEffectiveness: typeof import('../data/analytics')['getAgentEffectiveness'];
let CTX_ROOT: string;

beforeAll(async () => {
  const dbMod = await import('../db');
  db = dbMod.db;

  const syncMod = await import('../sync');
  syncTasks = syncMod.syncTasks;
  syncApprovals = syncMod.syncApprovals;
  syncEvents = syncMod.syncEvents;
  syncHeartbeat = syncMod.syncHeartbeat;
  syncAll = syncMod.syncAll;
  syncFile = syncMod.syncFile;
  extractOrgFromPath = syncMod.extractOrgFromPath;
  extractOrgAndAgentFromEventPath = syncMod.extractOrgAndAgentFromEventPath;
  extractAgentFromStatePath = syncMod.extractAgentFromStatePath;

  const analyticsMod = await import('../data/analytics');
  getTaskThroughput = analyticsMod.getTaskThroughput;
  getAgentEffectiveness = analyticsMod.getAgentEffectiveness;

  const configMod = await import('../config');
  CTX_ROOT = configMod.CTX_ROOT;

  // Verify CTX_ROOT was set correctly
  expect(CTX_ROOT).toBe(tmpDir);
});

// Helper: write a JSON file into the temp CTX_ROOT
function writeJSON(relPath: string, data: unknown): string {
  const fullPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
  return fullPath;
}

// Helper: write raw text (for JSONL)
function writeText(relPath: string, content: string): string {
  const fullPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
  return fullPath;
}

function clearSyncMeta(): void {
  db.prepare('DELETE FROM sync_meta').run();
}

function clearTable(table: string): void {
  db.prepare(`DELETE FROM ${table}`).run();
}

function busPathsForOrg(org: string) {
  const orgRoot = path.join(tmpDir, 'orgs', org);
  return {
    ctxRoot: tmpDir,
    inbox: path.join(tmpDir, 'inbox', 'dashboard-test'),
    inflight: path.join(tmpDir, 'inflight', 'dashboard-test'),
    processed: path.join(tmpDir, 'processed', 'dashboard-test'),
    logDir: path.join(tmpDir, 'logs', 'dashboard-test'),
    stateDir: path.join(tmpDir, 'state', 'dashboard-test'),
    taskDir: path.join(orgRoot, 'tasks'),
    approvalDir: path.join(orgRoot, 'approvals'),
    analyticsDir: path.join(orgRoot, 'analytics'),
    deliverablesDir: path.join(orgRoot, 'deliverables'),
  };
}

function runRealCompactTasks(org: string, olderThanDays: number) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  const script = [
    "import { compactTasks } from './src/bus/task.ts';",
    'const paths = JSON.parse(process.env.DASH_TEST_COMPACT_PATHS);',
    'const olderThanDays = Number(process.env.DASH_TEST_COMPACT_DAYS);',
    'process.stdout.write(JSON.stringify(compactTasks(paths, { olderThanDays })));',
  ].join('\n');
  const output = execFileSync(
    process.execPath,
    [path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--eval', script],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        DASH_TEST_COMPACT_PATHS: JSON.stringify(busPathsForOrg(org)),
        DASH_TEST_COMPACT_DAYS: String(olderThanDays),
      },
      encoding: 'utf-8',
    },
  );
  return JSON.parse(output) as {
    archived: Array<{ id: string; archive_file: string }>;
    skipped: Array<{ id: string; reason: string }>;
    dry_run: boolean;
  };
}

describe('syncTasks', () => {
  beforeEach(() => {
    clearTable('tasks');
    clearSyncMeta();
  });

  it('syncs a task JSON file into SQLite', () => {
    writeJSON('orgs/testorg/tasks/task-1.json', {
      id: 'task-1',
      title: 'Test Task',
      status: 'pending',
      priority: 'high',
      created_at: '2025-01-01T00:00:00Z',
    });

    const count = syncTasks('testorg');
    expect(count).toBe(1);

    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get('task-1') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.title).toBe('Test Task');
    expect(row.status).toBe('pending');
    expect(row.priority).toBe('high');
    expect(row.org).toBe('testorg');
  });

  it('skips unchanged files on re-sync (mtime check)', () => {
    writeJSON('orgs/testorg2/tasks/task-2.json', {
      id: 'task-2',
      title: 'Skip Me',
      status: 'pending',
      created_at: '2025-01-01T00:00:00Z',
    });

    const first = syncTasks('testorg2');
    expect(first).toBe(1);

    const second = syncTasks('testorg2');
    expect(second).toBe(0);
  });

  it('re-syncs when file is modified', async () => {
    const fp = writeJSON('orgs/testorg3/tasks/task-3.json', {
      id: 'task-3',
      title: 'Original',
      status: 'pending',
      created_at: '2025-01-01T00:00:00Z',
    });

    syncTasks('testorg3');

    // Bump mtime
    await new Promise((r) => setTimeout(r, 50));
    fs.writeFileSync(
      fp,
      JSON.stringify({
        id: 'task-3',
        title: 'Updated',
        status: 'in_progress',
        created_at: '2025-01-01T00:00:00Z',
      }),
    );

    const count = syncTasks('testorg3');
    expect(count).toBe(1);

    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get('task-3') as Record<string, unknown>;
    expect(row.title).toBe('Updated');
    expect(row.status).toBe('in_progress');
  });

  it('handles missing task dir gracefully', () => {
    const count = syncTasks('nonexistent-org');
    expect(count).toBe(0);
  });

  it('keeps dashboard analytics identical across real task compaction', () => {
    const org = 'compaction-analytics';
    const oldCompletedAt = new Date(Date.now() - 10 * 86400_000).toISOString();
    const recentCompletedAt = new Date(Date.now() - 2 * 86400_000).toISOString();

    writeJSON(`orgs/${org}/tasks/task_analytics_old.json`, {
      id: 'task_analytics_old',
      title: 'Old completed task',
      status: 'completed',
      priority: 'high',
      assigned_to: 'analytics-agent',
      org,
      created_at: oldCompletedAt,
      updated_at: oldCompletedAt,
      completed_at: oldCompletedAt,
      result: 'old result',
    });
    writeJSON(`orgs/${org}/tasks/task_analytics_recent.json`, {
      id: 'task_analytics_recent',
      title: 'Recent completed task',
      status: 'completed',
      priority: 'normal',
      assigned_to: 'analytics-agent',
      org,
      created_at: recentCompletedAt,
      updated_at: recentCompletedAt,
      completed_at: recentCompletedAt,
      result: 'recent result',
    });
    writeJSON(`orgs/${org}/tasks/task_analytics_pending.json`, {
      id: 'task_analytics_pending',
      title: 'Pending task',
      status: 'pending',
      priority: 'normal',
      assigned_to: 'analytics-agent',
      org,
      created_at: recentCompletedAt,
    });

    expect(syncTasks(org)).toBe(3);
    const throughputBefore = getTaskThroughput(30, org);
    const effectivenessBefore = getAgentEffectiveness(org);
    expect(throughputBefore.reduce((total, day) => total + day.tasks, 0)).toBe(2);
    expect(effectivenessBefore).toEqual([
      expect.objectContaining({
        name: 'analytics-agent',
        tasksCompleted: 2,
      }),
    ]);

    const report = runRealCompactTasks(org, 7);
    expect(report.archived.map((entry) => entry.id)).toEqual(['task_analytics_old']);

    syncTasks(org);

    expect(getTaskThroughput(30, org)).toEqual(throughputBefore);
    expect(getAgentEffectiveness(org)).toEqual(effectivenessBefore);
  });

  it('keeps archived rows after the same sync transaction reconciles sources', () => {
    const org = 'archive-survival';
    const completedAt = '2026-10-01T12:00:00Z';
    const archivePath = writeText(
      `orgs/${org}/tasks/archive-2026-10.jsonl`,
      `${JSON.stringify({
        id: 'task_archive_survives',
        title: 'Archived task',
        org,
        assigned_to: 'archive-agent',
        completed_at: completedAt,
        archived_at: '2026-11-01T12:00:00Z',
        result: 'shipped',
      })}\n`,
    );

    expect(syncTasks(org)).toBe(1);

    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get('task_archive_survives') as Record<string, unknown>;
    expect(row).toMatchObject({
      title: 'Archived task',
      status: 'completed',
      priority: 'normal',
      assignee: 'archive-agent',
      org,
      needs_approval: 0,
      created_at: completedAt,
      completed_at: completedAt,
      notes: 'shipped',
      source_file: archivePath,
    });
  });

  it('still deletes a genuinely removed active task while preserving archived rows', () => {
    const org = 'archive-reconcile';
    const activePath = writeJSON(`orgs/${org}/tasks/task_removed.json`, {
      id: 'task_removed',
      title: 'Remove me',
      status: 'pending',
      priority: 'normal',
      org,
      created_at: '2026-10-01T12:00:00Z',
    });
    writeText(
      `orgs/${org}/tasks/archive-2026-09.jsonl`,
      `${JSON.stringify({
        id: 'task_archive_kept',
        title: 'Keep me',
        org,
        assigned_to: 'archive-agent',
        completed_at: '2026-09-01T12:00:00Z',
        archived_at: '2026-10-01T12:00:00Z',
        result: 'done',
      })}\n`,
    );

    expect(syncTasks(org)).toBe(2);
    fs.unlinkSync(activePath);

    expect(syncTasks(org)).toBe(0);
    expect(db.prepare('SELECT id FROM tasks WHERE id = ?').get('task_removed')).toBeUndefined();
    expect(db.prepare('SELECT id FROM tasks WHERE id = ?').get('task_archive_kept')).toBeTruthy();
  });

  it('mtime-skips an unchanged archive while retaining its rows in the keep-set', () => {
    const org = 'archive-mtime';
    writeText(
      `orgs/${org}/tasks/archive-2026-08.jsonl`,
      `${JSON.stringify({
        id: 'task_archive_unchanged',
        title: 'Unchanged archive task',
        org,
        assigned_to: 'archive-agent',
        completed_at: '2026-08-01T12:00:00Z',
        archived_at: '2026-09-01T12:00:00Z',
        result: 'done',
      })}\n`,
    );

    expect(syncTasks(org)).toBe(1);
    expect(syncTasks(org)).toBe(0);
    expect(db.prepare('SELECT id FROM tasks WHERE id = ?').get('task_archive_unchanged')).toBeTruthy();
  });
});

describe('syncApprovals', () => {
  beforeEach(() => {
    clearTable('approvals');
    clearSyncMeta();
  });

  it('syncs pending and resolved approvals', () => {
    writeJSON('orgs/apporg/approvals/pending/ap-1.json', {
      id: 'ap-1',
      title: 'Deploy to prod',
      agent: 'builder',
      created_at: '2025-01-01T00:00:00Z',
    });
    writeJSON('orgs/apporg/approvals/resolved/ap-2.json', {
      id: 'ap-2',
      title: 'Cost increase',
      agent: 'planner',
      status: 'approved',
      created_at: '2025-01-01T00:00:00Z',
      resolved_at: '2025-01-02T00:00:00Z',
    });

    const count = syncApprovals('apporg');
    expect(count).toBe(2);

    const pending = db.prepare('SELECT * FROM approvals WHERE id = ?').get('ap-1') as Record<string, unknown>;
    expect(pending.status).toBe('pending');

    const resolved = db.prepare('SELECT * FROM approvals WHERE id = ?').get('ap-2') as Record<string, unknown>;
    expect(resolved.status).toBe('approved');
  });
});

describe('syncEvents', () => {
  beforeEach(() => {
    clearTable('events');
    clearSyncMeta();
  });

  it('syncs JSONL lines into event rows', () => {
    const lines = [
      JSON.stringify({ id: 'e1', timestamp: '2025-01-01T00:00:00Z', type: 'action', message: 'started' }),
      JSON.stringify({ id: 'e2', timestamp: '2025-01-01T00:01:00Z', type: 'task', message: 'completed' }),
      JSON.stringify({ id: 'e3', timestamp: '2025-01-01T00:02:00Z', type: 'error', severity: 'error', message: 'failed' }),
    ].join('\n');

    writeText('orgs/evtorg/analytics/events/builder/2025-01-01.jsonl', lines);

    const count = syncEvents('evtorg', 'builder');
    expect(count).toBe(3);

    const rows = db.prepare('SELECT * FROM events WHERE agent = ?').all('builder');
    expect(rows).toHaveLength(3);
  });

  it('skips malformed JSONL lines without crashing', () => {
    const lines = [
      JSON.stringify({ id: 'e-good', timestamp: '2025-01-01T00:00:00Z', type: 'action' }),
      'NOT VALID JSON {{{',
      JSON.stringify({ id: 'e-also-good', timestamp: '2025-01-01T00:01:00Z', type: 'task' }),
    ].join('\n');

    writeText('orgs/evtorg2/analytics/events/builder/2025-01-02.jsonl', lines);

    const count = syncEvents('evtorg2', 'builder');
    expect(count).toBe(2);
  });
});

describe('syncHeartbeat', () => {
  beforeEach(() => {
    clearTable('heartbeats');
    clearSyncMeta();
  });

  it('syncs heartbeat.json into heartbeats table', () => {
    writeJSON('state/builder/heartbeat.json', {
      status: 'idle',
      current_task: null,
      mode: 'loop',
      last_heartbeat: '2025-01-01T12:00:00Z',
      uptime_seconds: 3600,
      org: 'testorg',
    });

    const ok = syncHeartbeat('builder');
    expect(ok).toBe(true);

    const row = db.prepare('SELECT * FROM heartbeats WHERE agent = ?').get('builder') as Record<string, unknown>;
    expect(row).toBeTruthy();
    expect(row.status).toBe('idle');
    expect(row.uptime_seconds).toBe(3600);
  });

  it('returns false for missing heartbeat file', () => {
    const ok = syncHeartbeat('no-agent');
    expect(ok).toBe(false);
  });
});

describe('syncAll', () => {
  beforeEach(() => {
    clearTable('tasks');
    clearTable('approvals');
    clearTable('events');
    clearTable('heartbeats');
    clearSyncMeta();
    // Remove filesystem dirs so syncAll only sees what this test creates
    fs.rmSync(path.join(tmpDir, 'orgs'), { recursive: true, force: true });
    fs.rmSync(path.join(tmpDir, 'state'), { recursive: true, force: true });
  });

  it('returns correct counts across multiple orgs', () => {
    fs.mkdirSync(path.join(tmpDir, 'orgs', 'allorg', 'agents', 'agent1'), { recursive: true });

    writeJSON('orgs/allorg/tasks/t1.json', {
      id: 't1',
      title: 'T1',
      status: 'pending',
      created_at: '2025-01-01T00:00:00Z',
    });
    writeJSON('orgs/allorg/approvals/pending/a1.json', {
      id: 'a1',
      title: 'A1',
      agent: 'x',
      created_at: '2025-01-01T00:00:00Z',
    });
    writeText(
      'orgs/allorg/analytics/events/agent1/2025-01-01.jsonl',
      JSON.stringify({ id: 'ev1', timestamp: '2025-01-01T00:00:00Z', type: 'action' }) + '\n',
    );
    writeJSON('state/agent1/heartbeat.json', {
      status: 'active',
      org: 'allorg',
    });

    const result = syncAll();
    expect(result.tasks).toBe(1);
    expect(result.approvals).toBe(1);
    expect(result.events).toBe(1);
    expect(result.heartbeats).toBe(1);
  });
});

describe('syncFile routing', () => {
  beforeEach(() => {
    clearTable('tasks');
    clearTable('approvals');
    clearTable('events');
    clearTable('heartbeats');
    clearSyncMeta();
  });

  it('routes task file to syncTasks', () => {
    writeJSON('orgs/routeorg/tasks/t-route.json', {
      id: 't-route',
      title: 'Routed',
      status: 'pending',
      created_at: '2025-01-01T00:00:00Z',
    });

    syncFile(path.join(tmpDir, 'orgs/routeorg/tasks/t-route.json'));

    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get('t-route');
    expect(row).toBeTruthy();
  });

  it('routes approval file to syncApprovals', () => {
    writeJSON('orgs/routeorg/approvals/pending/a-route.json', {
      id: 'a-route',
      title: 'Approval Route',
      agent: 'x',
      created_at: '2025-01-01T00:00:00Z',
    });

    syncFile(path.join(tmpDir, 'orgs/routeorg/approvals/pending/a-route.json'));

    const row = db.prepare('SELECT * FROM approvals WHERE id = ?').get('a-route');
    expect(row).toBeTruthy();
  });

  it('routes event JSONL to syncEvents', () => {
    writeText(
      'orgs/routeorg/analytics/events/bot/2025-01-01.jsonl',
      JSON.stringify({ id: 'ev-route', timestamp: '2025-01-01T00:00:00Z', type: 'action' }) + '\n',
    );

    syncFile(path.join(tmpDir, 'orgs/routeorg/analytics/events/bot/2025-01-01.jsonl'));

    const row = db.prepare('SELECT * FROM events WHERE id = ?').get('ev-route');
    expect(row).toBeTruthy();
  });

  it('routes heartbeat file to syncHeartbeat', () => {
    writeJSON('state/routebot/heartbeat.json', {
      status: 'idle',
      org: '',
    });

    syncFile(path.join(tmpDir, 'state/routebot/heartbeat.json'));

    const row = db.prepare('SELECT * FROM heartbeats WHERE agent = ?').get('routebot');
    expect(row).toBeTruthy();
  });
});

describe('path extraction helpers', () => {
  it('extractOrgFromPath returns correct org', () => {
    expect(extractOrgFromPath('/home/user/.cortextos/orgs/acme/tasks/t.json')).toBe('acme');
    expect(extractOrgFromPath('/no/org/path')).toBeNull();
  });

  it('extractOrgAndAgentFromEventPath returns org and agent', () => {
    const result = extractOrgAndAgentFromEventPath(
      '/home/user/.cortextos/orgs/acme/analytics/events/builder/2025.jsonl',
    );
    expect(result.org).toBe('acme');
    expect(result.agent).toBe('builder');
  });

  it('extractAgentFromStatePath returns agent', () => {
    expect(extractAgentFromStatePath('/home/user/.cortextos/state/planner/heartbeat.json')).toBe('planner');
    expect(extractAgentFromStatePath('/no/state/path')).toBeNull();
  });
});
