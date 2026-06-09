/**
 * Telegram context-usage footer.
 *
 * Every outbound Telegram message ends with a one-line footer showing the
 * sending agent's current Claude Code context-window usage (Adam cost-visibility
 * request). The data is produced by the `statusLine` hook (hook-context-status),
 * which runs INSIDE each agent's Claude Code session and writes the live
 * context-window figures to `state/<agent>/context_status.json` per turn. The
 * `send-telegram` CLI runs as a separate short-lived process, so it reads that
 * file rather than introspecting a session it cannot see.
 *
 * Graceful degradation is mandatory: if the source is missing, stale, or
 * pre-first-API-call (used_percentage null), the footer is OMITTED entirely.
 * We never render a misleading fresh-looking `0%` from a stale file — a stale
 * read is indistinguishable from "no data", so we show nothing.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/** Shape written by hook-context-status. All fields optional/nullable by design. */
interface ContextStatus {
  used_percentage?: number | null;
  context_window_size?: number | null;
  total_input_tokens?: number | null;
  written_at?: string | null;
}

/** Default freshness window. The statusLine hook fires per assistant turn, so a
 *  file older than this means the session is idle/gone — treat as no data. */
export const DEFAULT_MAX_AGE_MS = 120_000;

const DEFAULT_WINDOW_SIZE = 200_000;

/** Read + parse context_status.json for an agent. Returns null on any problem. */
export function readContextStatus(ctxRoot: string, agentName: string): ContextStatus | null {
  try {
    const p = join(ctxRoot, 'state', agentName, 'context_status.json');
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    return (parsed && typeof parsed === 'object') ? parsed as ContextStatus : null;
  } catch {
    return null;
  }
}

/** Round a token count to a compact `k` string, e.g. 124300 -> "124k", 850 -> "1k", 0 -> "0k". */
function toK(tokens: number): string {
  return `${Math.max(0, Math.round(tokens / 1000))}k`;
}

/**
 * Build the footer line from a status object, or null if it should be omitted.
 * Omit when: no status, no/invalid written_at, stale (> maxAgeMs), or
 * used_percentage is not a finite number (e.g. null before the first API call).
 *
 * Token numerator preference: real `total_input_tokens` (current context
 * occupancy) when present; otherwise derive from used_percentage * window size
 * so the figure always stays consistent with the percentage shown.
 */
export function buildContextFooter(
  status: ContextStatus | null,
  nowMs: number,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): string | null {
  if (!status) return null;

  // Freshness guard — a stale read must never masquerade as current.
  const writtenMs = status.written_at ? Date.parse(status.written_at) : NaN;
  if (!Number.isFinite(writtenMs)) return null;
  if (nowMs - writtenMs > maxAgeMs) return null;

  // Percentage is the authoritative signal; null/non-finite => no usable data.
  const pct = status.used_percentage;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;

  const size = (typeof status.context_window_size === 'number' && status.context_window_size > 0)
    ? status.context_window_size
    : DEFAULT_WINDOW_SIZE;

  const tokens = (typeof status.total_input_tokens === 'number' && Number.isFinite(status.total_input_tokens))
    ? status.total_input_tokens
    : (pct / 100) * size;

  return `---\nctx: ~${toK(tokens)} / ${toK(size)} (${Math.round(pct)}%)`;
}

/**
 * Append the context-usage footer to an outbound message. Returns the message
 * unchanged when there is no fresh data to show (graceful degradation), so the
 * caller can use the result unconditionally.
 */
export function appendContextFooter(
  message: string,
  ctxRoot: string,
  agentName: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): string {
  const footer = buildContextFooter(readContextStatus(ctxRoot, agentName), nowMs, maxAgeMs);
  return footer ? `${message}\n\n${footer}` : message;
}
