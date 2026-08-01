import { chmodSync, existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { atomicWriteSync } from '../utils/atomic.js';
import { validateAgentName } from '../utils/validate.js';
import { backupEnv, rollbackEnv } from './env-backup.js';
import { shredFile } from '../utils/shred.js';

// Add a secret key here to give it aggressive stale/commented-line stripping.
export const KNOWN_SECRET_KEYS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'BOT_TOKEN',
]);

// A key NAME whose shape says "this is a secret". Used to fail-CLOSED at the CLI
// boundary: a secret passed positionally lands its VALUE in argv (ps / shell
// history), so any secret-shaped key must go via --from-file. The 4 named keys
// above are NOT the whole secret set (the .env.bak sweep found SHOPIFY_ACCESS_TOKEN
// / GOG_KEYRING_PASSWORD / *_PASSWORD etc), so match by shape as well as by name.
export const SECRET_KEY_SHAPE = /TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL/i;

/** True if the key name is a known secret OR has a secret shape (fail-closed). */
export function isSecretKeyName(key: string): boolean {
  return KNOWN_SECRET_KEYS.has(key) || SECRET_KEY_SHAPE.test(key);
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface SetAgentEnvInput {
  agent: string;
  org: string;
  frameworkRoot: string;
  ctxRoot: string;
  inlineAssignments?: string[];
  fromFile?: string;
  ts?: string;
  afterWrite?: (envPath: string) => void;
}

export interface SetAgentEnvResult {
  agent: string;
  org: string;
  envPath: string;
  backupPath: string;
  keys: string[];
  warnings: string[];
}

export interface VerifyEnvEditInput {
  before: string;
  after: string;
  envPath: string;
  expected: Map<string, string>;
}

interface ClassifiedLine {
  key?: string;
  active: boolean;
  removableSecretComment: boolean;
}

export function parseEnvAssignments(inlineAssignments: string[] = [], fromFile?: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const arg of inlineAssignments) {
    addAssignment(out, arg, 'argument');
  }
  if (fromFile) {
    const raw = readFileSync(fromFile, 'utf-8');
    for (const [idx, line] of raw.split(/\r?\n/).entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      addAssignment(out, line, `${fromFile}:${idx + 1}`);
    }
  }
  if (out.size === 0) {
    throw new Error('set-agent-env: provide at least one KEY=VALUE assignment or --from-file');
  }
  return out;
}

export function resolveAgentEnvPath(frameworkRoot: string, org: string, agent: string): string {
  validateAgentName(agent);
  if (!frameworkRoot) throw new Error('set-agent-env: CTX_FRAMEWORK_ROOT is required');
  if (!org || /[./\\<>|;'"(){}[\] ]/.test(org) || org.includes('..')) {
    throw new Error('set-agent-env: --org is required and must not contain unsafe characters');
  }
  return join(frameworkRoot, 'orgs', org, 'agents', agent, '.env');
}

export function applyEnvAssignments(content: string, assignments: Map<string, string>): string {
  const lines = splitEnvLines(content);
  const emitted = new Set<string>();
  const next: string[] = [];

  for (const line of lines) {
    const cls = classifyLine(line, assignments);
    if (!cls.key) {
      next.push(line);
      continue;
    }

    if (cls.active) {
      if (!emitted.has(cls.key)) {
        next.push(`${cls.key}=${assignments.get(cls.key) ?? ''}`);
        emitted.add(cls.key);
      }
      continue;
    }

    if (cls.removableSecretComment) {
      continue;
    }

    next.push(line);
  }

  for (const key of assignments.keys()) {
    if (!emitted.has(key)) {
      next.push(`${key}=${assignments.get(key) ?? ''}`);
    }
  }

  return next.join('\n');
}

export function verifyEnvEdit(input: VerifyEnvEditInput): void {
  const activeCounts = new Map<string, string[]>();
  const afterLines = splitEnvLines(input.after);
  for (const line of afterLines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const active = activeKeyForLine(line);
    if (!active) {
      throw new Error(`verify failed: malformed env line after edit: ${describeLineShape(line)}`);
    }
    const values = activeCounts.get(active.key) ?? [];
    values.push(active.value);
    activeCounts.set(active.key, values);
  }

  for (const [key, expectedValue] of input.expected) {
    const values = activeCounts.get(key) ?? [];
    if (values.length !== 1 || values[0] !== expectedValue) {
      throw new Error(`verify failed: ${key} must have exactly one active line with the expected value`);
    }
  }

  const mode = statSync(input.envPath).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(`verify failed: ${input.envPath} mode is ${mode.toString(8)}, expected 600`);
  }

  const beforeUntouched = untouchedLines(input.before, input.expected);
  const afterUntouched = untouchedLines(input.after, input.expected);
  if (!sameStringArray(beforeUntouched, afterUntouched)) {
    throw new Error('verify failed: non-edited .env lines changed unexpectedly');
  }
}

export function setAgentEnv(input: SetAgentEnvInput): SetAgentEnvResult {
  const assignments = parseEnvAssignments(input.inlineAssignments, input.fromFile);
  const envPath = resolveAgentEnvPath(input.frameworkRoot, input.org, input.agent);
  if (!existsSync(envPath)) {
    throw new Error(`set-agent-env: .env does not exist for ${input.org}/${input.agent}`);
  }

  const before = readFileSync(envPath, 'utf-8');
  const backupPath = backupEnv(input.ctxRoot, input.agent, envPath, input.ts ?? timestampForBackup());
  const warnings: string[] = [];

  try {
    const next = applyEnvAssignments(before, assignments);
    atomicWriteSync(envPath, next, false);
    chmodSync(envPath, 0o600);
    input.afterWrite?.(envPath);
    const after = readFileSync(envPath, 'utf-8');
    verifyEnvEdit({ before, after, envPath, expected: assignments });
  } catch (err) {
    let rolledBack = false;
    let rollbackError: unknown;
    try {
      rollbackEnv(envPath, backupPath);
      rolledBack = true;
    } catch (rbErr) {
      rollbackError = rbErr;
    }

    if (!rolledBack) {
      throw new Error(
        `set-agent-env: edit failed AND rollback FAILED; .env may be broken - ` +
        `RECOVERY BACKUP PRESERVED (do not delete) at ${backupPath}. ` +
        `edit: ${(err as Error).message}; rollback: ${(rollbackError as Error | undefined)?.message ?? String(rollbackError)}`,
      );
    }

    try {
      shredFile(backupPath);
    } catch (shredErr) {
      warnings.push(`WARNING: token-bearing backup may remain at ${backupPath}: ${(shredErr as Error).message}`);
    }
    const warningSuffix = warnings.length > 0 ? `; ${warnings.join('; ')}` : '';
    throw new Error(`set-agent-env: edit failed, .env rolled back to pre-edit state: ${(err as Error).message}${warningSuffix}`);
  }

  try {
    shredFile(backupPath);
  } catch (err) {
    warnings.push(`WARNING: token-bearing backup may remain at ${backupPath}: ${(err as Error).message}`);
  }

  return {
    agent: input.agent,
    org: input.org,
    envPath,
    backupPath,
    keys: [...assignments.keys()],
    warnings,
  };
}

export function shredSucceeded(result: SetAgentEnvResult): boolean {
  return result.warnings.length === 0 && !existsSync(result.backupPath);
}

function addAssignment(out: Map<string, string>, raw: string, source: string): void {
  const eqIdx = raw.indexOf('=');
  if (eqIdx <= 0) {
    throw new Error(`set-agent-env: invalid KEY=VALUE assignment at ${source}`);
  }
  const key = raw.slice(0, eqIdx).trim();
  const value = raw.slice(eqIdx + 1);
  if (!ENV_KEY_RE.test(key)) {
    // LEAK-SAFE: an invalid "key" can be a token fragment (e.g. a bare token with
    // a base64 '=' pad, whose pre-'=' slice is secret material). Never echo the
    // raw slice - report its shape only, like describeLineShape does for lines.
    throw new Error(`set-agent-env: invalid env key <redacted: ${Buffer.byteLength(key, 'utf-8')} bytes> at ${source}`);
  }
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error(`set-agent-env: value for ${key} must be a single line`);
  }
  out.set(key, value);
}

function splitEnvLines(content: string): string[] {
  if (content === '') return [];
  return content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
}

function classifyLine(line: string, assignments: Map<string, string>): ClassifiedLine {
  const active = activeKeyForLine(line);
  if (active && assignments.has(active.key)) {
    return { key: active.key, active: true, removableSecretComment: false };
  }

  const trimmed = line.trimStart();
  if (!trimmed.startsWith('#')) {
    return { active: false, removableSecretComment: false };
  }

  for (const key of assignments.keys()) {
    if (!KNOWN_SECRET_KEYS.has(key)) continue;
    const re = new RegExp(`^#.*\\b${escapeRegex(key)}\\b`);
    if (re.test(trimmed)) {
      return { key, active: false, removableSecretComment: true };
    }
  }

  return { active: false, removableSecretComment: false };
}

function activeKeyForLine(line: string): { key: string; value: string } | null {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (!match) return null;
  return { key: match[1], value: match[2] };
}

function untouchedLines(content: string, assignments: Map<string, string>): string[] {
  return splitEnvLines(content).filter((line) => {
    const cls = classifyLine(line, assignments);
    return !cls.key;
  });
}

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((line, idx) => line === b[idx]);
}

function timestampForBackup(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describeLineShape(line: string): string {
  return `<redacted malformed line: ${Buffer.byteLength(line, 'utf-8')} bytes>`;
}
