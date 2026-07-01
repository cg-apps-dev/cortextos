import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { backupEnv, rollbackEnv, envBackupDir } from '../../../src/bus/env-backup.js';

describe('env-backup (backupEnv + rollbackEnv)', () => {
  let ctxRoot: string;
  let agentEnv: string;
  const agent = 'test-agent';
  const ENV_CONTENT = 'BOT_TOKEN=123:abc\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-old\n# FOO note\nFOO=1\n';

  beforeEach(() => {
    ctxRoot = mkdtempSync(join(tmpdir(), 'env-backup-test-'));
    // agent .env lives in a repo-like dir separate from ctxRoot (mirrors orgs/ vs state/)
    const agentDir = join(ctxRoot, '_repo', 'agents', agent);
    mkdirSync(agentDir, { recursive: true });
    agentEnv = join(agentDir, '.env');
    writeFileSync(agentEnv, ENV_CONTENT, { mode: 0o600 });
  });
  afterEach(() => {
    rmSync(ctxRoot, { recursive: true, force: true });
  });

  it('backupEnv writes an OUT-OF-TREE 0600 byte-identical backup and returns its path', () => {
    const bak = backupEnv(ctxRoot, agent, agentEnv, '20260630T000000Z');
    // out-of-tree = under CTX_ROOT/state/<agent>/env-backups, NOT under the agent dir
    expect(bak.startsWith(envBackupDir(ctxRoot, agent))).toBe(true);
    expect(bak.includes(`${agent}/.env`)).toBe(false); // not beside the real .env
    expect(existsSync(bak)).toBe(true);
    expect(readFileSync(bak, 'utf-8')).toBe(ENV_CONTENT);
    expect(statSync(bak).mode & 0o777).toBe(0o600);
  });

  it('backupEnv fail-closes if the source .env is missing (throws, no partial backup)', () => {
    expect(() => backupEnv(ctxRoot, agent, join(ctxRoot, 'no-such.env'), 'ts')).toThrow();
  });

  it('rollbackEnv restores .env byte-identical from the backup and re-chmods 0600', () => {
    const bak = backupEnv(ctxRoot, agent, agentEnv, 'ts1');
    // simulate a broken edit
    writeFileSync(agentEnv, 'CORRUPTED', { mode: 0o644 });
    expect(readFileSync(agentEnv, 'utf-8')).toBe('CORRUPTED');

    rollbackEnv(agentEnv, bak);

    expect(readFileSync(agentEnv, 'utf-8')).toBe(ENV_CONTENT);
    expect(statSync(agentEnv).mode & 0o777).toBe(0o600);
  });

  it('rollbackEnv throws if the backup is unreadable (loud, not silent)', () => {
    expect(() => rollbackEnv(agentEnv, join(ctxRoot, 'missing.bak'))).toThrow();
  });
});
