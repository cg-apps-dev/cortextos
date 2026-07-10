import { execFileSync } from 'child_process';
import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { getCTXRoot, getFrameworkRoot } from '@/lib/config';
import {
  AccountSwitchHttpError,
  actorFromSession,
  isAdminSession,
  verifyCsrfAndOrigin,
  type SwitchSession,
} from '@/lib/account-switch';

export interface DbUser {
  id: number;
  username: string;
  created_at: string;
}

export interface UserAdminOps {
  now(): number;
  listUsers(): DbUser[];
  findUserByName(username: string): { id: number } | null;
  countUsers(): number;
  insertUser(username: string, passwordHash: string): void;
  deleteUser(id: number): { changes: number };
  hashPassword(pw: string): Promise<string>;
  audit(event: Record<string, unknown>): void;
}

export type UserAdminResult = {
  status: number;
  body: Record<string, unknown>;
};

export const defaultUserAdminOps: UserAdminOps = {
  now: () => Date.now(),
  listUsers() {
    return db.prepare('SELECT id, username, created_at FROM users ORDER BY id').all() as DbUser[];
  },
  findUserByName(username) {
    return db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: number } | null;
  },
  countUsers() {
    const row = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    return row.count;
  },
  insertUser(username, passwordHash) {
    db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
  },
  deleteUser(id) {
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return { changes: result.changes };
  },
  hashPassword(pw) {
    return bcrypt.hash(pw, 12);
  },
  audit: auditDashboardAdminAttempt,
};

export function listDashboardUsers(
  session: SwitchSession | null | undefined,
  ops: UserAdminOps = defaultUserAdminOps,
): UserAdminResult {
  const actor = session ? actorFromSession(session) : 'anonymous';
  try {
    if (!session) throw new AccountSwitchHttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    if (!isAdminSession(session)) throw new AccountSwitchHttpError(403, 'Admin access required', 'FORBIDDEN');

    const users = ops.listUsers();
    auditUserAdmin(ops, {
      route: 'settings/users',
      verb: 'GET',
      actor,
      outcome: 'listed',
    });
    return {
      status: 200,
      body: {
        users: users.map((user) => ({
          id: user.id,
          username: user.username,
          created_at: user.created_at,
        })),
      },
    };
  } catch (err) {
    const http = toUserAdminHttpError(err, 'Failed to fetch users', 'USER_LIST_FAILED');
    auditUserAdmin(ops, {
      route: 'settings/users',
      verb: 'GET',
      actor,
      outcome: http.code,
    });
    return responsePayload(http.status, { error: http.message, code: http.code });
  }
}

export async function createDashboardUser(
  request: NextRequest,
  session: SwitchSession | null | undefined,
  ops: UserAdminOps = defaultUserAdminOps,
): Promise<UserAdminResult> {
  const actor = session ? actorFromSession(session) : 'anonymous';
  let target: string | undefined;

  try {
    if (!session) throw new AccountSwitchHttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    if (!isAdminSession(session)) throw new AccountSwitchHttpError(403, 'Admin access required', 'FORBIDDEN');
    verifyCsrfAndOrigin(request);

    const body = await readJsonBody(request);
    const username = typeof body.username === 'string' ? body.username : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const trimmed = username.trim();
    target = trimmed || undefined;

    if (!trimmed || trimmed.length < 3) {
      throw new AccountSwitchHttpError(400, 'Username must be at least 3 characters', 'INVALID_USERNAME');
    }
    if (!password || password.length < 12) {
      throw new AccountSwitchHttpError(400, 'Password must be at least 12 characters', 'INVALID_PASSWORD');
    }
    if (trimmed === adminUsername()) {
      throw new AccountSwitchHttpError(400, 'Reserved username', 'RESERVED_USERNAME');
    }
    if (ops.findUserByName(trimmed)) {
      throw new AccountSwitchHttpError(409, 'Username already exists', 'USERNAME_EXISTS');
    }

    const hash = await ops.hashPassword(password);
    ops.insertUser(trimmed, hash);
    auditUserAdmin(ops, {
      route: 'settings/users',
      verb: 'POST',
      actor,
      target: trimmed,
      outcome: 'created',
    });
    return responsePayload(200, { success: true });
  } catch (err) {
    const http = toUserAdminHttpError(err, 'Failed to add user', 'USER_CREATE_FAILED');
    auditUserAdmin(ops, {
      route: 'settings/users',
      verb: 'POST',
      actor,
      ...(target ? { target } : {}),
      outcome: http.code,
    });
    return responsePayload(http.status, { error: http.message, code: http.code });
  }
}

export async function deleteDashboardUser(
  request: NextRequest,
  session: SwitchSession | null | undefined,
  ops: UserAdminOps = defaultUserAdminOps,
): Promise<UserAdminResult> {
  const actor = session ? actorFromSession(session) : 'anonymous';
  let target: unknown;

  try {
    if (!session) throw new AccountSwitchHttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    if (!isAdminSession(session)) throw new AccountSwitchHttpError(403, 'Admin access required', 'FORBIDDEN');
    verifyCsrfAndOrigin(request);

    const body = await readJsonBody(request);
    target = body.id;
    const id = typeof target === 'number' ? target : Number(target);

    const count = ops.countUsers();
    if (count <= 1) {
      throw new AccountSwitchHttpError(400, 'Cannot delete the last user', 'CANNOT_DELETE_LAST_USER');
    }

    const result = ops.deleteUser(id);
    if (result.changes === 0) {
      throw new AccountSwitchHttpError(404, 'User not found', 'USER_NOT_FOUND');
    }

    auditUserAdmin(ops, {
      route: 'settings/users',
      verb: 'DELETE',
      actor,
      target: id,
      outcome: 'deleted',
    });
    return responsePayload(200, { success: true });
  } catch (err) {
    const http = toUserAdminHttpError(err, 'Failed to delete user', 'USER_DELETE_FAILED');
    auditUserAdmin(ops, {
      route: 'settings/users',
      verb: 'DELETE',
      actor,
      ...(target !== undefined ? { target } : {}),
      outcome: http.code,
    });
    return responsePayload(http.status, { error: http.message, code: http.code });
  }
}

async function readJsonBody(request: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body as Record<string, unknown> : {};
  } catch {
    throw new AccountSwitchHttpError(400, 'Invalid JSON body', 'INVALID_JSON');
  }
}

function responsePayload(status: number, body: Record<string, unknown>): UserAdminResult {
  return { status, body };
}

function toUserAdminHttpError(err: unknown, fallbackMessage: string, fallbackCode: string): AccountSwitchHttpError {
  if (err instanceof AccountSwitchHttpError) return err;
  return new AccountSwitchHttpError(500, fallbackMessage, fallbackCode);
}

function auditUserAdmin(ops: UserAdminOps, event: Record<string, unknown>): void {
  try {
    ops.audit(event);
  } catch {
    // Audit is best-effort; route responses are still governed by the checks above.
  }
}

function auditDashboardAdminAttempt(event: Record<string, unknown>): void {
  try {
    execFileSync('cortextos', ['bus', 'log-event', 'action', 'dashboard_admin_mutation', 'info', '--meta', JSON.stringify(event)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 5000,
      env: {
        ...process.env,
        CTX_ROOT: getCTXRoot(),
        CTX_FRAMEWORK_ROOT: getFrameworkRoot(),
        CTX_PROJECT_ROOT: getFrameworkRoot(),
        CTX_INSTANCE_ID: process.env.CTX_INSTANCE_ID ?? 'default',
        CTX_AGENT_NAME: process.env.CTX_AGENT_NAME ?? 'dashboard',
      },
    });
  } catch {
    // Audit is best-effort; route responses are still governed by the checks above.
  }
}

function adminUsername(): string {
  return process.env.ADMIN_USERNAME ?? 'admin';
}
