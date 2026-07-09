import { Command } from 'commander';
import { listVaultAccounts, VaultAccountsError } from '../bus/vault-accounts.js';
import { resolveEnv } from '../utils/env.js';

interface ListVaultAccountsOptions {
  instance?: string;
  json?: boolean;
}

export const listVaultAccountsCommand = new Command('list-vault-accounts')
  .description('List setup-token vault accounts by name only')
  .option('--instance <id>', 'Instance ID')
  .option('--json', 'Output as JSON')
  .action((opts: ListVaultAccountsOptions) => {
    const env = resolveEnv({ instanceId: opts.instance });
    try {
      const accounts = listVaultAccounts(env.ctxRoot);
      if (opts.json) {
        console.log(JSON.stringify(accounts, null, 2));
        return;
      }
      if (accounts.length === 0) {
        console.log('No vault-backed accounts found.');
        return;
      }
      for (const account of accounts) console.log(account.account);
    } catch (err) {
      const message = err instanceof VaultAccountsError
        ? err.message
        : 'Unable to list vault accounts';
      if (opts.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
      else console.error(`Error: ${message}`);
      process.exit(1);
    }
  });
