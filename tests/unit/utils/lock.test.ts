import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { acquireLock, releaseLock, withFileLockSync } from '../../../src/utils/lock';

describe('mkdir-based locking', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'cortextos-lock-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('acquires lock on empty directory', () => {
    expect(acquireLock(testDir)).toBe(true);
    releaseLock(testDir);
  });

  it('prevents double acquire', () => {
    expect(acquireLock(testDir)).toBe(true);
    // Same process, same PID - should fail since lock.d already exists
    // (but our PID check will see it's our own process and succeed)
    // Actually, mkdir will fail because it already exists, then we check PID
    // Since it's our own PID, it sees process alive and returns false
    expect(acquireLock(testDir)).toBe(false);
    releaseLock(testDir);
  });

  it('releases lock correctly', () => {
    expect(acquireLock(testDir)).toBe(true);
    releaseLock(testDir);
    expect(acquireLock(testDir)).toBe(true);
    releaseLock(testDir);
  });
});

describe('orphaned lock recovery (holder died mid-acquire)', () => {
  let testDir: string;
  let lockDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'cortextos-lock-test-'));
    lockDir = join(testDir, '.lock.d');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  /** Backdate the lock dir mtime past the 60s staleness threshold. */
  function ageLockDir(): void {
    const past = (Date.now() - 120_000) / 1000;
    utimesSync(lockDir, past, past);
  }

  it('steals an AGED pid-less orphan (holder died between mkdir and pid write)', () => {
    mkdirSync(lockDir);
    ageLockDir();
    expect(acquireLock(testDir)).toBe(true);
    // Steal is complete: the lock now carries OUR pid, so the normal
    // dead/alive check governs it again.
    expect(readFileSync(join(lockDir, 'pid'), 'utf-8').trim()).toBe(String(process.pid));
    releaseLock(testDir);
  });

  it('refuses a FRESH pid-less lock (mid-acquire protection preserved)', () => {
    // A just-created pid-less lock is a holder between mkdir and
    // writeFileSync. Stealing here is the iter-12 double-acquire race;
    // the age gate must NOT fire.
    mkdirSync(lockDir);
    expect(acquireLock(testDir)).toBe(false);
  });

  it('steals an AGED corrupt-pid lock (garbage pid never becomes probeable)', () => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'pid'), 'not-a-pid');
    ageLockDir();
    expect(acquireLock(testDir)).toBe(true);
    expect(readFileSync(join(lockDir, 'pid'), 'utf-8').trim()).toBe(String(process.pid));
    releaseLock(testDir);
  });

  it('refuses a FRESH corrupt-pid lock (may still be mid-write)', () => {
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'pid'), '');
    expect(acquireLock(testDir)).toBe(false);
  });

  it('withFileLockSync recovers through an aged orphan instead of timing out', () => {
    // The prod wedge: checkInbox's lock wrapper failing on every poll
    // against a pid-less .lock.d. With the age escape it must acquire
    // and run the critical section.
    mkdirSync(lockDir);
    ageLockDir();
    const result = withFileLockSync(testDir, () => 42, { timeoutMs: 2_000 });
    expect(result).toBe(42);
  });
});
