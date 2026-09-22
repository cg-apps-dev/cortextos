import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { busCommand } from '../../../src/cli/bus';

let frameworkRoot: string;
let instanceId: string;
let ctxRoot: string;
let originalFrameworkRoot: string | undefined;
let originalProjectRoot: string | undefined;
let originalInstanceId: string | undefined;
let originalAgentName: string | undefined;
let originalAgentDir: string | undefined;
let originalOrg: string | undefined;

function approval(overrides: Record<string, unknown>) {
  const id = String(overrides.id);
  const status = String(overrides.status);
  return {
    id,
    title: id,
    requesting_agent: 'tester',
    org: String(overrides.org ?? 'org-a'),
    category: 'other',
    status,
    description: '',
    created_at: String(overrides.created_at),
    updated_at: String(overrides.created_at),
    resolved_at: status === 'pending' ? null : String(overrides.created_at),
    resolved_by: status === 'pending' ? null : 'reviewer',
    ...overrides,
  };
}

function task(overrides: Record<string, unknown>) {
  const id = String(overrides.id);
  return {
    id,
    title: id,
    description: '',
    type: 'agent',
    needs_approval: false,
    status: 'pending',
    assigned_to: 'worker-a',
    created_by: 'tester',
    org: String(overrides.org ?? 'org-a'),
    priority: 'normal',
    project: '',
    kpi_key: null,
    created_at: '2026-08-20T00:00:00Z',
    updated_at: '2026-08-20T00:00:00Z',
    completed_at: null,
    due_date: null,
    archived: false,
    blocked_by: [],
    outputs: [],
    ...overrides,
  };
}

function writeApproval(org: string, dir: 'pending' | 'resolved', value: Record<string, unknown>): void {
  const approvalDir = join(ctxRoot, 'orgs', org, 'approvals', dir);
  mkdirSync(approvalDir, { recursive: true });
  writeFileSync(join(approvalDir, `${value.id}.json`), JSON.stringify(approval(value)), 'utf-8');
}

function writeTask(org: string, value: Record<string, unknown>): void {
  const taskDir = join(ctxRoot, 'orgs', org, 'tasks');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(join(taskDir, `${value.id}.json`), JSON.stringify(task(value)), 'utf-8');
}

function parseLoggedJson<T>(logSpy: ReturnType<typeof vi.spyOn>): T {
  return JSON.parse(logSpy.mock.calls.map((call) => call.join(' ')).join('\n')) as T;
}

function mockExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__PROCESS_EXIT_${code}__`);
  }) as never);
}

beforeEach(() => {
  frameworkRoot = mkdtempSync(join(tmpdir(), 'bus-flag-fw-'));
  instanceId = `bus-flag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  ctxRoot = join(homedir(), '.cortextos', instanceId);

  originalFrameworkRoot = process.env.CTX_FRAMEWORK_ROOT;
  originalProjectRoot = process.env.CTX_PROJECT_ROOT;
  originalInstanceId = process.env.CTX_INSTANCE_ID;
  originalAgentName = process.env.CTX_AGENT_NAME;
  originalAgentDir = process.env.CTX_AGENT_DIR;
  originalOrg = process.env.CTX_ORG;

  process.env.CTX_FRAMEWORK_ROOT = frameworkRoot;
  process.env.CTX_PROJECT_ROOT = frameworkRoot;
  process.env.CTX_INSTANCE_ID = instanceId;
  process.env.CTX_AGENT_NAME = 'codex-dev-agent';
  process.env.CTX_AGENT_DIR = join(frameworkRoot, 'orgs', 'org-a', 'agents', 'codex-dev-agent');
  process.env.CTX_ORG = 'org-a';
  mkdirSync(process.env.CTX_AGENT_DIR, { recursive: true });
});

afterEach(() => {
  restoreEnv('CTX_FRAMEWORK_ROOT', originalFrameworkRoot);
  restoreEnv('CTX_PROJECT_ROOT', originalProjectRoot);
  restoreEnv('CTX_INSTANCE_ID', originalInstanceId);
  restoreEnv('CTX_AGENT_NAME', originalAgentName);
  restoreEnv('CTX_AGENT_DIR', originalAgentDir);
  restoreEnv('CTX_ORG', originalOrg);
  rmSync(frameworkRoot, { recursive: true, force: true });
  rmSync(ctxRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('bus CLI flag parity', () => {
  it('list-approvals no flag stays pending-only by default', async () => {
    writeApproval('org-a', 'pending', { id: 'approval_pending', status: 'pending', created_at: '2026-08-24T03:00:00Z' });
    writeApproval('org-a', 'resolved', { id: 'approval_approved', status: 'approved', created_at: '2026-08-24T02:00:00Z' });
    writeApproval('org-a', 'resolved', { id: 'approval_rejected', status: 'rejected', created_at: '2026-08-24T01:00:00Z' });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await busCommand.parseAsync(['node', 'bus', 'list-approvals']);

    const approvals = parseLoggedJson<Array<{ id: string }>>(logSpy);
    expect(approvals.map((a) => a.id)).toEqual(['approval_pending']);
  });

  it('list-approvals --status covers pending, approved, rejected, and all', async () => {
    writeApproval('org-a', 'pending', { id: 'approval_pending', status: 'pending', created_at: '2026-08-24T03:00:00Z' });
    writeApproval('org-a', 'resolved', { id: 'approval_approved', status: 'approved', created_at: '2026-08-24T02:00:00Z' });
    writeApproval('org-a', 'resolved', { id: 'approval_rejected', status: 'rejected', created_at: '2026-08-24T01:00:00Z' });

    for (const [status, expected] of [
      ['pending', ['approval_pending']],
      ['approved', ['approval_approved']],
      ['rejected', ['approval_rejected']],
      ['all', ['approval_pending', 'approval_approved', 'approval_rejected']],
    ] as const) {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await busCommand.parseAsync(['node', 'bus', 'list-approvals', '--status', status]);
      const approvals = parseLoggedJson<Array<{ id: string }>>(logSpy);
      expect(approvals.map((a) => a.id)).toEqual(expected);
      logSpy.mockRestore();
    }
  });

  it('list-approvals invalid status fails loud without false-zero stdout', async () => {
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      busCommand.parseAsync(['node', 'bus', 'list-approvals', '--status', 'bogus'])
    ).rejects.toThrow('__PROCESS_EXIT_1__');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.flat().join(' ')).toContain("Invalid approval status 'bogus'");
    expect(logSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.flat().join('')).not.toBe('[]');
  });

  it('unknown flags still fail loud without false-zero stdout', async () => {
    const exitSpy = mockExit();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      busCommand.parseAsync(['node', 'bus', 'list-approvals', '--definitely-unknown'])
    ).rejects.toThrow('__PROCESS_EXIT_1__');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy.mock.calls.flat().join('')).toContain('unknown option');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('list-tasks no flag stays scoped to the current org', async () => {
    writeTask('org-a', { id: 'task_org_a', org: 'org-a', created_at: '2026-08-24T03:00:00Z' });
    writeTask('org-b', { id: 'task_org_b', org: 'org-b', created_at: '2026-08-24T02:00:00Z' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await busCommand.parseAsync(['node', 'bus', 'list-tasks', '--format', 'json']);

    const tasks = parseLoggedJson<Array<{ id: string }>>(logSpy);
    expect(tasks.map((t) => t.id)).toEqual(['task_org_a']);
  });

  it('list-tasks --all-orgs aggregates across orgs with existing filters', async () => {
    writeTask('org-a', { id: 'task_org_a_match', org: 'org-a', assigned_to: 'worker-a', status: 'pending' });
    writeTask('org-a', { id: 'task_org_a_skip', org: 'org-a', assigned_to: 'worker-b', status: 'pending' });
    writeTask('org-b', { id: 'task_org_b_match', org: 'org-b', assigned_to: 'worker-a', status: 'pending' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await busCommand.parseAsync([
      'node', 'bus', 'list-tasks', '--all-orgs', '--agent', 'worker-a', '--status', 'pending', '--format', 'json',
    ]);

    const tasks = parseLoggedJson<Array<{ id: string }>>(logSpy);
    expect(tasks.map((t) => t.id).sort()).toEqual(['task_org_a_match', 'task_org_b_match']);
  });

  it('list-tasks --project filters by project without false-zero unknown-option behavior', async () => {
    writeTask('org-a', { id: 'task_human', org: 'org-a', project: 'human-tasks', created_at: '2026-08-24T03:00:00Z' });
    writeTask('org-a', { id: 'task_dev', org: 'org-a', project: 'dev', created_at: '2026-08-24T02:00:00Z' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await busCommand.parseAsync(['node', 'bus', 'list-tasks', '--project', 'human-tasks', '--format', 'json']);

    const tasks = parseLoggedJson<Array<{ id: string; project: string }>>(logSpy);
    expect(tasks.map((t) => t.id)).toEqual(['task_human']);
    expect(tasks[0].project).toBe('human-tasks');
  });

  it('list-tasks --all-orgs threads project and priority filters together', async () => {
    writeTask('org-a', { id: 'task_org_a_match', org: 'org-a', project: 'human-tasks', priority: 'high' });
    writeTask('org-a', { id: 'task_org_a_project_skip', org: 'org-a', project: 'dev', priority: 'high' });
    writeTask('org-b', { id: 'task_org_b_match', org: 'org-b', project: 'human-tasks', priority: 'high' });
    writeTask('org-b', { id: 'task_org_b_priority_skip', org: 'org-b', project: 'human-tasks', priority: 'normal' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await busCommand.parseAsync([
      'node', 'bus', 'list-tasks', '--all-orgs', '--project', 'human-tasks', '--priority', 'high', '--format', 'json',
    ]);

    const tasks = parseLoggedJson<Array<{ id: string }>>(logSpy);
    expect(tasks.map((t) => t.id).sort()).toEqual(['task_org_a_match', 'task_org_b_match']);
  });

  it('check-stale-tasks no flag stays scoped to the current org', async () => {
    writeTask('org-a', { id: 'task_org_a_stale', org: 'org-a', status: 'in_progress', updated_at: '2020-01-01T00:00:00Z' });
    writeTask('org-b', { id: 'task_org_b_stale', org: 'org-b', status: 'in_progress', updated_at: '2020-01-01T00:00:00Z' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await busCommand.parseAsync(['node', 'bus', 'check-stale-tasks']);

    const report = parseLoggedJson<{ stale_in_progress: Array<{ id: string }> }>(logSpy);
    expect(report.stale_in_progress.map((t) => t.id)).toEqual(['task_org_a_stale']);
  });

  it('check-stale-tasks --all-orgs aggregates across orgs', async () => {
    writeTask('org-a', { id: 'task_org_a_stale', org: 'org-a', status: 'in_progress', updated_at: '2020-01-01T00:00:00Z' });
    writeTask('org-b', { id: 'task_org_b_stale', org: 'org-b', status: 'pending', created_at: '2020-01-01T00:00:00Z' });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await busCommand.parseAsync(['node', 'bus', 'check-stale-tasks', '--all-orgs']);

    const report = parseLoggedJson<{
      stale_in_progress: Array<{ id: string }>;
      stale_pending: Array<{ id: string }>;
    }>(logSpy);
    expect(report.stale_in_progress.map((t) => t.id)).toEqual(['task_org_a_stale']);
    expect(report.stale_pending.map((t) => t.id)).toEqual(['task_org_b_stale']);
  });
});
