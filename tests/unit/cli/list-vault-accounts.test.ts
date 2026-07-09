import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { listVaultAccounts, VaultAccountsError } from '../../../src/bus/vault-accounts';
import { listVaultAccountsCommand } from '../../../src/cli/list-vault-accounts';

const SECRET_TOKEN = 'sk-ant-oat01-SECRETabcdefghijklmnopqrstuvwxyz0123456789';

describe('list-vault-accounts', () => {
  let ctxRoot: string;
  let oldCtxRoot: string | undefined;
  let oldCtxInstance: string | undefined;
  let logs: string[];
  let errors: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    ctxRoot = mkdtempSync(join(tmpdir(), 'vault-accounts-'));
    oldCtxRoot = process.env.CTX_ROOT;
    oldCtxInstance = process.env.CTX_INSTANCE_ID;
    process.env.CTX_ROOT = ctxRoot;
    process.env.CTX_INSTANCE_ID = 'test';
    logs = [];
    errors = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((value: unknown) => {
      logs.push(String(value));
    });
    errorSpy = vi.spyOn(console, 'error').mockImplementation((value: unknown) => {
      errors.push(String(value));
    });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw new Error(`process.exit(${code ?? 0})`);
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    if (oldCtxRoot === undefined) delete process.env.CTX_ROOT;
    else process.env.CTX_ROOT = oldCtxRoot;
    if (oldCtxInstance === undefined) delete process.env.CTX_INSTANCE_ID;
    else process.env.CTX_INSTANCE_ID = oldCtxInstance;
    chmodSync(ctxRoot, 0o700);
    rmSync(ctxRoot, { recursive: true, force: true });
  });

  it('returns vault account names only without token bytes', () => {
    const vaultDir = makeVaultDir();
    writeFileSync(join(vaultDir, 'moonlight-max.token'), `${SECRET_TOKEN}\n`, { mode: 0o600 });
    writeFileSync(join(vaultDir, 'me-com-max.token'), 'different-secret\n', { mode: 0o600 });
    writeFileSync(join(vaultDir, 'not-a-token.txt'), SECRET_TOKEN, { mode: 0o600 });

    const accounts = listVaultAccounts(ctxRoot);

    expect(accounts).toEqual([
      { account: 'me-com-max', hasToken: true },
      { account: 'moonlight-max', hasToken: true },
    ]);
    expect(JSON.stringify(accounts)).not.toContain(SECRET_TOKEN);
  });

  it('returns an empty list for an empty vault directory', () => {
    makeVaultDir();

    expect(listVaultAccounts(ctxRoot)).toEqual([]);
  });

  it('throws a generic error for an absent vault directory', () => {
    expect(() => listVaultAccounts(ctxRoot)).toThrow(VaultAccountsError);
    expect(() => listVaultAccounts(ctxRoot)).toThrow('Unable to list vault accounts');
  });

  it('throws a generic error for an unreadable vault directory', () => {
    const vaultDir = makeVaultDir();
    chmodSync(vaultDir, 0o000);
    try {
      expect(() => listVaultAccounts(ctxRoot)).toThrow(VaultAccountsError);
      expect(() => listVaultAccounts(ctxRoot)).toThrow('Unable to list vault accounts');
    } finally {
      chmodSync(vaultDir, 0o700);
    }
  });

  it('prints JSON array output from the CLI', async () => {
    const vaultDir = makeVaultDir();
    writeFileSync(join(vaultDir, 'moonlight-max.token'), `${SECRET_TOKEN}\n`, { mode: 0o600 });

    await listVaultAccountsCommand.parseAsync(['node', 'list-vault-accounts', '--json'], { from: 'node' });

    expect(JSON.parse(logs.join('\n'))).toEqual([{ account: 'moonlight-max', hasToken: true }]);
    expect(logs.join('\n')).not.toContain(SECRET_TOKEN);
    expect(errors).toEqual([]);
  });

  it('prints a generic CLI error without leaking the vault path', async () => {
    await expect(
      listVaultAccountsCommand.parseAsync(['node', 'list-vault-accounts', '--json'], { from: 'node' }),
    ).rejects.toThrow('process.exit(1)');

    const output = logs.join('\n');
    expect(JSON.parse(output)).toEqual({ ok: false, error: 'Unable to list vault accounts' });
    expect(output).not.toContain(ctxRoot);
    expect(errors).toEqual([]);
  });

  function makeVaultDir(): string {
    const vaultDir = join(ctxRoot, 'state', 'oauth', 'setup-tokens');
    mkdirSync(vaultDir, { recursive: true, mode: 0o700 });
    return vaultDir;
  }
});
