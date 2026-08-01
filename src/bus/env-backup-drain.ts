import { existsSync, readdirSync, statSync } from 'fs';
import { basename, join } from 'path';
import { shredFile, shredAtRestStatus, type ShredAtRestStatus } from '../utils/shred.js';

/**
 * Part B (immediate pile-drain) of the safe .env-edit deliverable: a one-shot
 * finder+shredder for the stray `.env*bak*` backups that manual auth-refreshes
 * leave behind. Part A (set-agent-env) prevents recurrence; this drains the
 * pile that already exists.
 *
 * FAIL-SAFE toward KEEPING a file: the only things ever shredded are names that
 * positively match the `.env*bak*` backup shape (`.env`-prefixed AND containing
 * "bak"). A live `.env` cannot match (it has no "bak"); `.env.example` is
 * excluded explicitly. Any doubt -> not matched -> not touched.
 *
 * LEAK-SAFE: never reads file contents (shredFile operates on the path only);
 * only file PATHS are surfaced, never a token VALUE.
 */

/**
 * True iff `name` is a stray env-backup that is safe to shred. Matches the whole
 * `.env*bak*` family - `.env.bak`, `.env.bak-<timestamp>` (both the
 * `.env.bak-20260627T175922Z` and `.env.bak-2026-06-27T18-16-40-963Z` forms),
 * `.env.pre-icloud.bak`, `.env.backup` - and NEVER a live `.env` or the example
 * template.
 */
export function isEnvBackupName(name: string): boolean {
  if (name === '.env' || name === '.env.example') return false;
  // `.env`-prefixed and containing "bak" somewhere after it. A live `.env` has
  // no "bak" so it can never match; this is the fail-safe-toward-keeping guard.
  return /^\.env.*bak/i.test(name);
}

/**
 * Enumerate stray env-backup files across the agent/org `.env` locations under
 * `<frameworkRoot>/orgs/`: each `orgs/<org>/` root (org-level secrets backups)
 * and each `orgs/<org>/agents/<agent>/` dir (per-agent `.env` backups). Bounded,
 * non-recursive within each dir - the pile lives beside the `.env` files, and a
 * targeted scan cannot wander into unrelated trees. Paths are returned sorted for
 * deterministic output.
 */
export function findEnvBackups(frameworkRoot: string): string[] {
  const found: string[] = [];
  const orgsDir = join(frameworkRoot, 'orgs');
  if (!isDir(orgsDir)) return found;

  for (const org of safeReaddir(orgsDir)) {
    const orgPath = join(orgsDir, org);
    if (!isDir(orgPath)) continue;
    collectBackupsIn(orgPath, found);

    const agentsDir = join(orgPath, 'agents');
    if (!isDir(agentsDir)) continue;
    for (const agent of safeReaddir(agentsDir)) {
      const agentPath = join(agentsDir, agent);
      if (!isDir(agentPath)) continue;
      collectBackupsIn(agentPath, found);
    }
  }

  return found.sort();
}

export interface DrainResult {
  /** All files identified as stray env-backups (the shred candidates). */
  matched: string[];
  /** Paths actually shredded (empty on a dry run). */
  shredded: string[];
  /** Candidates whose shred threw, with the leak-safe error message. */
  failed: { path: string; error: string }[];
  dryRun: boolean;
  /** FileVault at-rest status at drain time - a drift/portability signal, not a gate. */
  atRest: ShredAtRestStatus;
}

/**
 * Find and shred every stray `.env*bak*` backup under `<frameworkRoot>/orgs/`.
 * A failing shred on one file is recorded and does not stop the others (drain as
 * much of the pile as possible), and a survivor is a hard failure inside
 * shredFile, so a silent no-op is impossible.
 */
export function drainEnvBackups(opts: { frameworkRoot: string; dryRun?: boolean }): DrainResult {
  const atRest = shredAtRestStatus();
  const dryRun = !!opts.dryRun;
  const matched = findEnvBackups(opts.frameworkRoot);
  const shredded: string[] = [];
  const failed: { path: string; error: string }[] = [];

  for (const path of matched) {
    // Defensive re-check at shred time - never trust the collector alone to have
    // filtered a live `.env`.
    if (!isEnvBackupName(basename(path))) continue;
    if (dryRun) continue;
    try {
      shredFile(path);
      shredded.push(path);
    } catch (err) {
      failed.push({ path, error: (err as Error).message });
    }
  }

  return { matched, shredded, failed, dryRun, atRest };
}

function collectBackupsIn(dir: string, out: string[]): void {
  for (const name of safeReaddir(dir)) {
    if (!isEnvBackupName(name)) continue;
    const full = join(dir, name);
    if (isFile(full)) out.push(full);
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
