import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LifecycleOps } from '../route';
import { lifecycleDelete, lifecyclePost } from '../route';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-lifecycle-'));
const frameworkRoot = path.join(rootTmp, 'framework');

process.env.ADMIN_USERNAME = 'admin';

afterAll(() => {
  fs.rmSync(rootTmp, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.TRUST_PROXY;
  fs.rmSync(frameworkRoot, { recursive: true, force: true });
  fs.mkdirSync(frameworkRoot, { recursive: true });
});

describe('agent lifecycle route authorization', () => {
  it('rejects POST unauthenticated, non-admin, bad CSRF, and invalid action before IPC', async () => {
    const ops = makeOps();

    const unauth = await lifecyclePost(makePostRequest({ action: 'restart' }), { name: 'the-analyst' }, null, ops);
    expect(unauth.status).toBe(401);

    const forbidden = await lifecyclePost(makePostRequest({ action: 'restart' }), { name: 'the-analyst' }, viewer(), ops);
    expect(forbidden.status).toBe(403);

    const crossOrigin = await lifecyclePost(
      makePostRequest({ action: 'restart' }, { origin: 'http://evil.test' }),
      { name: 'the-analyst' },
      admin(),
      ops,
    );
    expect(crossOrigin.status).toBe(403);

    const badCsrf = await lifecyclePost(
      makePostRequest({ action: 'restart' }, { headerCsrf: 'wrong-token' }),
      { name: 'the-analyst' },
      admin(),
      ops,
    );
    expect(badCsrf.status).toBe(403);

    const invalidName = await lifecyclePost(
      makePostRequest({ action: 'restart' }),
      { name: '../the-analyst' },
      admin(),
      ops,
    );
    expect(invalidName.status).toBe(400);

    const invalidAction = await lifecyclePost(
      makePostRequest({ action: 'launch' }),
      { name: 'the-analyst' },
      admin(),
      ops,
    );
    expect(invalidAction.status).toBe(400);

    expect(ops.ipcSend).not.toHaveBeenCalled();
    expect(ops.writeFile).not.toHaveBeenCalled();
    expect(ops.rm).not.toHaveBeenCalled();
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'anonymous',
      agent: 'the-analyst',
      outcome: 'UNAUTHENTICATED',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'viewer@example.test',
      agent: 'the-analyst',
      outcome: 'FORBIDDEN',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'admin@example.test',
      agent: 'the-analyst',
      outcome: 'BAD_ORIGIN',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'admin@example.test',
      agent: 'the-analyst',
      outcome: 'BAD_CSRF',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'admin@example.test',
      agent: '../the-analyst',
      outcome: 'INVALID_AGENT_NAME',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'admin@example.test',
      agent: 'the-analyst',
      action: 'launch',
      outcome: 'INVALID_ACTION',
    });
  });

  it('allows an admin POST after authorization and CSRF checks', async () => {
    const ops = makeOps();

    const res = await lifecyclePost(
      makePostRequest({ action: 'restart_continue' }),
      { name: 'the-analyst' },
      admin('ops@example.test'),
      ops,
    );

    expect(res.status).toBe(200);
    expect(ops.ipcSend).toHaveBeenCalledWith({
      type: 'restart-agent',
      agent: 'the-analyst',
      mode: 'continue',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'ops@example.test',
      agent: 'the-analyst',
      action: 'restart',
      outcome: 'success',
    });
  });

  it('rejects DELETE unauthenticated, non-admin, bad CSRF, invalid name, missing registry, and bad confirm before side effects', async () => {
    const ops = makeOps();

    const unauth = await lifecycleDelete(makeDeleteRequest(), { name: 'the-analyst' }, null, ops);
    expect(unauth.status).toBe(401);

    const forbidden = await lifecycleDelete(makeDeleteRequest(), { name: 'the-analyst' }, viewer(), ops);
    expect(forbidden.status).toBe(403);

    const crossOrigin = await lifecycleDelete(
      makeDeleteRequest({ origin: 'http://evil.test' }),
      { name: 'the-analyst' },
      admin(),
      ops,
    );
    expect(crossOrigin.status).toBe(403);

    const badCsrf = await lifecycleDelete(
      makeDeleteRequest({ headerCsrf: 'wrong-token' }),
      { name: 'the-analyst' },
      admin(),
      ops,
    );
    expect(badCsrf.status).toBe(403);

    const invalidName = await lifecycleDelete(makeDeleteRequest(), { name: '../the-analyst' }, admin(), ops);
    expect(invalidName.status).toBe(400);

    const missing = await lifecycleDelete(
      makeDeleteRequest(),
      { name: 'missing-agent' },
      admin(),
      ops,
    );
    expect(missing.status).toBe(400);

    const confirmMismatch = await lifecycleDelete(
      makeDeleteRequest({ deleteFiles: true, confirmName: 'wrong-agent' }),
      { name: 'the-analyst' },
      admin(),
      ops,
    );
    expect(confirmMismatch.status).toBe(400);
    expect(confirmMismatch.body.code).toBe('CONFIRM_REQUIRED');

    expect(ops.ipcSend).not.toHaveBeenCalled();
    expect(ops.writeFile).not.toHaveBeenCalled();
    expect(ops.rm).not.toHaveBeenCalled();
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'anonymous',
      agent: 'the-analyst',
      action: 'delete',
      deleteFiles: false,
      outcome: 'UNAUTHENTICATED',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'viewer@example.test',
      agent: 'the-analyst',
      action: 'delete',
      deleteFiles: false,
      outcome: 'FORBIDDEN',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'admin@example.test',
      agent: 'the-analyst',
      action: 'delete',
      deleteFiles: false,
      outcome: 'BAD_ORIGIN',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'admin@example.test',
      agent: 'the-analyst',
      action: 'delete',
      deleteFiles: false,
      outcome: 'BAD_CSRF',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'admin@example.test',
      agent: '../the-analyst',
      action: 'delete',
      deleteFiles: false,
      outcome: 'INVALID_AGENT_NAME',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'admin@example.test',
      agent: 'missing-agent',
      action: 'delete',
      deleteFiles: false,
      outcome: 'AGENT_NOT_IN_REGISTRY',
    });
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'admin@example.test',
      agent: 'the-analyst',
      action: 'delete',
      deleteFiles: true,
      outcome: 'CONFIRM_REQUIRED',
    });
  });

  it('does not require typed confirmation when DELETE leaves files in place', async () => {
    const ops = makeOps();

    const res = await lifecycleDelete(
      makeDeleteRequest(),
      { name: 'the-analyst' },
      admin('delete@example.test'),
      ops,
    );

    expect(res.status).toBe(200);
    expect(ops.ipcSend).toHaveBeenCalledWith({ type: 'stop-agent', agent: 'the-analyst' });
    expect(ops.writeFile).toHaveBeenCalledTimes(1);
    expect(ops.rm).not.toHaveBeenCalled();
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'delete@example.test',
      agent: 'the-analyst',
      action: 'delete',
      deleteFiles: false,
      outcome: 'success',
    });
  });

  it('requires typed confirmation before DELETE stops, deregisters, removes files, and audits', async () => {
    const ops = makeOps();

    const res = await lifecycleDelete(
      makeDeleteRequest({ deleteFiles: true, confirmName: 'the-analyst' }),
      { name: 'the-analyst' },
      admin('owner@example.test'),
      ops,
    );

    expect(res.status).toBe(200);
    expect(ops.calls).toEqual(['ipc:stop-agent', 'write', 'rm', 'audit']);
    expect(ops.ipcSend).toHaveBeenCalledWith({ type: 'stop-agent', agent: 'the-analyst' });
    expect(ops.rm).toHaveBeenCalledWith(
      path.join(frameworkRoot, 'orgs', 'clean-green-marketing', 'agents', 'the-analyst'),
      { recursive: true, force: true },
    );
    expect(ops.audit).toHaveBeenCalledWith({
      actor: 'owner@example.test',
      agent: 'the-analyst',
      action: 'delete',
      deleteFiles: true,
      outcome: 'success',
    });
  });
});

function admin(email = 'admin@example.test') {
  return { user: { name: 'admin', email } };
}

function viewer() {
  return { user: { name: 'viewer', email: 'viewer@example.test' } };
}

function makePostRequest(
  body: Record<string, unknown>,
  options: RequestOptions = {},
): NextRequest {
  return makeRequest('POST', 'http://localhost:3000/api/agents/the-analyst/lifecycle', body, options);
}

function makeDeleteRequest(
  options: RequestOptions & { deleteFiles?: boolean; confirmName?: string } = {},
): NextRequest {
  const url = new URL('http://localhost:3000/api/agents/the-analyst/lifecycle');
  if (options.deleteFiles) url.searchParams.set('deleteFiles', 'true');
  if (options.confirmName !== undefined) url.searchParams.set('confirmName', options.confirmName);
  return makeRequest('DELETE', url.toString(), undefined, options);
}

function makeRequest(
  method: string,
  url: string,
  body: Record<string, unknown> | undefined,
  options: RequestOptions = {},
): NextRequest {
  const origin = options.origin ?? 'http://localhost:3000';
  const csrf = options.csrf ?? 'csrf-token';
  const cookieCsrf = options.cookieCsrf ?? csrf;
  const headerCsrf = options.headerCsrf ?? csrf;
  const headers = new Headers({
    origin,
    referer: `${origin}/accounts`,
    cookie: `authjs.csrf-token=${cookieCsrf}|hash`,
    'x-csrf-token': headerCsrf,
  });
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new NextRequest(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface RequestOptions {
  origin?: string;
  csrf?: string;
  cookieCsrf?: string;
  headerCsrf?: string;
}

function makeOps() {
  const calls: string[] = [];
  let registry: Record<string, { org?: string; enabled?: boolean }> = {
    'the-analyst': { org: 'clean-green-marketing', enabled: true },
  };

  const ops: LifecycleOps & { calls: string[] } = {
    calls,
    ctxRoot: () => rootTmp,
    frameworkRoot: () => frameworkRoot,
    ipcSend: vi.fn(async (request) => {
      calls.push(`ipc:${request.type}`);
      return { success: true, data: 'ok' };
    }),
    readFile: vi.fn(async () => JSON.stringify(registry)),
    writeFile: vi.fn(async (_filePath, data) => {
      calls.push('write');
      registry = JSON.parse(data) as typeof registry;
    }),
    mkdir: vi.fn(async () => undefined),
    rm: vi.fn(async () => {
      calls.push('rm');
    }),
    audit: vi.fn(() => {
      calls.push('audit');
    }),
  };

  return ops;
}
