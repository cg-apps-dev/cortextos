/**
 * Persistent reminder queue (pending-reminders.json).
 *
 * Solves the cron-loss-on-hard-restart problem (#69).
 * Claude Code CronCreate records are in-memory only - they evaporate on hard-restart.
 * This module provides a file-backed queue in state/{agent}/pending-reminders.json
 * that survives any restart type and is injected into the agent boot prompt.
 *
 * Lifecycle:
 *   1. Agent calls `cortextos bus create-reminder <fire-at> <prompt>`
 *   2. The fast-checker poll loop injects it LIVE when fire_at passes
 *      (getDueReminders -> markReminderDelivered); the daemon boot prompt
 *      additionally includes any overdue un-acked reminders as the
 *      restart-survival path (getOverdueReminders)
 *   3. Agent processes the reminder, calls `cortextos bus ack-reminder <id>`
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { ensureDir } from '../utils/atomic.js';
import type { BusPaths } from '../types/index.js';

export interface Reminder {
  id: string;
  created_at: string;
  fire_at: string;      // ISO 8601 UTC - when the reminder should fire
  prompt: string;       // The text to inject when due (live poll or boot prompt)
  status: 'pending' | 'delivered' | 'acked';
  delivered_at?: string; // last live injection into a running session
  acked_at?: string;
}

/**
 * A delivered-but-unacked reminder is re-injected after this long, mirroring
 * the inbox un-ACK redelivery semantics (the agent may have crashed or
 * compacted between injection and handling).
 */
export const REMINDER_REDELIVER_MS = 5 * 60 * 1000;

function remindersPath(paths: BusPaths): string {
  return join(paths.stateDir, 'pending-reminders.json');
}

function readReminders(paths: BusPaths): Reminder[] {
  const filePath = remindersPath(paths);
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeReminders(paths: BusPaths, reminders: Reminder[]): void {
  ensureDir(paths.stateDir);
  writeFileSync(remindersPath(paths), JSON.stringify(reminders, null, 2) + '\n', 'utf-8');
}

/**
 * Create a new persistent reminder.
 * fire_at: ISO 8601 UTC string (e.g. "2026-04-05T08:00:00Z")
 * prompt: text to inject into agent boot prompt when overdue
 */
export function createReminder(paths: BusPaths, fireAt: string, prompt: string): Reminder {
  // Validate fire_at is a parseable date
  const ts = Date.parse(fireAt);
  if (isNaN(ts)) {
    throw new Error(`Invalid fire_at date: "${fireAt}". Use ISO 8601 format, e.g. 2026-04-05T08:00:00Z`);
  }

  const id = `${Date.now()}-reminder-${randomBytes(3).toString('hex')}`;
  const reminder: Reminder = {
    id,
    created_at: new Date().toISOString(),
    fire_at: new Date(ts).toISOString(),
    prompt,
    status: 'pending',
  };

  const reminders = readReminders(paths);
  reminders.push(reminder);
  writeReminders(paths, reminders);
  return reminder;
}

/**
 * List reminders. By default returns outstanding ones (pending or delivered
 * but not yet acked).
 */
export function listReminders(paths: BusPaths, opts: { all?: boolean } = {}): Reminder[] {
  const reminders = readReminders(paths);
  if (opts.all) return reminders;
  return reminders.filter(r => r.status !== 'acked');
}

/**
 * Return un-acked reminders whose fire_at is in the past (overdue).
 * Used by agent-process.ts to inject into the boot prompt. Includes
 * 'delivered' reminders so one injected into a session that died before
 * handling it re-surfaces on the next boot.
 */
export function getOverdueReminders(paths: BusPaths): Reminder[] {
  const now = Date.now();
  return readReminders(paths).filter(
    r => r.status !== 'acked' && Date.parse(r.fire_at) <= now,
  );
}

/**
 * Return reminders due for LIVE injection into a running session: overdue
 * and either never delivered, or delivered longer than redeliverMs ago
 * without an ack. Used by the fast-checker poll loop - without this path a
 * reminder created mid-session only ever fired at the next restart (the
 * silent non-fire that left the fleet paused 35 min past its resume window,
 * 2026-06-10).
 */
export function getDueReminders(
  paths: BusPaths,
  redeliverMs: number = REMINDER_REDELIVER_MS,
): Reminder[] {
  const now = Date.now();
  return readReminders(paths).filter(r => {
    if (r.status === 'acked') return false;
    if (Date.parse(r.fire_at) > now) return false;
    if (r.status === 'pending') return true;
    const deliveredAt = r.delivered_at ? Date.parse(r.delivered_at) : 0;
    return now - deliveredAt >= redeliverMs;
  });
}

/**
 * Mark a reminder as delivered (live-injected into a running session).
 * The agent still acks it after handling; un-acked delivered reminders
 * are re-injected after REMINDER_REDELIVER_MS and re-surface at boot.
 */
export function markReminderDelivered(paths: BusPaths, id: string): void {
  const reminders = readReminders(paths);
  const idx = reminders.findIndex(r => r.id === id);
  if (idx === -1) {
    throw new Error(`Reminder ${id} not found`);
  }
  reminders[idx] = {
    ...reminders[idx],
    status: 'delivered',
    delivered_at: new Date().toISOString(),
  };
  writeReminders(paths, reminders);
}

/**
 * Acknowledge a reminder by ID - marks it as handled.
 */
export function ackReminder(paths: BusPaths, id: string): void {
  const reminders = readReminders(paths);
  const idx = reminders.findIndex(r => r.id === id);
  if (idx === -1) {
    throw new Error(`Reminder ${id} not found`);
  }
  reminders[idx] = {
    ...reminders[idx],
    status: 'acked',
    acked_at: new Date().toISOString(),
  };
  writeReminders(paths, reminders);
}

/**
 * Delete acked reminders older than retainDays (default 7).
 * Call periodically to prevent unbounded file growth.
 */
export function pruneReminders(paths: BusPaths, retainDays: number = 7): number {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const reminders = readReminders(paths);
  const kept = reminders.filter(r => {
    if (r.status !== 'acked') return true;
    const ackedAt = r.acked_at ? Date.parse(r.acked_at) : 0;
    return ackedAt > cutoff;
  });
  const pruned = reminders.length - kept.length;
  if (pruned > 0) writeReminders(paths, kept);
  return pruned;
}
