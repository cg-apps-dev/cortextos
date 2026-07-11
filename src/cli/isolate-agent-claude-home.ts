import { Command } from 'commander';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import { resolveEnv } from '../utils/env.js';
import { validateAgentName } from '../utils/validate.js';
import { atomicWriteSync } from '../utils/atomic.js';

interface IsolateOptions {
  instance?: string;
  dryRun?: boolean;
  json?: boolean;
  revert?: boolean;
  sourceClaudeHome?: string;
}

export interface IsolationResult {
  agent: string;
  claudeConfigDir: string;
  projectDir: string;
  migrated: string[];
  envUpdated: boolean;
  dryRun: boolean;
  reverted?: boolean;
}

export const isolateAgentClaudeHomeCommand = new Command('isolate-agent-claude-home')
  .argument('<agent>', 'Agent name to isolate onto a per-agent Claude config home')
  .option('--instance <id>', 'Instance ID')
  .option('--source-claude-home <path>', 'Source Claude home to copy from (default: ~/.claude)')
  .option('--dry-run', 'Show what would change without writing files')
  .option('--revert', 'Remove CLAUDE_CONFIG_DIR from the agent .env without deleting the isolated home')
  .option('--json', 'Output JSON')
  .description('Prepare state/<agent>/claude-home and set CLAUDE_CONFIG_DIR for a single agent')
  .action((agent: string, opts: IsolateOptions) => {
    try {
      const result = isolateAgentClaudeHome(agent, opts);
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else printResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
      else console.error(`FAILED: ${message}`);
      process.exit(1);
    }
  });

export function isolateAgentClaudeHome(agent: string, opts: IsolateOptions = {}): IsolationResult {
  validateAgentName(agent);
  const env = resolveEnv({ instanceId: opts.instance });
  if (!env.frameworkRoot) throw new Error('CTX_FRAMEWORK_ROOT is required');
  if (!env.org) throw new Error('CTX_ORG is required');

  const agentDir = join(env.frameworkRoot, 'orgs', env.org, 'agents', agent);
  if (!existsSync(agentDir) || !statSync(agentDir).isDirectory()) throw new Error(`agent not found: ${agent}`);
  const envPath = join(agentDir, '.env');
  if (!existsSync(envPath)) throw new Error(`agent .env not found: ${envPath}`);

  const claudeConfigDir = join(env.ctxRoot, 'state', agent, 'claude-home');
  const sourceClaudeHome = opts.sourceClaudeHome ?? join(homeDir(), '.claude');
  const config = readAgentConfig(agentDir);
  const workingDirectory = typeof config.working_directory === 'string' && config.working_directory
    ? config.working_directory
    : agentDir;
  const projectDir = claudeProjectDirName(workingDirectory);

  if (opts.revert) {
    if (!opts.dryRun) {
      const next = setEnvValue(readFileSync(envPath, 'utf-8'), 'CLAUDE_CONFIG_DIR', undefined);
      atomicWriteSync(envPath, next);
      chmodSync(envPath, 0o600);
    }
    return { agent, claudeConfigDir, projectDir, migrated: [], envUpdated: !opts.dryRun, dryRun: Boolean(opts.dryRun), reverted: true };
  }

  const migrated = migrationPlan(sourceClaudeHome, projectDir);
  if (!opts.dryRun) {
    prepareClaudeHome(sourceClaudeHome, claudeConfigDir, projectDir);
    const next = setEnvValue(readFileSync(envPath, 'utf-8'), 'CLAUDE_CONFIG_DIR', claudeConfigDir);
    atomicWriteSync(envPath, next);
    chmodSync(envPath, 0o600);
    const reread = parseEnv(readFileSync(envPath, 'utf-8'));
    if (reread.CLAUDE_CONFIG_DIR !== claudeConfigDir) throw new Error('CLAUDE_CONFIG_DIR write verification failed');
  }

  return { agent, claudeConfigDir, projectDir, migrated, envUpdated: !opts.dryRun, dryRun: Boolean(opts.dryRun) };
}

export function claudeProjectDirName(workingDirectory: string): string {
  return workingDirectory.replace(/[^A-Za-z0-9._-]/g, '-');
}

function prepareClaudeHome(sourceClaudeHome: string, targetHome: string, projectDir: string): void {
  mkdirSync(targetHome, { recursive: true, mode: 0o700 });
  chmodSync(targetHome, 0o700);

  for (const item of migrationPlan(sourceClaudeHome, projectDir)) {
    const src = join(sourceClaudeHome, item);
    const dest = join(targetHome, item);
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    cpSync(src, dest, {
      recursive: true,
      force: true,
      errorOnExist: false,
      filter: (path) => basename(path) !== '.credentials.json',
    });
  }

  rmSync(join(targetHome, '.credentials.json'), { force: true });
  chmodRecursive(targetHome);
}

function migrationPlan(sourceClaudeHome: string, projectDir: string): string[] {
  const candidates = [
    'settings.json',
    'history.jsonl',
    'policy-limits.json',
    'remote-settings.json',
    'mcp-needs-auth-cache.json',
    'sessions',
    'session-env',
    join('projects', projectDir),
  ];
  return candidates.filter((item) => existsSync(join(sourceClaudeHome, item)));
}

function setEnvValue(content: string, key: string, value: string | undefined): string {
  const lines = content.split(/\r?\n/);
  let seen = false;
  const next: string[] = [];
  for (const line of lines) {
    if (line.startsWith(`${key}=`)) {
      if (!seen && value !== undefined) next.push(`${key}=${value}`);
      seen = true;
      continue;
    }
    next.push(line);
  }
  if (!seen && value !== undefined) {
    while (next.length > 0 && next[next.length - 1] === '') next.pop();
    next.push(`${key}=${value}`);
    next.push('');
  }
  return next.join('\n').replace(/\n*$/, '\n');
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function readAgentConfig(agentDir: string): Record<string, unknown> {
  const configPath = join(agentDir, 'config.json');
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
}

function chmodRecursive(path: string): void {
  try {
    const stat = statSync(path);
    chmodSync(path, stat.isDirectory() ? 0o700 : 0o600);
    if (stat.isDirectory()) {
      for (const child of require('fs').readdirSync(path)) {
        chmodRecursive(join(path, child));
      }
    }
  } catch {
    // Best effort permissions normalization; copy/write failures still throw.
  }
}

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || '';
}

function printResult(result: IsolationResult): void {
  console.log(`${result.reverted ? 'REVERTED' : result.dryRun ? 'DRY RUN' : 'ISOLATED'}: ${result.agent}`);
  console.log(`CLAUDE_CONFIG_DIR=${result.claudeConfigDir}`);
  console.log(`project=${result.projectDir}`);
  if (result.migrated.length > 0) console.log(`migrated: ${result.migrated.join(', ')}`);
  console.log('No .credentials.json is written to the isolated home.');
}
