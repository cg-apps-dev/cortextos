import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'module';
import { ecosystemCommand } from '../../../src/cli/ecosystem';

const nodeRequire = createRequire(import.meta.url);

describe('cortextos ecosystem', () => {
  let tmpRoot: string;
  const originalFrameworkRoot = process.env.CTX_FRAMEWORK_ROOT;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'ecosystem-test-'));
    mkdirSync(join(tmpRoot, 'orgs', 'acme', 'agents', 'test-agent'), { recursive: true });
    mkdirSync(join(tmpRoot, 'dashboard', 'node_modules', '.bin'), { recursive: true });
    mkdirSync(join(tmpRoot, 'dashboard', 'node_modules', 'next', 'dist', 'bin'), { recursive: true });
    writeFileSync(join(tmpRoot, 'dashboard', 'package.json'), '{}', 'utf-8');
    writeFileSync(join(tmpRoot, 'dashboard', 'node_modules', '.bin', 'next'), '', 'utf-8');
    process.env.CTX_FRAMEWORK_ROOT = tmpRoot;
  });

  afterEach(() => {
    if (originalFrameworkRoot !== undefined) process.env.CTX_FRAMEWORK_ROOT = originalFrameworkRoot;
    else delete process.env.CTX_FRAMEWORK_ROOT;
    vi.restoreAllMocks();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('generates a portable daemon and dashboard PM2 config', async () => {
    const output = join(tmpRoot, 'ecosystem.config.js');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await ecosystemCommand.parseAsync([
      'node',
      'ecosystem',
      '--org',
      'acme',
      '--output',
      output,
    ]);

    expect(existsSync(output)).toBe(true);
    const content = readFileSync(output, 'utf-8');
    expect(content).not.toContain('/Users/');
    expect(content).toContain("const FRAMEWORK_ROOT = process.env.CTX_FRAMEWORK_ROOT || __dirname;");
    expect(content).toContain("const CTX_ROOT = process.env.CTX_ROOT || path.join(os.homedir(), '.cortextos', INSTANCE_ID);");

    process.env.CTX_FRAMEWORK_ROOT = tmpRoot;
    delete nodeRequire.cache[output];
    const ecosystem = nodeRequire(output) as { apps: Array<{ name: string; script: string; cwd: string; env: Record<string, string> }> };

    expect(ecosystem.apps).toHaveLength(2);
    expect(ecosystem.apps[0]).toMatchObject({
      name: 'cortextos-daemon',
      script: join(tmpRoot, 'dist', 'daemon.js'),
      cwd: tmpRoot,
    });
    expect(ecosystem.apps[1]).toMatchObject({
      name: 'cortextos-dashboard',
      script: 'npm',
      cwd: join(tmpRoot, 'dashboard'),
    });
    expect(ecosystem.apps[1].env.DASHBOARD_NODE_BIN).toBe('/opt/homebrew/Cellar/node/25.9.0_1/bin');
    expect(ecosystem.apps[1].env.PATH).toMatch(/^\/opt\/homebrew\/Cellar\/node\/25\.9\.0_1\/bin:/);
  });
});
