import { openSync, fsyncSync, closeSync, unlinkSync, existsSync, statSync, writeSync, constants } from 'fs';
import { randomBytes } from 'crypto';
import { execFileSync } from 'child_process';

/**
 * Remove a token-bearing file: overwrite its bytes with random data TWICE (fsync
 * between passes), unlink, then VERIFY the file is gone.
 *
 * SCOPED CLAIM (three tiers - do NOT overstate this as "securely wiped"). What
 * "protection" means here is threat-model-dependent, and the honest guarantee is
 * narrow:
 *
 *   1. OFFLINE DISK IMAGING (stolen / powered-off disk) - the freed blocks are
 *      unreadable WITHOUT the FileVault key. This is the real at-rest guarantee,
 *      and it comes from FileVault + the unlink, NOT from the overwrite. It holds
 *      only while FileVault is On (see shredAtRestStatus below).
 *   2. LIVE, UNLOCKED BOX (same-user attacker while the machine is running, which
 *      this 24/7 host is) - at-rest encryption does NOT protect freed blocks or
 *      live plaintext. The only mitigation is minimizing how long the secret
 *      exists in plaintext: out-of-tree temp, 0600, verify-then-immediately-rm.
 *      That is env-backup.ts's job (short-lived backups), NOT this primitive's.
 *   3. IN-PLACE BYTE OVERWRITE (the dd/urandom-x2 convention below) - portable
 *      defense-in-depth for non-APFS / non-FileVault hosts. On APFS + SSD it
 *      claims NOTHING: copy-on-write writes NEW blocks and wear-leveling relocates
 *      writes, so the original secret blocks can persist regardless. It is kept
 *      because it costs little and helps a portable/non-APFS host; it is NOT the
 *      property, and a reader must not mistake it for one.
 *
 * So the load-bearing protections are (a) FileVault-at-rest + (b) the unlink
 * removing the reference + (c) callers keeping the plaintext short-lived and
 * out-of-repo. A true erasure guarantee against every threat would require
 * rotating the secret; the callers' threat model (files already 0600 +
 * out-of-repo + backup-excluded, same-user at-rest) does not warrant that.
 *
 * LEAK-SAFE: never reads or logs the file's contents; operates on the path only
 * and emits no output (callers log path + outcome, never bytes).
 *
 * Shared audited primitive: used by set-agent-env on verified-success AND by the
 * existing-`.env.bak` pile-drain (drainEnvBackups) - ONE tested implementation,
 * no divergent shred code.
 *
 * @throws if the file still exists after unlink (a failed removal must be loud,
 *         never swallowed - removal is the actual protection).
 */
export function shredFile(path: string): void {
  // Idempotent: nothing to remove. (A survivor is only a failure AFTER we try.)
  if (!existsSync(path)) return;

  // Best-effort overwrite BEFORE unlink. A failure here is non-fatal (the unlink
  // below is the real protection) but must NOT skip the unlink. Kept silent so
  // no file/path content can ever reach a log path. Tier 3 above: portable
  // defense-in-depth only, claims nothing on APFS+SSD.
  try {
    const size = statSync(path).size;
    if (size > 0) {
      // O_NOFOLLOW: never write THROUGH a symlink. If a symlink were planted at
      // this path (e.g. a `.env*bak*`-named link the drain discovers), following
      // it would send random bytes to its target. O_NOFOLLOW makes the open throw
      // (ELOOP) atomically instead - caught below, and the unlink then removes the
      // link itself, not the target. TOCTOU-safe vs an lstat-then-open check.
      const fd = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        for (let pass = 0; pass < 2; pass++) {
          const buf = randomBytes(size);
          let offset = 0;
          while (offset < size) {
            offset += writeSync(fd, buf, offset, size - offset, offset);
          }
          fsyncSync(fd);
        }
      } finally {
        closeSync(fd);
      }
    }
  } catch {
    // Overwrite failed (e.g. permissions) - fall through to the unlink, which is
    // the actual protection. Best-effort overwrite is defense-in-depth only.
  }

  unlinkSync(path);

  // VERIFY-GONE: removal is the real protection, so a survivor is a hard failure.
  if (existsSync(path)) {
    throw new Error(`shredFile: file still present after unlink: ${path}`);
  }
}

export interface ShredAtRestStatus {
  /** True ONLY when FileVault-On was positively confirmed. Absence-of-proof reads false. */
  fileVaultProtected: boolean;
  /** Leak-safe human-readable detail (no paths, no file contents). */
  detail: string;
}

/**
 * Best-effort check of whether freed blocks are protected AT REST by FileVault
 * (tier 1 above). This is a fail-LOUD DRIFT/PORTABILITY guard, NOT a gate on
 * shredFile: the unlink still removes the reference regardless of the result, so
 * callers must WARN (never abort) when this returns not-protected. It exists so a
 * FileVault-off box or a non-macOS host cannot silently downgrade the shred's
 * at-rest guarantee to nothing - the weakening must be surfaced, not swallowed.
 *
 * Positively-confirmed-only: any ambiguity (non-macOS, fdesetup missing, parse
 * failure, timeout) returns fileVaultProtected=false. Absence of proof is not
 * proof of protection. Never throws; never logs secrets.
 */
export function shredAtRestStatus(): ShredAtRestStatus {
  if (process.platform !== 'darwin') {
    return { fileVaultProtected: false, detail: `non-macOS host (${process.platform}); FileVault at-rest guarantee N/A` };
  }
  try {
    // `fdesetup status` prints "FileVault is On." / "FileVault is Off." on the
    // boot data volume. On Apple Silicon a "Encrypted: No" on a per-volume line
    // is EXPECTED (hardware-encrypted SSD; FileVault wraps the key) and is not a
    // gap - the authoritative signal is the top-level "FileVault is On." line.
    const out = execFileSync('/usr/bin/fdesetup', ['status'], { encoding: 'utf-8', timeout: 5000 });
    if (/FileVault is On\b/i.test(out)) {
      return { fileVaultProtected: true, detail: 'FileVault On (freed blocks protected at rest against offline disk imaging)' };
    }
    return { fileVaultProtected: false, detail: 'FileVault Off (shred overwrite is APFS-theater; no at-rest protection for freed blocks)' };
  } catch {
    return { fileVaultProtected: false, detail: 'fdesetup status unavailable (cannot confirm FileVault; treating at-rest protection as unconfirmed)' };
  }
}
