import { execFileSync } from 'child_process';

/**
 * Thin, safe git helpers for the dev-worktree tooling.
 *
 * Uses execFileSync (not execSync) so arguments are passed as an argv array —
 * no shell, no interpolation, no injection from ticket/branch names.
 */

export interface GitWorktree {
  path: string;
  head: string;
  branch: string | null; // null when detached
}

/** Run a git command and return trimmed stdout. Throws on non-zero exit. */
export function git(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  }).trim();
}

/** True if `cwd` is inside a git work tree. */
export function isGitRepo(cwd: string): boolean {
  try {
    return git(['rev-parse', '--is-inside-work-tree'], cwd) === 'true';
  } catch {
    return false;
  }
}

/** Absolute path of the repository root for `cwd`. */
export function getRepoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

/** Current branch name, or null if HEAD is detached. */
export function currentBranch(cwd: string): string | null {
  const ref = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  return ref === 'HEAD' ? null : ref;
}

/** True if a local branch with this name exists. */
export function branchExists(branch: string, cwd: string): boolean {
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a git worktree at `worktreePath`.
 * - If `branch` already exists, check it out into the new worktree.
 * - Otherwise create it from `base`.
 */
export function addWorktree(
  worktreePath: string,
  branch: string,
  base: string,
  cwd: string,
): void {
  if (branchExists(branch, cwd)) {
    git(['worktree', 'add', worktreePath, branch], cwd);
  } else {
    git(['worktree', 'add', '-b', branch, worktreePath, base], cwd);
  }
}

/** Parse `git worktree list --porcelain` into structured entries. */
export function listWorktrees(cwd: string): GitWorktree[] {
  const out = git(['worktree', 'list', '--porcelain'], cwd);
  const worktrees: GitWorktree[] = [];
  let cur: Partial<GitWorktree> = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur.path) worktrees.push(finalizeWorktree(cur));
      cur = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      // e.g. "branch refs/heads/main" → "main"
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      cur.branch = null;
    }
  }
  if (cur.path) worktrees.push(finalizeWorktree(cur));
  return worktrees;
}

function finalizeWorktree(cur: Partial<GitWorktree>): GitWorktree {
  return {
    path: cur.path!,
    head: cur.head ?? '',
    branch: cur.branch ?? null,
  };
}
