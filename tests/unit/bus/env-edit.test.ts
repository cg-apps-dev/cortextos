import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  applyEnvAssignments,
  parseEnvAssignments,
  setAgentEnv,
  verifyEnvEdit,
} from '../../../src/bus/env-edit.js';
import { envBackupDir } from '../../../src/bus/env-backup.js';

describe('set-agent-env safe .env edit helper', () => {
  let root: string;
  let frameworkRoot: string;
  let ctxRoot: string;
  let agentDir: string;
  let envPath: string;
  const org = 'test-org';
  const agent = 'test-agent';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'env-edit-test-'));
    frameworkRoot = join(root, 'repo');
    ctxRoot = join(root, 'ctx');
    agentDir = join(frameworkRoot, 'orgs', org, 'agents', agent);
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(ctxRoot, { recursive: true });
    envPath = join(agentDir, '.env');
    writeFileSync(envPath, [
      '# top comment',
      'BOT_TOKEN=old-bot',
      '#CLAUDE_CODE_OAUTH_TOKEN=old-commented-secret',
      'CLAUDE_CODE_OAUTH_TOKEN=old-active',
      'CLAUDE_CODE_OAUTH_TOKEN=duplicate-active',
      'CLAUDE_CODE_OAUTH_TOKEN=',
      '#FOO=keep this note',
      'FOO=old',
      'BAR=unchanged',
      '',
    ].join('\n'), { mode: 0o600 });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('sets a new key, shreds the out-of-tree backup, chmods 600, and creates no in-tree .env.bak', () => {
    const result = setAgentEnv({
      agent,
      org,
      frameworkRoot,
      ctxRoot,
      inlineAssignments: ['NEW_KEY=value'],
      ts: '20260701T000000Z',
      afterWrite: () => {
        const backups = readdirSync(envBackupDir(ctxRoot, agent));
        expect(backups).toEqual(['.env.20260701T000000Z']);
        const backupPath = join(envBackupDir(ctxRoot, agent), backups[0]);
        expect(backupPath.startsWith(agentDir)).toBe(false);
        expect(statSync(backupPath).mode & 0o777).toBe(0o600);
      },
    });

    expect(result.keys).toEqual(['NEW_KEY']);
    expect(existsSync(result.backupPath)).toBe(false);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(envPath, 'utf-8')).toContain('NEW_KEY=value\n');
    expect(readdirSync(agentDir).filter((name) => name.startsWith('.env.bak'))).toEqual([]);
  });

  it('replaces existing keys, appends missing keys, and supports multiple keys', () => {
    setAgentEnv({
      agent,
      org,
      frameworkRoot,
      ctxRoot,
      inlineAssignments: ['FOO=new', 'ADDED=yes'],
      ts: 'multi',
    });

    const written = readFileSync(envPath, 'utf-8');
    expect(written).toContain('#FOO=keep this note\n');
    expect(written.match(/^FOO=/gm)).toHaveLength(1);
    expect(written).toContain('FOO=new\n');
    expect(written).toContain('ADDED=yes\n');
    expect(written).toContain('BAR=unchanged\n');
  });

  it('strips stale secret comments, duplicates, and placeholders, but preserves non-secret comments', () => {
    setAgentEnv({
      agent,
      org,
      frameworkRoot,
      ctxRoot,
      inlineAssignments: ['CLAUDE_CODE_OAUTH_TOKEN=fresh-token', 'FOO=new'],
      ts: 'strip',
    });

    const written = readFileSync(envPath, 'utf-8');
    expect(written).not.toContain('#CLAUDE_CODE_OAUTH_TOKEN=old-commented-secret');
    expect(written.match(/^CLAUDE_CODE_OAUTH_TOKEN=/gm)).toHaveLength(1);
    expect(written).toContain('CLAUDE_CODE_OAUTH_TOKEN=fresh-token\n');
    expect(written).toContain('#FOO=keep this note\n');
    expect(written.match(/^FOO=/gm)).toHaveLength(1);
  });

  it('--from-file merges with inline assignments and from-file wins on collision', () => {
    const fromFile = join(root, 'incoming.env');
    writeFileSync(fromFile, [
      '# delivered secret file',
      'FOO=file-wins',
      'CLAUDE_CODE_OAUTH_TOKEN=file-secret',
      '',
    ].join('\n'), { mode: 0o600 });

    const parsed = parseEnvAssignments(['FOO=inline', 'BAR=inline-bar'], fromFile);
    expect(parsed.get('FOO')).toBe('file-wins');
    expect(parsed.get('BAR')).toBe('inline-bar');
    expect(parsed.get('CLAUDE_CODE_OAUTH_TOKEN')).toBe('file-secret');

    setAgentEnv({
      agent,
      org,
      frameworkRoot,
      ctxRoot,
      inlineAssignments: ['FOO=inline', 'BAR=inline-bar'],
      fromFile,
      ts: 'from-file',
    });

    const written = readFileSync(envPath, 'utf-8');
    expect(written).toContain('FOO=file-wins\n');
    expect(written).toContain('BAR=inline-bar\n');
    expect(written).toContain('CLAUDE_CODE_OAUTH_TOKEN=file-secret\n');
  });

  it('aborts before touching .env if backup creation fails', () => {
    const before = readFileSync(envPath, 'utf-8');
    const badCtxRoot = join(root, 'not-a-directory');
    writeFileSync(badCtxRoot, 'file blocks mkdir');

    expect(() => setAgentEnv({
      agent,
      org,
      frameworkRoot,
      ctxRoot: badCtxRoot,
      inlineAssignments: ['FOO=will-not-write'],
      ts: 'backup-fail',
    })).toThrow();

    expect(readFileSync(envPath, 'utf-8')).toBe(before);
  });

  it('rolls back and shreds backup when verification fails after write', () => {
    const before = readFileSync(envPath, 'utf-8');

    expect(() => setAgentEnv({
      agent,
      org,
      frameworkRoot,
      ctxRoot,
      inlineAssignments: ['FOO=new'],
      ts: 'verify-fail',
      afterWrite: (path) => {
        writeFileSync(path, 'BROKEN_WITHOUT_EQUALS\n', { mode: 0o644 });
      },
    })).toThrow(/rolled back/);

    expect(readFileSync(envPath, 'utf-8')).toBe(before);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(existsSync(join(envBackupDir(ctxRoot, agent), '.env.verify-fail'))).toBe(false);
  });

  it('verification catches non-target clobber and rollback restores pre-edit bytes', () => {
    const before = readFileSync(envPath, 'utf-8');

    expect(() => setAgentEnv({
      agent,
      org,
      frameworkRoot,
      ctxRoot,
      inlineAssignments: ['FOO=new'],
      ts: 'clobber',
      afterWrite: (path) => {
        const written = readFileSync(path, 'utf-8').replace('BAR=unchanged', 'BAR=clobbered');
        writeFileSync(path, written, { mode: 0o600 });
      },
    })).toThrow(/non-edited/);

    expect(readFileSync(envPath, 'utf-8')).toBe(before);
    expect(existsSync(join(envBackupDir(ctxRoot, agent), '.env.clobber'))).toBe(false);
  });

  it('preserves the recovery backup when rollback fails', () => {
    const backupPath = join(envBackupDir(ctxRoot, agent), '.env.rollback-fails');
    let thrown: Error | undefined;

    try {
      setAgentEnv({
        agent,
        org,
        frameworkRoot,
        ctxRoot,
        inlineAssignments: ['FOO=new'],
        ts: 'rollback-fails',
        afterWrite: (path) => {
          writeFileSync(path, 'BROKEN_WITHOUT_EQUALS\n', { mode: 0o600 });
          chmodSync(agentDir, 0o500);
        },
      });
    } catch (err) {
      thrown = err as Error;
    } finally {
      chmodSync(agentDir, 0o700);
    }

    expect(thrown).toBeDefined();
    expect(thrown?.message).toContain('RECOVERY BACKUP PRESERVED');
    expect(thrown?.message).toContain(backupPath);
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf-8')).toContain('BOT_TOKEN=old-bot\n');
  });

  it('redacts malformed env lines without echoing raw token bytes', () => {
    const secretLikeMalformed = 'BROKEN_sk-ant-oat01-sensitive-token';
    writeFileSync(envPath, `${secretLikeMalformed}\n`, { mode: 0o600 });

    expect(() => verifyEnvEdit({
      before: 'FOO=old\n',
      after: `${secretLikeMalformed}\n`,
      envPath,
      expected: new Map([['FOO', 'new']]),
    })).toThrow(/<redacted malformed line: \d+ bytes>/);

    try {
      verifyEnvEdit({
        before: 'FOO=old\n',
        after: `${secretLikeMalformed}\n`,
        envPath,
        expected: new Map([['FOO', 'new']]),
      });
    } catch (err) {
      expect((err as Error).message).not.toContain('sk-ant-oat01-sensitive-token');
    }
  });

  it('verifyEnvEdit passes when only target lines differ', () => {
    const before = 'A=1\n#FOO=note\nFOO=old\nB=2\n';
    const expected = new Map([['FOO', 'new']]);
    const after = `${applyEnvAssignments(before, expected)}\n`;
    writeFileSync(envPath, after, { mode: 0o600 });

    expect(after.endsWith('\n')).toBe(true);
    expect(() => verifyEnvEdit({ before, after, envPath, expected })).not.toThrow();
  });
});
