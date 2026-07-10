import fs from 'fs';
import os from 'os';
import path from 'path';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));

import { lifecycleDelete, type LifecycleOps } from '../../app/api/agents/[name]/lifecycle/route';
import {
  createDashboardUser,
  deleteDashboardUser,
  listDashboardUsers,
  type DbUser,
  type UserAdminOps,
} from '../user-admin';

const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-admin-'));
const frameworkRoot = path.join(rootTmp, 'framework');

afterAll(() => {
  fs.rmSync(rootTmp, { recursive: true, force: true });
});

beforeEach(() => {
  delete process.env.TRUST_PROXY;
  process.env.ADMIN_USERNAME = 'admin';
  fs.rmSync(frameworkRoot, { recursive: true, force: true });
  fs.mkdirSync(frameworkRoot, { recursive: true });
});

describe('settings users admin authorization', () => {
  it('rejects POST unauthenticated before body parsing or insert and audits the attempt', async () => {
    const ops = makeUserOps();
    const request = makeThrowingJsonRequest();

    const res = await createDashboardUser(request, null, ops);

    expect(res.status).toBe(401);
    expect(request.json).not.toHaveBeenCalled();
    expect(ops.findUserByName).not.toHaveBeenCalled();
    expect(ops.insertUser).not.toHaveBeenCalled();
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({
      route: 'settings/users',
      verb: 'POST',
      actor: 'anonymous',
      outcome: 'UNAUTHENTICATED',
    }));
  });

  it('rejects POST non-admin, bad CSRF, and bad origin before insert and audits each outcome', async () => {
    const ops = makeUserOps();

    const forbidden = await createDashboardUser(makeUserRequest({ username: 'viewer2', password: strongPassword() }), viewer(), ops);
    expect(forbidden.status).toBe(403);

    const badCsrf = await createDashboardUser(
      makeUserRequest({ username: 'csrfuser', password: strongPassword() }, { headerCsrf: 'wrong-token' }),
      admin(),
      ops,
    );
    expect(badCsrf.status).toBe(403);

    const badOrigin = await createDashboardUser(
      makeUserRequest({ username: 'originuser', password: strongPassword() }, { origin: 'http://evil.test' }),
      admin(),
      ops,
    );
    expect(badOrigin.status).toBe(403);

    expect(ops.insertUser).not.toHaveBeenCalled();
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'POST', actor: 'viewer@example.test', outcome: 'FORBIDDEN' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'POST', actor: 'admin@example.test', outcome: 'BAD_CSRF' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'POST', actor: 'admin@example.test', outcome: 'BAD_ORIGIN' }));
  });

  it('creates a user after admin authorization, hashes the password, and omits credentials from audit', async () => {
    const ops = makeUserOps();
    const password = strongPassword();

    const res = await createDashboardUser(makeUserRequest({ username: ' newuser ', password }), admin('owner@example.test'), ops);

    expect(res.status).toBe(200);
    expect(ops.hashPassword).toHaveBeenCalledWith(password);
    expect(ops.insertUser).toHaveBeenCalledWith('newuser', `HASHED:${password}`);
    expect(ops.audit).toHaveBeenCalledWith({
      route: 'settings/users',
      verb: 'POST',
      actor: 'owner@example.test',
      target: 'newuser',
      outcome: 'created',
    });
    expect(auditJson(ops)).not.toContain(password);
    expect(auditJson(ops)).not.toContain(`HASHED:${password}`);
  });

  it('preserves POST validation, existing-user, and reserved-username rejection semantics', async () => {
    const ops = makeUserOps();

    const shortName = await createDashboardUser(makeUserRequest({ username: 'ab', password: strongPassword() }), admin(), ops);
    expect(shortName.status).toBe(400);
    expect(shortName.body.code).toBe('INVALID_USERNAME');

    const shortPassword = await createDashboardUser(makeUserRequest({ username: 'validuser', password: 'short' }), admin(), ops);
    expect(shortPassword.status).toBe(400);
    expect(shortPassword.body.code).toBe('INVALID_PASSWORD');

    const existing = await createDashboardUser(makeUserRequest({ username: 'existing', password: strongPassword() }), admin(), ops);
    expect(existing.status).toBe(409);
    expect(existing.body.code).toBe('USERNAME_EXISTS');

    const reservedDefault = await createDashboardUser(makeUserRequest({ username: 'admin', password: strongPassword() }), admin(), ops);
    expect(reservedDefault.status).toBe(400);
    expect(reservedDefault.body.code).toBe('RESERVED_USERNAME');

    process.env.ADMIN_USERNAME = 'rootadmin';
    const reservedConfigured = await createDashboardUser(makeUserRequest({ username: 'rootadmin', password: strongPassword() }), admin('owner@example.test', 'rootadmin'), ops);
    expect(reservedConfigured.status).toBe(400);
    expect(reservedConfigured.body.code).toBe('RESERVED_USERNAME');

    expect(ops.insertUser).not.toHaveBeenCalled();
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'POST', target: 'ab', outcome: 'INVALID_USERNAME' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'POST', target: 'validuser', outcome: 'INVALID_PASSWORD' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'POST', target: 'existing', outcome: 'USERNAME_EXISTS' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'POST', target: 'admin', outcome: 'RESERVED_USERNAME' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'POST', target: 'rootadmin', outcome: 'RESERVED_USERNAME' }));
  });

  it('rejects DELETE unauthenticated, non-admin, bad origin, and bad CSRF before parsing or delete and audits each outcome', async () => {
    const ops = makeUserOps();
    const unauthRequest = makeThrowingJsonRequest('DELETE');

    const unauth = await deleteDashboardUser(unauthRequest, null, ops);
    expect(unauth.status).toBe(401);
    expect(unauthRequest.json).not.toHaveBeenCalled();

    const forbidden = await deleteDashboardUser(makeUserRequest({ id: 2 }, {}, 'DELETE'), viewer(), ops);
    expect(forbidden.status).toBe(403);

    const badOrigin = await deleteDashboardUser(makeUserRequest({ id: 2 }, { origin: 'http://evil.test' }, 'DELETE'), admin(), ops);
    expect(badOrigin.status).toBe(403);

    const badCsrf = await deleteDashboardUser(makeUserRequest({ id: 2 }, { headerCsrf: 'wrong-token' }, 'DELETE'), admin(), ops);
    expect(badCsrf.status).toBe(403);

    expect(ops.countUsers).not.toHaveBeenCalled();
    expect(ops.deleteUser).not.toHaveBeenCalled();
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'DELETE', actor: 'anonymous', outcome: 'UNAUTHENTICATED' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'DELETE', actor: 'viewer@example.test', outcome: 'FORBIDDEN' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'DELETE', actor: 'admin@example.test', outcome: 'BAD_ORIGIN' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'DELETE', actor: 'admin@example.test', outcome: 'BAD_CSRF' }));
  });

  it('preserves DELETE last-user, not-found, and success behavior with audit', async () => {
    const lastUserOps = makeUserOps({ users: [adminUser()] });
    const lastUser = await deleteDashboardUser(makeUserRequest({ id: 1 }, {}, 'DELETE'), admin(), lastUserOps);
    expect(lastUser.status).toBe(400);
    expect(lastUser.body.code).toBe('CANNOT_DELETE_LAST_USER');
    expect(lastUserOps.deleteUser).not.toHaveBeenCalled();
    expect(lastUserOps.audit).toHaveBeenCalledWith(expect.objectContaining({
      verb: 'DELETE',
      target: 1,
      outcome: 'CANNOT_DELETE_LAST_USER',
    }));

    const notFoundOps = makeUserOps();
    const notFound = await deleteDashboardUser(makeUserRequest({ id: 999 }, {}, 'DELETE'), admin(), notFoundOps);
    expect(notFound.status).toBe(404);
    expect(notFound.body.code).toBe('USER_NOT_FOUND');

    const ops = makeUserOps();
    const ok = await deleteDashboardUser(makeUserRequest({ id: 2 }, {}, 'DELETE'), admin('delete@example.test'), ops);
    expect(ok.status).toBe(200);
    expect(ops.deleteUser).toHaveBeenCalledWith(2);
    expect(ops.audit).toHaveBeenCalledWith({
      route: 'settings/users',
      verb: 'DELETE',
      actor: 'delete@example.test',
      target: 2,
      outcome: 'deleted',
    });
  });

  it('admin-gates GET without CSRF and avoids listUsers on rejection', () => {
    const ops = makeUserOps();

    const unauth = listDashboardUsers(null, ops);
    expect(unauth.status).toBe(401);

    const forbidden = listDashboardUsers(viewer(), ops);
    expect(forbidden.status).toBe(403);

    expect(ops.listUsers).not.toHaveBeenCalled();
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'GET', actor: 'anonymous', outcome: 'UNAUTHENTICATED' }));
    expect(ops.audit).toHaveBeenCalledWith(expect.objectContaining({ verb: 'GET', actor: 'viewer@example.test', outcome: 'FORBIDDEN' }));

    const ok = listDashboardUsers(admin('list@example.test'), ops);
    expect(ok.status).toBe(200);
    expect(ok.body.users).toEqual([
      { id: 1, username: 'admin', created_at: '2026-07-10T00:00:00.000Z' },
      { id: 2, username: 'existing', created_at: '2026-07-10T00:01:00.000Z' },
    ]);
    expect(ops.audit).toHaveBeenCalledWith({
      route: 'settings/users',
      verb: 'GET',
      actor: 'list@example.test',
      outcome: 'listed',
    });
  });

  it('audits every rejection and success without passwords or hashes', async () => {
    const ops = makeUserOps();
    const password = strongPassword();

    await createDashboardUser(makeUserRequest({ username: 'audituser', password }), admin(), ops);
    await createDashboardUser(makeUserRequest({ username: 'existing', password }), admin(), ops);
    await deleteDashboardUser(makeUserRequest({ id: 2 }, {}, 'DELETE'), admin(), ops);
    await deleteDashboardUser(makeUserRequest({ id: 999 }, {}, 'DELETE'), admin(), ops);
    listDashboardUsers(admin(), ops);

    const outcomes = ops.audit.mock.calls.map(([event]) => event.outcome);
    expect(outcomes).toEqual(expect.arrayContaining(['created', 'USERNAME_EXISTS', 'deleted', 'USER_NOT_FOUND', 'listed']));
    expect(auditJson(ops)).not.toContain(password);
    expect(auditJson(ops)).not.toContain(`HASHED:${password}`);
  });

  it('runs the ephemeral non-admin lifecycle and tears the user back down', async () => {
    const users = [adminUser()];
    const ops = makeUserOps({ users });

    const create = await createDashboardUser(
      makeUserRequest({ username: 'tempviewer', password: strongPassword() }),
      admin('owner@example.test'),
      ops,
    );
    expect(create.status).toBe(200);
    expect(users.map((user) => user.username)).toEqual(['admin', 'tempviewer']);

    const lifecycleOps = makeLifecycleOps();
    const nonAdminDelete = await lifecycleDelete(
      makeLifecycleDeleteRequest({ deleteFiles: true, confirmName: 'the-analyst' }),
      { name: 'the-analyst' },
      { user: { name: 'tempviewer', email: 'tempviewer@example.test' } },
      lifecycleOps,
    );
    expect(nonAdminDelete.status).toBe(403);
    expect(lifecycleOps.ipcSend).not.toHaveBeenCalled();
    expect(lifecycleOps.rm).not.toHaveBeenCalled();

    const teardown = await deleteDashboardUser(makeUserRequest({ id: 2 }, {}, 'DELETE'), admin('owner@example.test'), ops);
    expect(teardown.status).toBe(200);
    expect(users).toEqual([adminUser()]);
  });
});

function admin(email = 'admin@example.test', name = 'admin') {
  return { user: { name, email } };
}

function viewer() {
  return { user: { name: 'viewer', email: 'viewer@example.test' } };
}

function strongPassword() {
  return 'correct horse battery staple';
}

function adminUser(): DbUser {
  return { id: 1, username: 'admin', created_at: '2026-07-10T00:00:00.000Z' };
}

function makeUserRequest(
  body: Record<string, unknown>,
  options: RequestOptions = {},
  method = 'POST',
): NextRequest {
  const url = options.requestUrl ?? 'http://localhost:3000/api/settings/users';
  const origin = options.origin ?? 'http://localhost:3000';
  const csrf = options.csrf ?? 'csrf-token';
  const cookieCsrf = options.cookieCsrf ?? csrf;
  const headerCsrf = options.headerCsrf ?? csrf;
  const headers = new Headers({
    origin,
    referer: `${origin}/settings`,
    cookie: `authjs.csrf-token=${cookieCsrf}|hash`,
    'x-csrf-token': headerCsrf,
    'content-type': 'application/json',
  });
  return new NextRequest(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });
}

function makeThrowingJsonRequest(method = 'POST'): NextRequest & { json: ReturnType<typeof vi.fn> } {
  const headers = new Headers({
    origin: 'http://localhost:3000',
    referer: 'http://localhost:3000/settings',
    cookie: 'authjs.csrf-token=csrf-token|hash',
    'x-csrf-token': 'csrf-token',
  });
  return {
    url: 'http://localhost:3000/api/settings/users',
    method,
    headers,
    cookies: {
      get: () => undefined,
    },
    json: vi.fn(async () => {
      throw new Error('body parsed');
    }),
  } as unknown as NextRequest & { json: ReturnType<typeof vi.fn> };
}

function makeLifecycleDeleteRequest(options: { deleteFiles?: boolean; confirmName?: string } = {}): NextRequest {
  const url = new URL('http://localhost:3000/api/agents/the-analyst/lifecycle');
  if (options.deleteFiles) url.searchParams.set('deleteFiles', 'true');
  if (options.confirmName !== undefined) url.searchParams.set('confirmName', options.confirmName);
  const headers = new Headers({
    origin: 'http://localhost:3000',
    referer: 'http://localhost:3000/accounts',
    cookie: 'authjs.csrf-token=csrf-token|hash',
    'x-csrf-token': 'csrf-token',
  });
  return new NextRequest(url.toString(), { method: 'DELETE', headers });
}

interface RequestOptions {
  origin?: string;
  csrf?: string;
  cookieCsrf?: string;
  headerCsrf?: string;
  requestUrl?: string;
}

function makeUserOps(options: { users?: DbUser[] } = {}) {
  const users = options.users ?? [
    adminUser(),
    { id: 2, username: 'existing', created_at: '2026-07-10T00:01:00.000Z' },
  ];

  const ops: UserAdminOps & {
    audit: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
    findUserByName: ReturnType<typeof vi.fn>;
    countUsers: ReturnType<typeof vi.fn>;
    insertUser: ReturnType<typeof vi.fn>;
    deleteUser: ReturnType<typeof vi.fn>;
    hashPassword: ReturnType<typeof vi.fn>;
  } = {
    now: vi.fn(() => Date.parse('2026-07-10T00:00:00.000Z')),
    listUsers: vi.fn(() => users.map((user) => ({ ...user }))),
    findUserByName: vi.fn((username: string) => users.find((user) => user.username === username) ?? null),
    countUsers: vi.fn(() => users.length),
    insertUser: vi.fn((username: string, passwordHash: string) => {
      users.push({
        id: Math.max(0, ...users.map((user) => user.id)) + 1,
        username,
        created_at: '2026-07-10T00:02:00.000Z',
      });
      void passwordHash;
    }),
    deleteUser: vi.fn((id: number) => {
      const index = users.findIndex((user) => user.id === id);
      if (index === -1) return { changes: 0 };
      users.splice(index, 1);
      return { changes: 1 };
    }),
    hashPassword: vi.fn(async (pw: string) => `HASHED:${pw}`),
    audit: vi.fn((_event: Record<string, unknown>) => undefined),
  };

  return ops;
}

function makeLifecycleOps() {
  const registry: Record<string, { org?: string; enabled?: boolean }> = {
    'the-analyst': { org: 'clean-green-marketing', enabled: true },
  };

  const ops: LifecycleOps = {
    ctxRoot: () => rootTmp,
    frameworkRoot: () => frameworkRoot,
    ipcSend: vi.fn(async () => ({ success: true, data: 'ok' })),
    readFile: vi.fn(async () => JSON.stringify(registry)),
    writeFile: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    audit: vi.fn(),
  };

  return ops;
}

function auditJson(ops: { audit: ReturnType<typeof vi.fn> }): string {
  return JSON.stringify(ops.audit.mock.calls.map(([event]) => event));
}
