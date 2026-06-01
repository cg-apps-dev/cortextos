import { Command } from 'commander';
import { join, dirname, basename } from 'path';
import { existsSync } from 'fs';
import {
  isGitRepo,
  addWorktree,
  currentBranch,
  listWorktrees,
} from '../utils/git.js';
import { findFreePort } from '../utils/ports.js';

/**
 * Derive a safe slug (branch + directory name) from a ticket string.
 * Keeps lowercase alphanumerics, dots, slashes, dashes; collapses the rest.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '');
}

/**
 * The served (:3000) tree is always the MAIN worktree — the first entry of
 * `git worktree list`. Anchoring paths to it (not to `cwd`) keeps new worktrees
 * clustered next to the primary checkout even when this command is itself run
 * from inside another worktree.
 */
function mainWorktreeRoot(cwd: string): string {
  const list = listWorktrees(cwd);
  return list.length > 0 ? list[0].path : cwd;
}

export const devWorktreeCommand = new Command('dev-worktree')
  .argument('<ticket>', 'Ticket slug — used for the branch name and worktree directory')
  .option('--base <branch>', 'Base branch to fork from', 'main')
  .option('--branch <name>', 'Explicit branch name (default: <prefix>/<ticket>)')
  .option('--prefix <type>', 'Branch type prefix when deriving (e.g. fix, feat)', 'feat')
  .option('--agent <name>', 'Owning agent (default: $CTX_AGENT_NAME)')
  .option('--port <port>', 'Pin a preview port instead of auto-selecting')
  .description('Create an isolated git worktree + preview port for a dashboard/framework ticket')
  .action(async (ticket: string, options: {
    base: string; branch?: string; prefix: string; agent?: string; port?: string;
  }) => {
    const cwd = process.cwd();
    if (!isGitRepo(cwd)) {
      console.error('Not inside a git repository. Run from the cortextOS repo (or a worktree of it).');
      process.exit(1);
    }

    const ticketSlug = slugify(ticket);
    if (!ticketSlug) {
      console.error(`Invalid ticket "${ticket}" — nothing usable after slugifying.`);
      process.exit(1);
    }

    const agent = options.agent || process.env.CTX_AGENT_NAME || 'agent';
    const branch = options.branch || `${options.prefix}/${ticketSlug}`;

    if (branch === options.base) {
      console.error(`Refusing to create a worktree for the base branch '${options.base}'. Pick a feature branch.`);
      process.exit(1);
    }

    // Worktree lives OUTSIDE the served tree: <repoParent>/<repo>-worktrees/<agent>/<ticket>
    const repoRoot = mainWorktreeRoot(cwd);
    const worktreePath = join(
      dirname(repoRoot),
      `${basename(repoRoot)}-worktrees`,
      agent,
      ticketSlug,
    );

    if (existsSync(worktreePath)) {
      console.error(`Worktree path already exists: ${worktreePath}`);
      process.exit(1);
    }

    // Preview port (isolated `next dev`), so a feature can be previewed pre-merge
    // without disturbing the served :3000 view.
    let port: number;
    if (options.port) {
      port = parseInt(options.port, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        console.error(`Invalid --port: ${options.port}`);
        process.exit(1);
      }
    } else {
      try {
        port = await findFreePort(3001);
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
    }

    try {
      addWorktree(worktreePath, branch, options.base, cwd);
    } catch (err) {
      console.error(`Failed to create worktree: ${(err as Error).message}`);
      process.exit(1);
    }

    console.log('\n  Worktree ready (isolated from the served :3000 tree):');
    console.log(`    branch:   ${branch}  (base: ${options.base})`);
    console.log(`    path:     ${worktreePath}`);
    console.log(`    preview:  http://localhost:${port}`);
    console.log('\n  Next:');
    console.log(`    cd ${worktreePath}`);
    console.log(`    cortextos dashboard --port ${port}      # optional isolated preview`);
    console.log(`\n  The served :3000 tree stays on '${options.base}'. Ship by merging`);
    console.log(`  '${branch}' into ${options.base} after review — it lands on :3000 automatically.`);
    console.log('  When merged:');
    console.log(`    git worktree remove ${worktreePath}\n`);
  });

export const worktreeGuardCommand = new Command('worktree-guard')
  .option('--path <p>', 'Served-tree path to check (default: the main worktree)')
  .option('--expect <branch>', 'Branch the served tree must be on', 'main')
  .description('Warn if the served (:3000) tree has drifted off its expected branch')
  .action((options: { path?: string; expect: string }) => {
    const cwd = process.cwd();
    if (!isGitRepo(cwd)) {
      console.error('Not inside a git repository.');
      process.exit(2);
    }

    const servedPath = options.path || mainWorktreeRoot(cwd);
    const branch = currentBranch(servedPath);

    if (branch === options.expect) {
      console.log(`OK: served tree at ${servedPath} is on '${options.expect}'.`);
      process.exit(0);
    }

    const where = branch ?? '(detached HEAD)';
    console.error(`WARN: served tree at ${servedPath} is on '${where}', expected '${options.expect}'.`);
    console.error('The :3000 dashboard renders this tree. Feature work belongs in a worktree');
    console.error('(`cortextos dev-worktree <ticket>`), not the served tree. Return it to');
    console.error(`'${options.expect}' to restore the live view.`);
    process.exit(1);
  });
