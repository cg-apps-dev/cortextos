/**
 * Codex (OpenAI ChatGPT plan) usage reader - ZERO-TOKEN, ZERO-AUTH, no network.
 *
 * The codex CLI persists its rate-limit to its own rollout session files
 * (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl). Each carries a `rate_limits`
 * object structurally parallel to the Claude 5h/7d usage:
 *   primary   { used_percent, window_minutes: 300  (=5h),  resets_at }
 *   secondary { used_percent, window_minutes: 10080 (=7d), resets_at }
 *   plan_type, credits, rate_limit_reached_type
 *
 * We read the newest rollout that carries rate_limits and parse the LAST such
 * entry (most recent reading). This is the same local-file class already read
 * for codex-tokens logging - NO token, NO endpoint, NO auth surface. The
 * value is the LAST-SEEN reading (as fresh as the last codex run); the card
 * wears an as-of timestamp so the freshness caveat is explicit.
 *
 * The always-fresh path (the token-bearing /wham/usage endpoint) is parked -
 * it would be auth-adjacent; this reader covers the ask without it.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface CodexUsageWindow {
  used_percent: number;
  window_minutes: number;
  resets_at?: number; // unix seconds
}

export interface CodexUsage {
  primary?: CodexUsageWindow;    // 5h window
  secondary?: CodexUsageWindow;  // 7d window
  plan_type?: string;
  rate_limit_reached?: boolean;
  /** ISO timestamp of the rollout file this reading came from (as-of). */
  as_of: string;
}

function sessionsDir(codexHome: string): string {
  return join(codexHome, 'sessions');
}

/** Collect rollout-*.jsonl paths (recursively under sessions/), newest first. */
function rolloutFilesNewestFirst(dir: string): string[] {
  const out: { path: string; mtime: number }[] = [];
  const walk = (d: string, depth: number): void => {
    if (depth > 5) return;
    let entries: string[];
    try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      const p = join(d, name);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        walk(p, depth + 1);
      } else if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
        out.push({ path: p, mtime: st.mtimeMs });
      }
    }
  };
  walk(dir, 0);
  out.sort((a, b) => b.mtime - a.mtime);
  return out.map((o) => o.path);
}

/** Find a rate_limits object anywhere in a parsed rollout line. */
function findRateLimits(obj: unknown): Record<string, unknown> | null {
  if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    if (rec.rate_limits && typeof rec.rate_limits === 'object') {
      return rec.rate_limits as Record<string, unknown>;
    }
    for (const v of Object.values(rec)) {
      const r = findRateLimits(v);
      if (r) return r;
    }
  }
  return null;
}

function toWindow(w: unknown): CodexUsageWindow | undefined {
  if (!w || typeof w !== 'object') return undefined;
  const o = w as Record<string, unknown>;
  if (typeof o.used_percent !== 'number') return undefined;
  return {
    used_percent: o.used_percent,
    window_minutes: typeof o.window_minutes === 'number' ? o.window_minutes : 0,
    resets_at: typeof o.resets_at === 'number' ? o.resets_at : undefined,
  };
}

/**
 * Read the latest Codex usage from the rollout session files. Scans newest
 * rollout files first and returns the last rate_limits entry from the first
 * file that has one. Returns null if codex has never written one (no sessions
 * or no rate_limits yet).
 */
export function readCodexUsage(codexHome: string = join(homedir(), '.codex')): CodexUsage | null {
  const dir = sessionsDir(codexHome);
  if (!existsSync(dir)) return null;
  // Scan a bounded number of newest files so this stays cheap.
  for (const file of rolloutFilesNewestFirst(dir).slice(0, 40)) {
    let content: string;
    try { content = readFileSync(file, 'utf-8'); } catch { continue; }
    if (!content.includes('rate_limits')) continue;
    // Last line carrying rate_limits = the most recent reading in that file.
    const lines = content.split('\n').filter((l) => l.includes('rate_limits'));
    for (let i = lines.length - 1; i >= 0; i--) {
      let parsed: unknown;
      try { parsed = JSON.parse(lines[i]); } catch { continue; }
      const rl = findRateLimits(parsed);
      if (!rl) continue;
      const asOf = (() => {
        try { return new Date(statSync(file).mtimeMs).toISOString(); } catch { return new Date(0).toISOString(); }
      })();
      return {
        primary: toWindow(rl.primary),
        secondary: toWindow(rl.secondary),
        plan_type: typeof rl.plan_type === 'string' ? rl.plan_type : undefined,
        rate_limit_reached: rl.rate_limit_reached_type != null,
        as_of: asOf,
      };
    }
  }
  return null;
}
