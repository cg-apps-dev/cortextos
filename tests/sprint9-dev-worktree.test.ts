import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createServer, type Server } from 'net';

import {
  isGitRepo,
  getRepoRoot,
  currentBranch,
  branchExists,
  addWorktree,
  listWorktrees,
} from '../src/utils/git.js';
import { isPortFree, findFreePort } from '../src/utils/ports.js';
import { slugify } from '../src/cli/dev-worktree.js';

describe('Sprint 9: dev-worktree isolation tooling', () => {
  // -------------------------------------------------------------------------
  // ports util
  // -------------------------------------------------------------------------
  describe('ports', () => {
    let server: Server | null = null;
    afterEach(() => {
      if (server) { server.close(); server = null; }
    });

    it('reports a free port as free and a bound port as not free', async () => {
      const free = await findFreePort(34000);
      expect(await isPortFree(free)).toBe(true);

      // Bind it, then it must report not-free.
      server = createServer();
      await new Promise<void>((resolve) => server!.listen(free, '127.0.0.1', resolve));
      expect(await isPortFree(free)).toBe(false);
    });

    it('findFreePort skips a bound port and returns a later one', async () => {
      const start = 34100;
      server = createServer();
      await new Promise<void>((resolve) => server!.listen(start, '127.0.0.1', resolve));

      const picked = await findFreePort(start);
      expect(picked).toBeGreaterThan(start);
      expect(await isPortFree(picked)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // slugify
  // -------------------------------------------------------------------------
  describe('slugify', () => {
    it('lowercases and collapses unsafe characters', () => {
      expect(slugify('Comms Fix!')).toBe('comms-fix');
      expect(slugify('FEAT: My Thing  ')).toBe('feat-my-thing');
    });
    it('preserves slashes, dots, and dashes', () => {
      expect(slugify('fix/comms-v1.2')).toBe('fix/comms-v1.2');
    });
    it('trims leading/trailing separators', () => {
      expect(slugify('--/weird/--')).toBe('weird');
    });
  });

  // -------------------------------------------------------------------------
  // git util — real temp repo + worktrees
  // -------------------------------------------------------------------------
  describe('git helpers', () => {
    const repo = join(tmpdir(), `cortextos-sprint9-${Date.now()}`);

    beforeEach(() => {
      mkdirSync(repo, { recursive: true });
      // Deterministic main-branch repo with one commit.
      execFileSync('git', ['init', '-b', 'main'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
      writeFileSync(join(repo, 'README.md'), '# test\n');
      execFileSync('git', ['add', '.'], { cwd: repo });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: repo });
    });

    afterEach(() => {
      try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ }
      try { rmSync(`${repo}-wt`, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('detects a git repo and resolves its root + branch', () => {
      expect(isGitRepo(repo)).toBe(true);
      // realpath: macOS tmpdir may be symlinked (/var → /private/var).
      expect(existsSync(getRepoRoot(repo))).toBe(true);
      expect(currentBranch(repo)).toBe('main');
    });

    it('reports a non-repo path as not a git repo', () => {
      const notRepo = join(tmpdir(), `cortextos-sprint9-norepo-${Date.now()}`);
      mkdirSync(notRepo, { recursive: true });
      try {
        expect(isGitRepo(notRepo)).toBe(false);
      } finally {
        rmSync(notRepo, { recursive: true, force: true });
      }
    });

    it('creates a worktree on a NEW branch off the base', () => {
      const wtPath = `${repo}-wt`;
      expect(branchExists('feat/x', repo)).toBe(false);

      addWorktree(wtPath, 'feat/x', 'main', repo);

      expect(existsSync(wtPath)).toBe(true);
      expect(branchExists('feat/x', repo)).toBe(true);
      expect(currentBranch(wtPath)).toBe('feat/x');

      // The new worktree shows up in the porcelain listing; main is first.
      const list = listWorktrees(repo);
      expect(list.length).toBe(2);
      expect(list[0].branch).toBe('main');
      const branches = list.map(w => w.branch);
      expect(branches).toContain('feat/x');
    });

    it('checks out an EXISTING branch into a worktree (no -b)', () => {
      execFileSync('git', ['branch', 'feat/existing'], { cwd: repo });
      expect(branchExists('feat/existing', repo)).toBe(true);

      const wtPath = `${repo}-wt`;
      addWorktree(wtPath, 'feat/existing', 'main', repo);
      expect(currentBranch(wtPath)).toBe('feat/existing');
    });
  });
});
