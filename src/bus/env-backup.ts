import {
  copyFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync, renameSync,
} from 'fs';
import { join } from 'path';
import { shredFile } from '../utils/shred.js';

/**
 * Out-of-tree backup + rollback for safe agent `.env` edits (the fail-closed
 * safety net for set-agent-env). Backups live under `CTX_ROOT/state/<agent>/
 * env-backups/` - `CTX_ROOT` is `~/.cortextos/<instance>/`, ENTIRELY outside the
 * git repo, so a token-bearing backup can never ride into git. They are
 * ephemeral: shredded within seconds of a verified-successful edit OR a rollback.
 *
 * These are the security-sensitive "data-loss / live-token-on-disk" pieces
 * (author-owned; reviewed line-by-line), kept separate from the command/parse
 * scaffolding.
 */

/** Out-of-tree backup directory for an agent (under CTX_ROOT/state, not orgs/). */
export function envBackupDir(ctxRoot: string, agent: string): string {
  return join(ctxRoot, 'state', agent, 'env-backups');
}

/**
 * Copy an agent `.env` to an out-of-tree 0600 backup BEFORE any edit, and verify
 * the copy is byte-identical to the source. Returns the backup path.
 *
 * FAIL-CLOSED: throws if the backup cannot be created or is not byte-identical -
 * no safe rollback path means the caller MUST abort before touching `.env`.
 * `ts` is supplied by the caller (keeps this deterministic + unit-testable).
 */
export function backupEnv(ctxRoot: string, agent: string, envPath: string, ts: string): string {
  const dir = envBackupDir(ctxRoot, agent);
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const backupPath = join(dir, `.env.${ts}`);
  copyFileSync(envPath, backupPath);
  chmodSync(backupPath, 0o600);

  // Verify byte-identical; a partial/failed copy is not a valid rollback source.
  if (readFileSync(backupPath).compare(readFileSync(envPath)) !== 0) {
    try { shredFile(backupPath); } catch { /* best-effort cleanup of the bad copy */ }
    throw new Error('backupEnv: backup is not byte-identical to source .env; aborting edit');
  }

  return backupPath;
}

/**
 * Restore `.env` from its out-of-tree backup after a failed edit, so the agent is
 * never left with a broken/half-written `.env`. Atomic (temp + rename), re-chmod
 * 0600, and verify the restored file is byte-identical to the backup.
 *
 * The caller shreds the backup AFTER a verified rollback (restored `.env` ==
 * backup, so nothing is lost).
 *
 * @throws if the restore is not byte-identical to the backup (a failed rollback
 *         must be loud, never silent).
 */
export function rollbackEnv(envPath: string, backupPath: string): void {
  const data = readFileSync(backupPath);
  const tmp = `${envPath}.rollback-tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, envPath);
  chmodSync(envPath, 0o600);

  if (readFileSync(envPath).compare(data) !== 0) {
    throw new Error('rollbackEnv: restored .env does not match backup');
  }
}
