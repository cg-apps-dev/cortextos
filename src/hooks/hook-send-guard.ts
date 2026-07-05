/**
 * hook-send-guard.ts - PreToolUse hook for Bash bus-send commands.
 *
 * Blocks two clear failure modes:
 * - raw backticks in cortextos bus send-message/send-telegram commands
 * - msg-id-shaped send-message reply_to values that were never in this inbox
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseHookInput, readStdin } from './index.js';

export const MSG_ID_RE = /^[0-9]{10,}-[a-z][a-z0-9-]*-[a-z0-9]+$/;
const BUS_SEND_RE = /(?:^|[;&|]\s*)cortextos\s+bus\s+(send-message|send-telegram)(?:\s|$)/;

export const BACKTICK_DENY_REASON =
  'send-guard: backtick in a bus-send command risks shell command-substitution + is unnecessary in agent messages - remove the backticks (use plain text; markdown ` ` renders fine without them) and retry.';

export function replyToDenyReason(id: string): string {
  return `send-guard: reply_to ${id} is not a message in your inbox - it will NOT ACK (ackInbox silently no-ops on an unknown id), so the message you are replying to will redeliver + this reply mis-threads. Use the exact msg_id of the message you are replying to (from the === ... [msg_id: <id>] === header), or omit reply_to. Retry with the correct id.`;
}

export interface SendCommandInfo {
  kind: 'send-message' | 'send-telegram';
}

export interface InboxLookupOptions {
  ctxRoot?: string;
  agentName?: string;
}

export type SendGuardDecision =
  | { permissionDecision: 'allow' }
  | { permissionDecision: 'deny'; permissionDecisionReason: string };

export function formatPreToolUseDecision(decision: SendGuardDecision): {
  hookSpecificOutput: { hookEventName: 'PreToolUse' } & SendGuardDecision;
} {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      ...decision,
    },
  };
}

export function outputPreToolUseDecision(decision: SendGuardDecision): void {
  process.stdout.write(JSON.stringify(formatPreToolUseDecision(decision)) + '\n');
}

export function detectBusSendCommand(command: string): SendCommandInfo | null {
  const match = command.match(BUS_SEND_RE);
  if (!match) return null;
  const kind = match[1] === 'send-message' ? 'send-message' : 'send-telegram';
  return { kind };
}

export function extractTrailingReplyTo(command: string): string | null {
  const trimmed = command.trim();
  const lastToken = trimmed.split(/\s+/).pop();
  if (!lastToken || !MSG_ID_RE.test(lastToken)) return null;
  return lastToken;
}

function idTimestamp(id: string): number | null {
  const raw = id.split('-', 1)[0];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageIdsInDir(dir: string): string[] {
  const ids: string[] = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    try {
      const parsed = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      if (parsed && typeof parsed.id === 'string') {
        ids.push(parsed.id);
      }
    } catch {
      // Ignore corrupt inbox files. The hook should never block on unreadable
      // individual messages.
    }
  }
  return ids;
}

export function findReplyToInRetainedInbox(replyTo: string, opts: InboxLookupOptions = {}): {
  status: 'found' | 'absent' | 'unresolvable' | 'older-than-retained';
} {
  const ctxRoot = opts.ctxRoot ?? process.env.CTX_ROOT;
  const agentName = opts.agentName ?? process.env.CTX_AGENT_NAME;
  if (!ctxRoot || !agentName) return { status: 'unresolvable' };

  const inflightDir = join(ctxRoot, 'inflight', agentName);
  const processedDir = join(ctxRoot, 'processed', agentName);
  if (!existsSync(inflightDir) || !existsSync(processedDir)) {
    return { status: 'unresolvable' };
  }

  let ids: string[];
  try {
    ids = [...messageIdsInDir(inflightDir), ...messageIdsInDir(processedDir)];
  } catch {
    return { status: 'unresolvable' };
  }

  if (ids.includes(replyTo)) return { status: 'found' };

  const retainedTimestamps = ids
    .map(idTimestamp)
    .filter((ts): ts is number => ts !== null);
  if (retainedTimestamps.length === 0) {
    return { status: 'unresolvable' };
  }

  const replyToTimestamp = idTimestamp(replyTo);
  if (replyToTimestamp !== null && replyToTimestamp < Math.min(...retainedTimestamps)) {
    return { status: 'older-than-retained' };
  }

  return { status: 'absent' };
}

export function decideSendGuard(command: string, opts: InboxLookupOptions = {}): SendGuardDecision {
  const busSend = detectBusSendCommand(command);
  if (!busSend) return { permissionDecision: 'allow' };

  if (command.includes('`')) {
    return { permissionDecision: 'deny', permissionDecisionReason: BACKTICK_DENY_REASON };
  }

  if (busSend.kind !== 'send-message') {
    return { permissionDecision: 'allow' };
  }

  const replyTo = extractTrailingReplyTo(command);
  if (!replyTo) {
    return { permissionDecision: 'allow' };
  }

  const lookup = findReplyToInRetainedInbox(replyTo, opts);
  if (lookup.status === 'absent') {
    return { permissionDecision: 'deny', permissionDecisionReason: replyToDenyReason(replyTo) };
  }

  return { permissionDecision: 'allow' };
}

async function main(): Promise<void> {
  const input = await readStdin();
  const { tool_name, tool_input } = parseHookInput(input);
  if (tool_name !== 'Bash') {
    outputPreToolUseDecision({ permissionDecision: 'allow' });
    return;
  }

  const command = typeof tool_input.command === 'string' ? tool_input.command : '';
  outputPreToolUseDecision(decideSendGuard(command));
}

if (require.main === module) {
  main().catch(() => {
    outputPreToolUseDecision({ permissionDecision: 'allow' });
  });
}
