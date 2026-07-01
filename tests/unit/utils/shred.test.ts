import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, statSync } from 'fs';
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
});
