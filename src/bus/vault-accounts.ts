import { readdirSync } from 'fs';
import { join } from 'path';

export interface VaultAccountEntry {
  account: string;
  hasToken: true;
}

export class VaultAccountsError extends Error {
  constructor() {
    super('Unable to list vault accounts');
  }
}

export function setupTokenVaultDir(ctxRoot: string): string {
  return join(ctxRoot, 'state', 'oauth', 'setup-tokens');
}

export function listVaultAccounts(ctxRoot: string): VaultAccountEntry[] {
  const vaultDir = setupTokenVaultDir(ctxRoot);
  try {
    return readdirSync(vaultDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.token'))
      .map((entry) => ({
        account: entry.name.slice(0, -'.token'.length),
        hasToken: true as const,
      }))
      .filter((entry) => entry.account.length > 0)
      .sort((a, b) => a.account.localeCompare(b.account));
  } catch {
    throw new VaultAccountsError();
  }
}
