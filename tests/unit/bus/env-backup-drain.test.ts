import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isEnvBackupName, findEnvBackups, drainEnvBackups } from '../../../src/bus/env-backup-drain.js';
import { shredAtRestStatus } from '../../../src/utils/shred.js';

describe('isEnvBackupName', () => {
  it('matches the whole .env*bak* family (the observed pile shapes)', () => {
    for (const name of [
      '.env.bak',
      '.env.bak-20260627T175922Z',
      '.env.bak-2026-06-27T18-16-40-963Z',
      '.env.pre-icloud.bak',
      '.env.bak.1',
    ]) {
      expect(isEnvBackupName(name), name).toBe(true);
    }
  });

  it('NEVER matches a live .env or the example template', () => {
    expect(isEnvBackupName('.env')).toBe(false);
    expect(isEnvBackupName('.env.example')).toBe(false);
  });

  it('does not match non-backup env variants or unrelated files (faithful to the .env*bak* glob)', () => {
    // NOTE: ".env.backup" has NO "bak" substring (b-a-c-k-u-p), so it is out of
    // scope by the spec glob - documented here as a deliberate boundary, not a miss.
    for (const name of ['.env.local', '.env.production', '.env.backup', 'env.bak', 'notes.txt', 'backup.env']) {
      expect(isEnvBackupName(name), name).toBe(false);
    }
  });
});

describe('findEnvBackups + drainEnvBackups', () => {
  let root: string;
  let agentDir: string;
  let orgDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'env-drain-test-'));
    orgDir = join(root, 'orgs', 'test-org');
    agentDir = join(orgDir, 'agents', 'test-agent');
    mkdirSync(agentDir, { recursive: true });
    // live files that must NEVER be touched
    writeFileSync(join(agentDir, '.env'), 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-live\n', { mode: 0o600 });
    writeFileSync(join(agentDir, '.env.example'), 'CLAUDE_CODE_OAUTH_TOKEN=\n');
    // stray backups (the pile) - agent-level
    writeFileSync(join(agentDir, '.env.bak-20260627T175922Z'), 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-old1\n', { mode: 0o600 });
    writeFileSync(join(agentDir, '.env.bak-2026-06-27T18-16-40-963Z'), 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-old2\n', { mode: 0o600 });
    writeFileSync(join(agentDir, '.env.pre-icloud.bak'), 'CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-old3\n', { mode: 0o600 });
    // org-level backup (org-root scan path)
    writeFileSync(join(orgDir, '.env.bak'), 'GEMINI_API_KEY=old\n', { mode: 0o600 });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds every stray env-backup across agent + org dirs, and nothing else', () => {
    const found = findEnvBackups(root).map((p) => p.replace(root + '/', ''));
    expect(found.sort()).toEqual([
      'orgs/test-org/.env.bak',
      'orgs/test-org/agents/test-agent/.env.bak-2026-06-27T18-16-40-963Z',
      'orgs/test-org/agents/test-agent/.env.bak-20260627T175922Z',
      'orgs/test-org/agents/test-agent/.env.pre-icloud.bak',
    ]);
  });

  it('shreds all backups and NEVER touches the live .env or .env.example', () => {
    const result = drainEnvBackups({ frameworkRoot: root });
    expect(result.shredded.length).toBe(4);
    expect(result.failed).toEqual([]);
    // backups gone
    expect(existsSync(join(agentDir, '.env.bak-20260627T175922Z'))).toBe(false);
    expect(existsSync(join(agentDir, '.env.pre-icloud.bak'))).toBe(false);
    expect(existsSync(join(orgDir, '.env.bak'))).toBe(false);
    // live files untouched
    expect(existsSync(join(agentDir, '.env'))).toBe(true);
    expect(existsSync(join(agentDir, '.env.example'))).toBe(true);
  });

  it('dry-run lists matches and removes NOTHING', () => {
    const result = drainEnvBackups({ frameworkRoot: root, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.matched.length).toBe(4);
    expect(result.shredded).toEqual([]);
    // every backup still present
    expect(existsSync(join(agentDir, '.env.bak-20260627T175922Z'))).toBe(true);
    expect(existsSync(join(orgDir, '.env.bak'))).toBe(true);
  });

  it('returns an at-rest status object and a clean empty result on a bare tree', () => {
    const empty = mkdtempSync(join(tmpdir(), 'env-drain-empty-'));
    try {
      const result = drainEnvBackups({ frameworkRoot: empty });
      expect(result.matched).toEqual([]);
      expect(result.shredded).toEqual([]);
      expect(typeof result.atRest.fileVaultProtected).toBe('boolean');
      expect(typeof result.atRest.detail).toBe('string');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('shredAtRestStatus', () => {
  it('never throws and returns a positively-typed, leak-safe status', () => {
    const s = shredAtRestStatus();
    expect(typeof s.fileVaultProtected).toBe('boolean');
    expect(typeof s.detail).toBe('string');
    expect(s.detail.length).toBeGreaterThan(0);
  });
});
