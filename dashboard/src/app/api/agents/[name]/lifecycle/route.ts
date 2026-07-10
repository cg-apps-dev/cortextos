import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { auth } from '@/lib/auth';
import { getFrameworkRoot, getCTXRoot } from '@/lib/config';
import { IPCClient, type IPCRequest, type IPCResponse } from '@/lib/ipc-client';
import {
  AccountSwitchHttpError,
  actorFromSession,
  isAdminSession,
  verifyCsrfAndOrigin,
  type SwitchSession,
} from '@/lib/account-switch';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidName(name: string): boolean {
  return /^[a-z0-9_-]+$/.test(name);
}

const VALID_ACTIONS = ['enable', 'disable', 'restart', 'start', 'stop', 'restart_continue', 'restart_fresh'];

export interface LifecycleOps {
  ctxRoot(): string;
  frameworkRoot(): string;
  ipcSend(request: IPCRequest): Promise<IPCResponse>;
  readFile(path: string, encoding: BufferEncoding): Promise<string>;
  writeFile(path: string, data: string, encoding: BufferEncoding): Promise<void>;
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
  audit(event: Record<string, unknown>): void;
}

const defaultLifecycleOps: LifecycleOps = {
  ctxRoot: getCTXRoot,
  frameworkRoot: getFrameworkRoot,
  ipcSend(request) {
    const instanceId = process.env.CTX_INSTANCE_ID ?? 'default';
    return new IPCClient(instanceId).send(request);
  },
  readFile: fs.readFile,
  writeFile: fs.writeFile,
  mkdir: fs.mkdir,
  rm: fs.rm,
  audit: auditLifecycleAttempt,
};

// Security (C4): Validate org and name against allowlist before use in shell commands or path.join.
function validateIdentifier(value: string | null | undefined, field: string): string {
  if (!value || !/^[a-z0-9_-]+$/.test(value)) {
    throw new Error(`Invalid ${field}: must match [a-z0-9_-]+`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// POST /api/agents/[name]/lifecycle - Enable, disable, or restart an agent
//
// Body: { action: "enable" | "disable" | "restart", org?: string, mode?: "continue" | "fresh" }
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await auth();
  const result = await lifecyclePost(request, await params, session);
  return Response.json(result.body, { status: result.status });
}

export async function lifecyclePost(
  request: NextRequest,
  params: { name: string },
  session: SwitchSession | null | undefined,
  ops: LifecycleOps = defaultLifecycleOps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { name } = params;
  const decoded = decodeURIComponent(name);
  const actor = session ? actorFromSession(session) : 'anonymous';

  try {
    if (!session) throw new AccountSwitchHttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    if (!isAdminSession(session)) throw new AccountSwitchHttpError(403, 'Admin access required', 'FORBIDDEN');
    verifyCsrfAndOrigin(request);
  } catch (err) {
    const http = toLifecycleHttpError(err);
    auditLifecycle(ops, { actor, agent: decoded, outcome: http.code });
    return responsePayload(http.status, { error: http.message, code: http.code });
  }

  if (!isValidName(decoded)) {
    auditLifecycle(ops, { actor, agent: decoded, outcome: 'INVALID_AGENT_NAME' });
    return responsePayload(400, { error: 'Invalid agent name' });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    auditLifecycle(ops, { actor, agent: decoded, outcome: 'INVALID_JSON' });
    return responsePayload(400, { error: 'Invalid JSON body' });
  }

  const { action: rawAction, org } = body as {
    action?: string;
    org?: string;
  };

  if (!rawAction || !VALID_ACTIONS.includes(rawAction)) {
    auditLifecycle(ops, { actor, agent: decoded, action: rawAction, outcome: 'INVALID_ACTION' });
    return responsePayload(
      400,
      { error: `action must be one of: ${VALID_ACTIONS.join(', ')}` },
    );
  }

  // Normalize UI action names to IPC action names
  const action = rawAction === 'start' ? 'enable'
    : rawAction === 'stop' ? 'disable'
    : rawAction === 'restart_continue' || rawAction === 'restart_fresh' ? 'restart'
    : rawAction;
  const restartMode = rawAction === 'restart_continue' ? 'continue'
    : rawAction === 'restart_fresh' ? 'fresh'
    : undefined;

  // Security (C4): Validate org before use in shell commands.
  let safeOrg: string | undefined;
  if (org !== undefined) {
    try {
      safeOrg = validateIdentifier(org, 'org');
    } catch (err: any) {
      auditLifecycle(ops, { actor, agent: decoded, action, outcome: 'INVALID_ORG' });
      return responsePayload(400, { error: err.message });
    }
  }

  try {
    let ipcResult: { success: boolean; data?: unknown; error?: string };
    let registryMessage = '';

    switch (action) {
      case 'enable': {
        const ctxRoot = ops.ctxRoot();
        const enabledAgentsPath = path.join(ctxRoot, 'config', 'enabled-agents.json');
        let enabledAgents: Record<string, unknown> = {};
        try {
          const raw = await ops.readFile(enabledAgentsPath, 'utf-8');
          enabledAgents = JSON.parse(raw);
        } catch { /* file may not exist yet */ }
        enabledAgents[decoded] = {
          ...(typeof enabledAgents[decoded] === 'object' && enabledAgents[decoded] !== null
            ? (enabledAgents[decoded] as object)
            : {}),
          enabled: true,
          ...(safeOrg ? { org: safeOrg } : {}),
        };
        await ops.mkdir(path.dirname(enabledAgentsPath), { recursive: true });
        await ops.writeFile(enabledAgentsPath, JSON.stringify(enabledAgents, null, 2) + '\n', 'utf-8');
        registryMessage = 'enabled in registry';
        ipcResult = await ops.ipcSend({ type: 'start-agent', agent: decoded });
        break;
      }

      case 'disable': {
        ipcResult = await ops.ipcSend({ type: 'stop-agent', agent: decoded });
        const ctxRoot = ops.ctxRoot();
        const enabledAgentsPath = path.join(ctxRoot, 'config', 'enabled-agents.json');
        try {
          const raw = await ops.readFile(enabledAgentsPath, 'utf-8');
          const enabledAgents = JSON.parse(raw) as Record<string, unknown>;
          if (enabledAgents[decoded] && typeof enabledAgents[decoded] === 'object') {
            (enabledAgents[decoded] as Record<string, unknown>).enabled = false;
          }
          await ops.writeFile(enabledAgentsPath, JSON.stringify(enabledAgents, null, 2) + '\n', 'utf-8');
          registryMessage = 'disabled in registry';
        } catch {
          registryMessage = 'registry update failed (non-fatal)';
        }
        break;
      }

      case 'restart': {
        ipcResult = await ops.ipcSend({ type: 'restart-agent', agent: decoded, ...(restartMode ? { mode: restartMode } : {}) });
        registryMessage = '';
        break;
      }

      default:
        return responsePayload(400, { error: 'Invalid action' });
    }

    if (!ipcResult.success) {
      const isDaemonDown = ipcResult.error?.includes('Daemon is not running');
      if (isDaemonDown && action === 'enable') {
        auditLifecycle(ops, { actor, agent: decoded, action, outcome: 'success' });
        return responsePayload(200, {
          success: true,
          action,
          agent: decoded,
          output: `${registryMessage}; daemon not running - agent will start when daemon starts`,
        });
      }
      console.error(`[api/agents/${decoded}/lifecycle] POST IPC error (${action}):`, ipcResult.error);
      auditLifecycle(ops, { actor, agent: decoded, action, outcome: 'IPC_FAILED' });
      return responsePayload(
        500,
        { error: `Failed to ${action} agent: ${ipcResult.error ?? 'unknown IPC error'}` },
      );
    }

    auditLifecycle(ops, { actor, agent: decoded, action, outcome: 'success' });
    return responsePayload(200, {
      success: true,
      action,
      agent: decoded,
      output: [registryMessage, String(ipcResult.data ?? '')].filter(Boolean).join('; '),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/agents/${decoded}/lifecycle] POST error:`, message);
    auditLifecycle(ops, { actor, agent: decoded, action, outcome: 'LIFECYCLE_POST_FAILED' });
    return responsePayload(500, { error: `Failed to ${action} agent` });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/agents/[name]/lifecycle - Remove an agent entirely
//
// Query params: ?deleteFiles=true to also remove agent directory
// ---------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await auth();
  const result = await lifecycleDelete(request, await params, session);
  return Response.json(result.body, { status: result.status });
}

export async function lifecycleDelete(
  request: NextRequest,
  params: { name: string },
  session: SwitchSession | null | undefined,
  ops: LifecycleOps = defaultLifecycleOps,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { name } = params;
  const decoded = decodeURIComponent(name);
  const actor = session ? actorFromSession(session) : 'anonymous';

  try {
    if (!session) throw new AccountSwitchHttpError(401, 'Authentication required', 'UNAUTHENTICATED');
    if (!isAdminSession(session)) throw new AccountSwitchHttpError(403, 'Admin access required', 'FORBIDDEN');
    verifyCsrfAndOrigin(request);
  } catch (err) {
    const http = toLifecycleHttpError(err);
    auditLifecycle(ops, { actor, agent: decoded, action: 'delete', deleteFiles: false, outcome: http.code });
    return responsePayload(http.status, { error: http.message, code: http.code });
  }

  if (!isValidName(decoded)) {
    auditLifecycle(ops, { actor, agent: decoded, action: 'delete', deleteFiles: false, outcome: 'INVALID_AGENT_NAME' });
    return responsePayload(400, { error: 'Invalid agent name' });
  }

  const ctxRoot = ops.ctxRoot();
  const enabledAgentsPath = path.join(ctxRoot, 'config', 'enabled-agents.json');
  const deleteFiles = request.nextUrl.searchParams.get('deleteFiles') === 'true';
  const confirmName = await readConfirmName(request);
  if (deleteFiles && confirmName !== decoded) {
    auditLifecycle(ops, { actor, agent: decoded, action: 'delete', deleteFiles, outcome: 'CONFIRM_REQUIRED' });
    return responsePayload(400, { error: 'confirmName must match agent name', code: 'CONFIRM_REQUIRED' });
  }

  // Look up org from enabled-agents.json
  let org = '';
  let enabledAgents: Record<string, { org?: string; enabled?: boolean }> = {};
  try {
    const raw = await ops.readFile(enabledAgentsPath, 'utf-8');
    enabledAgents = JSON.parse(raw);
    if (enabledAgents[decoded]) {
      org = enabledAgents[decoded].org ?? '';
    }
  } catch {
    // File doesn't exist or is malformed
  }
  if (!enabledAgents[decoded]) {
    auditLifecycle(ops, { actor, agent: decoded, action: 'delete', deleteFiles, outcome: 'AGENT_NOT_IN_REGISTRY' });
    return responsePayload(400, { error: 'Agent not found in registry' });
  }

  // Security (C4): Validate org from stored data before use in shell commands and path.join.
  let safeDeleteOrg = '';
  if (org) {
    try {
      safeDeleteOrg = validateIdentifier(org, 'org');
    } catch {
      // org stored in registry is malformed - skip shell/fs operations that use it
      safeDeleteOrg = '';
    }
  }

  // 1. Tell daemon to stop the agent (best-effort; agent may already be stopped)
  {
    const stopResult = await ops.ipcSend({ type: 'stop-agent', agent: decoded });
    if (!stopResult.success && !stopResult.error?.includes('Daemon is not running')) {
      console.warn(`[api/agents/${decoded}/lifecycle] stop during delete:`, stopResult.error);
    }
  }

  // 2. Remove from enabled-agents.json
  try {
    delete enabledAgents[decoded];
    await ops.writeFile(
      enabledAgentsPath,
      JSON.stringify(enabledAgents, null, 2) + '\n',
      'utf-8',
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api/agents/${decoded}/lifecycle] failed to update enabled-agents.json:`, message);
    auditLifecycle(ops, { actor, agent: decoded, action: 'delete', deleteFiles, outcome: 'REGISTRY_UPDATE_FAILED' });
    return responsePayload(
      500,
      { error: 'Failed to update agent registry' },
    );
  }

  // 3. Optionally remove agent directory
  if (deleteFiles && safeDeleteOrg) {
    try {
      const agentDir = path.join(ops.frameworkRoot(), 'orgs', safeDeleteOrg, 'agents', decoded);
      await ops.rm(agentDir, { recursive: true, force: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[api/agents/${decoded}/lifecycle] failed to remove agent dir:`, message);
      // Non-fatal - agent is already deregistered
    }
  }

  auditLifecycle(ops, { actor, agent: decoded, action: 'delete', deleteFiles, outcome: 'success' });
  return responsePayload(200, { success: true, deleted: decoded });
}

function responsePayload(status: number, body: Record<string, unknown>): { status: number; body: Record<string, unknown> } {
  return { status, body };
}

function toLifecycleHttpError(err: unknown): AccountSwitchHttpError {
  if (err instanceof AccountSwitchHttpError) return err;
  return new AccountSwitchHttpError(500, 'Lifecycle request failed', 'LIFECYCLE_REQUEST_FAILED');
}

function auditLifecycle(ops: LifecycleOps, event: Record<string, unknown>): void {
  try {
    ops.audit(event);
  } catch {
    // Audit is best-effort; route responses are still governed by the checks above.
  }
}

async function readConfirmName(request: NextRequest): Promise<string | null> {
  const fromQuery = request.nextUrl.searchParams.get('confirmName');
  if (fromQuery) return fromQuery;
  try {
    const text = await request.text();
    if (!text.trim()) return null;
    const body = JSON.parse(text) as { confirmName?: unknown };
    return typeof body.confirmName === 'string' ? body.confirmName : null;
  } catch {
    return null;
  }
}

function auditLifecycleAttempt(event: Record<string, unknown>): void {
  try {
    execFileSync('cortextos', ['bus', 'log-event', 'action', 'agent_lifecycle_attempt', 'info', '--meta', JSON.stringify(event)], {
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
