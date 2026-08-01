import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, statSync, symlinkSync, readFileSync, lstatSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { shredFile } from '../../../src/utils/shred.js';

describe('shredFile', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shred-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes an existing token-bearing file (verify-gone)', () => {
    const p = join(dir, '.env.bak');
    writeFileSync(p, 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-secret\n');
    expect(existsSync(p)).toBe(true);
    shredFile(p);
    expect(existsSync(p)).toBe(false);
  });

  it('is idempotent when the file is already absent (no throw)', () => {
    const p = join(dir, 'nope');
    expect(existsSync(p)).toBe(false);
    expect(() => shredFile(p)).not.toThrow();
    expect(existsSync(p)).toBe(false);
  });

  it('handles an empty file (unlink without overwrite)', () => {
    const p = join(dir, 'empty');
    writeFileSync(p, '');
    expect(statSync(p).size).toBe(0);
    shredFile(p);
    expect(existsSync(p)).toBe(false);
  });

  it('overwrites before unlink (best-effort) and leaves nothing behind', () => {
    const p = join(dir, '.env.bak');
    writeFileSync(p, 'A'.repeat(4096));
    shredFile(p);
    expect(existsSync(p)).toBe(false);
  });

  it('Finding 3: does NOT overwrite through a symlink; removes the link, target intact', () => {
    // A symlink planted where a backup should be must not redirect the overwrite
    // to its target (O_NOFOLLOW). The link is removed; the target keeps its bytes.
    const target = join(dir, 'important-secret');
    const original = 'DO-NOT-OVERWRITE-ME'.repeat(64);
    writeFileSync(target, original);
    const link = join(dir, '.env.bak-planted');
    symlinkSync(target, link);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);

    shredFile(link);

    // the symlink reference is gone...
    expect(existsSync(link)).toBe(false);
    // ...but the target was NOT followed/overwritten - bytes unchanged.
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe(original);
  });
});
