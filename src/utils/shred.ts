import { openSync, fsyncSync, closeSync, unlinkSync, existsSync, statSync, writeSync } from 'fs';
import { randomBytes } from 'crypto';

/**
 * Best-effort removal of a token-bearing file: overwrite its bytes with random
 * data TWICE (fsync between passes) then unlink, and VERIFY the file is gone.
 *
 * HONEST CLAIM: this "removes + best-effort overwrites". It is NOT a guaranteed
 * secure wipe. On APFS/SSD, copy-on-write + wear-leveling mean the original
 * blocks can persist regardless of an in-place overwrite - so the REAL
 * protection is the unlink (removing the reference) plus the file living
 * out-of-repo at 0600; the overwrite is defense-in-depth and matches the
 * `dd if=/dev/urandom x2 + rm` convention. A true erasure guarantee would
 * require rotating the secret, which the callers' threat model (files already
 * 0600 + gitignored/out-of-repo + backup-excluded, same-user at-rest) does not
 * warrant.
 *
 * LEAK-SAFE: never reads or logs the file's contents; operates on the path only
 * and emits no output (callers log path + outcome, never bytes).
 *
 * Shared audited primitive: used by set-agent-env on verified-success AND by the
 * security agent for the Adam-gated existing `.env.bak` cleanup - ONE tested
 * implementation, no divergent shred code.
 *
 * @throws if the file still exists after unlink (a failed removal must be loud,
 *         never swallowed - removal is the actual protection).
 */
export function shredFile(path: string): void {
  // Idempotent: nothing to remove. (A survivor is only a failure AFTER we try.)
  if (!existsSync(path)) return;

  // Best-effort overwrite BEFORE unlink. A failure here is non-fatal (the unlink
  // below is the real protection) but must NOT skip the unlink. Kept silent so
  // no file/path content can ever reach a log path.
  try {
    const size = statSync(path).size;
    if (size > 0) {
      const fd = openSync(path, 'r+');
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
