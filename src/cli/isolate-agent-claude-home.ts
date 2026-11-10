import { Command } from 'commander';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from 'fs';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'path';
import { resolveEnv } from '../utils/env.js';
import { validateAgentName } from '../utils/validate.js';
import { atomicWriteSync } from '../utils/atomic.js';

export const CREDENTIAL_CLASS_CLAUDE_JSON_KEYS = [
  'oauthAccount',
  'claudeCodeFirstTokenDate',
  'overageCreditGrantCache',
  'claudeAiMcpEverConnected',
] as const;

const CREDENTIAL_CLASS_TOKENS = [
  'sk-ant-',
  'oauth-token',
  'access_token',
  'refresh_token',
] as const;

interface AllowedStdioMcpLauncher {
  name: 'triplewhale' | 'unrestrict' | 'admanage';
  entrypoint: string;
  root: string;
  envKeys: ReadonlySet<string>;
}

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

  const sourceClaudeHome = assertTrustedClaudeSource(
    opts.sourceClaudeHome ?? join(homeDir(), '.claude'),
    env.frameworkRoot,
  );
  const migrated = migrationPlan(sourceClaudeHome, projectDir);
  if (!opts.dryRun) {
    prepareClaudeHome(sourceClaudeHome, claudeConfigDir, projectDir, env.frameworkRoot);
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

function prepareClaudeHome(
  sourceClaudeHome: string,
  targetHome: string,
  projectDir: string,
  frameworkRoot: string,
): void {
  assertNoSymlinkComponents(targetHome);
  mkdirSync(targetHome, { recursive: true, mode: 0o700 });
  chmodSync(targetHome, 0o700);

  for (const item of migrationPlan(sourceClaudeHome, projectDir)) {
    if (item === '.claude.json') continue;
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

  seedClaudeJson(sourceClaudeHome, targetHome, frameworkRoot);
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
  const plan = candidates.filter((item) => existsSync(join(sourceClaudeHome, item)));
  if (existsSync(sourceClaudeJsonPath(sourceClaudeHome))) plan.push('.claude.json');
  return plan;
}

function seedClaudeJson(sourceClaudeHome: string, targetHome: string, frameworkRoot: string): void {
  const source = sourceClaudeJsonPath(sourceClaudeHome);
  if (!existsSync(source)) return;

  const config = JSON.parse(readFileSync(source, 'utf-8')) as Record<string, unknown>;
  const sourceStdioMcpNames = stdioMcpServerNames(config.mcpServers);
  for (const key of CREDENTIAL_CLASS_CLAUDE_JSON_KEYS) delete config[key];
  if (config.mcpServers !== undefined) config.mcpServers = stripBridgeMcpServers(config.mcpServers);
  assertStdioMcpServersSurvived(config.mcpServers, sourceStdioMcpNames);
  validateStdioMcpLaunchers(config.mcpServers, dirname(sourceClaudeHome), frameworkRoot);

  const target = join(targetHome, '.claude.json');
  const serialized = JSON.stringify(config, null, 2);
  assertNoCredentialClassData(serialized);
  atomicWriteSync(target, `${serialized}\n`);
  chmodSync(target, 0o600);
  assertIsolatedClaudeJsonInvariant(target);
}

function sourceClaudeJsonPath(sourceClaudeHome: string): string {
  return join(dirname(sourceClaudeHome), '.claude.json');
}

function stripBridgeMcpServers(mcpServers: unknown): unknown {
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) return mcpServers;
  const next: Record<string, unknown> = {};
  for (const [name, server] of Object.entries(mcpServers as Record<string, unknown>)) {
    if (isBridgeMcpServer(name, server)) continue;
    next[name] = server;
  }
  return next;
}

function isBridgeMcpServer(name: string, server: unknown): boolean {
  if (/^claude\.ai\b/i.test(name)) return true;
  if (!server || typeof server !== 'object' || Array.isArray(server)) return false;
  const record = server as Record<string, unknown>;
  return typeof record.type === 'string' && record.type.toLowerCase() === 'connector';
}

function stdioMcpServerNames(mcpServers: unknown): string[] {
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) return [];
  return Object.entries(mcpServers as Record<string, unknown>)
    .filter(([, server]) => {
      if (!server || typeof server !== 'object' || Array.isArray(server)) return false;
      const type = (server as Record<string, unknown>).type;
      return typeof type === 'string' && type.toLowerCase() === 'stdio';
    })
    .map(([name]) => name)
    .sort();
}

function assertStdioMcpServersSurvived(mcpServers: unknown, expectedNames: string[]): void {
  if (expectedNames.length === 0) return;
  const actual = new Set(stdioMcpServerNames(mcpServers));
  const missing = expectedNames.filter((name) => !actual.has(name));
  if (missing.length > 0) {
    throw new Error(`isolated .claude.json dropped stdio MCP server(s): ${missing.join(', ')}`);
  }
}

function validateStdioMcpLaunchers(
  mcpServers: unknown,
  operatorHome: string,
  frameworkRoot: string,
): void {
  if (!mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers)) return;

  for (const [serverName, server] of Object.entries(mcpServers as Record<string, unknown>)) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) continue;
    const record = server as Record<string, unknown>;
    if (typeof record.type !== 'string' || record.type.toLowerCase() !== 'stdio') continue;

    if (typeof record.command !== 'string' || record.command.length === 0) {
      throw new Error(`stdio MCP server ${JSON.stringify(serverName)} has no valid command`);
    }
    if (basename(record.command) !== 'node') {
      if (basename(record.command) === 'npx') {
        throw new Error(
          `stdio MCP server ${JSON.stringify(serverName)} uses npx; Adam-gated source normalization is required: ` +
          `set command to node and args[0] to the installed package entrypoint`,
        );
      }
      throw new Error(`stdio MCP server ${JSON.stringify(serverName)} must use the node launcher`);
    }
    assertTrustedNodeCommand(record.command, operatorHome, serverName);

    if (!Array.isArray(record.args) || record.args.length === 0 || !record.args.every((arg) => typeof arg === 'string')) {
      throw new Error(`stdio MCP server ${JSON.stringify(serverName)} has no valid args array`);
    }
    const entrypoint = record.args[0] as string;
    if (entrypoint.startsWith('-')) {
      throw new Error(`stdio MCP server ${JSON.stringify(serverName)} may not place a node option before its entrypoint`);
    }
    if (!isAbsolute(entrypoint)) {
      throw new Error(`stdio MCP server ${JSON.stringify(serverName)} entrypoint must be an absolute path`);
    }

    const launcher = allowedStdioMcpLauncher(entrypoint, operatorHome, frameworkRoot);
    if (!launcher) {
      throw new Error(`stdio MCP server ${JSON.stringify(serverName)} entrypoint is not allowlisted`);
    }

    if (record.env !== undefined && (!record.env || typeof record.env !== 'object' || Array.isArray(record.env))) {
      throw new Error(`stdio MCP server ${JSON.stringify(serverName)} has no valid env object`);
    }
    const env = (record.env ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(env)) {
      if (!launcher.envKeys.has(key)) {
        throw new Error(`stdio MCP server ${JSON.stringify(serverName)} env key ${JSON.stringify(key)} is not allowlisted`);
      }
      if (typeof value !== 'string') {
        throw new Error(`stdio MCP server ${JSON.stringify(serverName)} env value for ${JSON.stringify(key)} must be a string`);
      }
    }
  }
}

function allowedStdioMcpLauncher(
  entrypoint: string,
  operatorHome: string,
  frameworkRoot: string,
): AllowedStdioMcpLauncher | undefined {
  let canonicalEntrypoint: string;
  try {
    canonicalEntrypoint = realpathSync(entrypoint);
  } catch {
    return undefined;
  }

  const nodeModulesRoot = join(operatorHome, '.hermes', 'node', 'lib', 'node_modules');
  const candidates: AllowedStdioMcpLauncher[] = [
    {
      name: 'triplewhale',
      entrypoint: join(nodeModulesRoot, '@triplewhale', 'mcp-server-triplewhale', 'dist', 'index.js'),
      root: nodeModulesRoot,
      envKeys: new Set<string>(),
    },
    {
      name: 'unrestrict',
      entrypoint: join(nodeModulesRoot, '@zappush', 'mcp', 'dist', 'index.js'),
      root: nodeModulesRoot,
      envKeys: new Set(['ZAPPUSH_API_KEY']),
    },
    {
      name: 'admanage',
      entrypoint: join(frameworkRoot, 'dist', 'mcp', 'admanage.js'),
      root: join(frameworkRoot, 'dist', 'mcp'),
      envKeys: new Set<string>(),
    },
  ];

  return candidates.find((candidate) => {
    try {
      const canonicalRoot = realpathSync(candidate.root);
      const canonicalCandidate = realpathSync(candidate.entrypoint);
      return isPathWithin(canonicalCandidate, canonicalRoot) && canonicalEntrypoint === canonicalCandidate;
    } catch {
      return false;
    }
  });
}

function assertTrustedNodeCommand(command: string, operatorHome: string, serverName: string): void {
  if (command === 'node') return;
  if (!isAbsolute(command)) {
    throw new Error(`stdio MCP server ${JSON.stringify(serverName)} node command must be bare or absolute`);
  }

  let canonicalCommand: string;
  try {
    canonicalCommand = realpathSync(command);
  } catch {
    throw new Error(`stdio MCP server ${JSON.stringify(serverName)} node command does not resolve`);
  }
  const knownNodePaths = [
    join(operatorHome, '.hermes', 'node', 'bin', 'node'),
    join(operatorHome, '.local', 'bin', 'node'),
  ];
  const allowed = knownNodePaths.some((knownPath) => {
    try {
      return realpathSync(knownPath) === canonicalCommand;
    } catch {
      return false;
    }
  });
  if (!allowed) {
    throw new Error(`stdio MCP server ${JSON.stringify(serverName)} node command is outside trusted locations`);
  }
}

function assertNoCredentialClassData(serialized: string): void {
  for (const tokenClass of CREDENTIAL_CLASS_TOKENS) {
    if (serialized.includes(tokenClass)) {
      throw new Error(`isolated .claude.json contains credential-class token ${JSON.stringify(tokenClass)}`);
    }
  }
}

function assertTrustedClaudeSource(sourceClaudeHome: string, frameworkRoot: string): string {
  let canonicalSource: string;
  try {
    canonicalSource = realpathSync(sourceClaudeHome);
  } catch {
    throw new Error('source Claude home does not resolve');
  }
  const sourceStat = lstatSync(canonicalSource);
  if (!sourceStat.isDirectory()) throw new Error('source Claude home is not a directory');
  assertOwnedBySetupUser(canonicalSource, sourceStat.uid, 'source Claude home');
  assertNoWorldWritablePath(canonicalSource, 'source Claude home');

  const canonicalFrameworkRoot = realpathSync(frameworkRoot);
  if (isPathWithin(canonicalSource, canonicalFrameworkRoot) || isInsideGitCheckout(canonicalSource)) {
    throw new Error('source Claude home may not be inside a repository checkout');
  }

  const sourceConfig = sourceClaudeJsonPath(canonicalSource);
  if (existsSync(sourceConfig)) {
    const configStat = lstatSync(sourceConfig);
    if (!configStat.isFile() || configStat.isSymbolicLink()) {
      throw new Error('source .claude.json must be a regular non-symlink file');
    }
    assertOwnedBySetupUser(sourceConfig, configStat.uid, 'source .claude.json');
    if ((configStat.mode & 0o002) !== 0) throw new Error('source .claude.json may not be world-writable');
  }
  return canonicalSource;
}

function assertOwnedBySetupUser(path: string, ownerUid: number, label: string): void {
  const setupUid = process.getuid?.();
  if (setupUid !== undefined && ownerUid !== setupUid) {
    throw new Error(`${label} has the wrong owner: ${path}`);
  }
}

function assertNoWorldWritablePath(path: string, label: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if ((lstatSync(current).mode & 0o002) !== 0) {
      throw new Error(`${label} traverses a world-writable path`);
    }
  }
}

function isInsideGitCheckout(path: string): boolean {
  let current = path;
  for (;;) {
    if (existsSync(join(current, '.git'))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function assertIsolatedClaudeJsonInvariant(target: string): void {
  assertNoSymlinkComponents(target);
  const targetStat = lstatSync(target);
  if (!targetStat.isFile()) throw new Error('isolated .claude.json is not a regular file');
  if ((targetStat.mode & 0o777) !== 0o600) throw new Error('isolated .claude.json mode is not 0600');
  assertOwnedBySetupUser(target, targetStat.uid, 'isolated .claude.json');

  // These four checks prove the isolated .claude.json is a regular file, mode 0600,
  // owned by the setup uid, and reached without symlink components. That makes it
  // accessible exclusively to the owning uid, so no other user can read or write it,
  // and acts as an integrity tripwire for a wrong owner, symlink swap, or loosened
  // mode. It does not prove process isolation: the daemon and all agents share uid
  // 501, so this cannot prevent same-uid cross-agent tampering. A uid or privilege
  // boundary is required and tracked as infra follow-up task_1794328676449.
}

function assertNoSymlinkComponents(path: string): void {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error('isolated Claude path contains a symlink component');
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }
}

function isPathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(root + sep);
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
