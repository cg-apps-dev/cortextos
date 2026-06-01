/**
 * Shared comms message loader.
 *
 * The Comms Hub exposes three routes — feed, channels, and channel/[pair] —
 * that must all see the SAME set of messages. Historically each route
 * re-implemented its own scan, and they diverged: the feed scanned the real
 * on-disk locations, `channels` scanned nothing beyond the (never-written)
 * history log, and `channel/[pair]` scanned a path that does not exist
 * (`inbox/{agent}/processed`). The result was agent-to-agent channels that
 * showed up empty even though the messages were sitting on disk.
 *
 * This module is the single source of truth for "where comms messages come
 * from". Routes consume its output and own only presentation (filtering,
 * sorting, grouping). One reader → no drift.
 *
 * Sources, in precedence order (first writer of an id wins):
 *   1. logs/message-history.jsonl   — persistent bus history log, if present.
 *   2. Bus message JSON files       — agent-to-agent send-message output:
 *        - processed/{agent}/        (ACK'd messages — canonical resting place)
 *        - inbox/{agent}/            (pending, not yet checked)
 *        - inbox/{agent}/inflight/   (checked, not yet ACK'd)
 *   3. Telegram logs                — admin↔agent traffic:
 *        - logs/{agent}/inbound-messages.jsonl
 *        - logs/{agent}/outbound-messages.jsonl
 */

import fs from 'fs';
import path from 'path';
import type { CommsIdentity } from './comms-identity';

export interface BusMessage {
  id: string;
  from: string;
  to: string;
  priority: string;
  timestamp: string;
  text: string;
  reply_to: string | null;
  /** Optional origin marker — set for Telegram voice notes so the UI can
   *  render a microphone indicator next to the transcript. */
  media_type?: string;
}

function listAgentDirs(base: string): string[] {
  if (!fs.existsSync(base)) return [];
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return [];
  }
}

/**
 * Load every comms message visible to the dashboard, deduplicated by id.
 *
 * Order is NOT guaranteed — callers sort as needed. Deduplication is
 * first-seen-wins, with sources visited in the precedence order documented
 * above (history log before inbox scans before Telegram).
 */
export function loadBusMessages(
  ctxRoot: string,
  identity: CommsIdentity,
): BusMessage[] {
  const messages: BusMessage[] = [];
  const seen = new Set<string>();

  const push = (m: BusMessage): void => {
    if (!m.id || !m.from || !m.to || !m.timestamp) return;
    if (seen.has(m.id)) return;
    seen.add(m.id);
    messages.push(m);
  };

  // 1. Primary source: persistent message history log (JSONL).
  const historyLog = path.join(ctxRoot, 'logs', 'message-history.jsonl');
  if (fs.existsSync(historyLog)) {
    try {
      for (const line of fs.readFileSync(historyLog, 'utf-8').trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          push(JSON.parse(line) as BusMessage);
        } catch { /* skip corrupt line */ }
      }
    } catch { /* fall through to inbox scan */ }
  }

  // 2. Bus message JSON files. Reads one `.json` message per file.
  const scanDir = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('.'));
    } catch {
      return;
    }
    for (const file of files) {
      try {
        push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as BusMessage);
      } catch { /* skip corrupt file */ }
    }
  };

  // processed/{agent}/ — canonical resting place for ACK'd messages.
  const processedBase = path.join(ctxRoot, 'processed');
  for (const agent of listAgentDirs(processedBase)) {
    scanDir(path.join(processedBase, agent));
  }

  // inbox/{agent}/ (pending) and inbox/{agent}/inflight/ (checked, un-ACK'd).
  const inboxBase = path.join(ctxRoot, 'inbox');
  for (const agent of listAgentDirs(inboxBase)) {
    scanDir(path.join(inboxBase, agent));
    scanDir(path.join(inboxBase, agent, 'inflight'));
  }

  // 3. Telegram logs (inbound from user + outbound from agents).
  //
  // Voice transcript dedup — a Telegram voice note produces two log entries
  // with the same message_id: a stub (empty text, written on delivery) and a
  // transcript (full text, written after transcription). A two-pass map keeps
  // the entry with real text; pure stubs (no transcript ever arrives) are
  // dropped because they carry no displayable content.
  const logsBase = path.join(ctxRoot, 'logs');
  for (const agent of listAgentDirs(logsBase)) {
    for (const logFile of ['inbound-messages.jsonl', 'outbound-messages.jsonl']) {
      const filePath = path.join(logsBase, agent, logFile);
      if (!fs.existsSync(filePath)) continue;
      const isInbound = logFile.startsWith('inbound');
      const bestByMsgId = new Map<string, BusMessage>();
      try {
        for (const line of fs.readFileSync(filePath, 'utf-8').trim().split('\n')) {
          if (!line.trim()) continue;
          try {
            const raw = JSON.parse(line);
            if (!raw.timestamp) continue;
            const msgId = `tg-${isInbound ? 'in' : 'out'}-${agent}-${raw.message_id || raw.timestamp}`;
            const fromName = isInbound ? identity.canonicalUser : agent;
            const toName = isInbound ? agent : identity.canonicalUser;
            const candidate: BusMessage = {
              id: msgId,
              from: fromName,
              to: toName,
              priority: 'normal',
              timestamp: raw.timestamp,
              text: raw.text || raw.transcript || '',
              reply_to: null,
              ...(raw.media_type ? { media_type: raw.media_type } : {}),
            };
            const existing = bestByMsgId.get(msgId);
            if (!existing) {
              bestByMsgId.set(msgId, candidate);
            } else if (!existing.text && candidate.text) {
              bestByMsgId.set(msgId, candidate);
            }
          } catch { /* skip malformed line */ }
        }
      } catch { /* skip unreadable file */ }

      for (const msg of bestByMsgId.values()) {
        if (!msg.text) continue; // drop pure stubs with no transcript
        push(msg);
      }
    }
  }

  return messages;
}
