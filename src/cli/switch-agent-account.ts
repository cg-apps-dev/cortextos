import { Command } from 'commander';
import { IPCClient } from '../daemon/ipc-server.js';
import { resolveEnv } from '../utils/env.js';
import { resolvePaths } from '../utils/paths.js';
import {
  defaultSwitchAgentAccountOps,
  switchAgentAccount,
  switchAllFrom,
  type SwitchAgentAccountOps,
  SwitchAgentAccountError,
} from '../bus/switch-agent-account.js';
import { drainSwitchQueueCli } from './drain-switch-queue.js';

interface SwitchAgentAccountCliOptions {
  instance?: string;
  tokenFile?: string;
  allFrom?: string[];
  dryRun?: boolean;
  json?: boolean;
  drainSwitchQueue?: boolean;
}

export const switchAgentAccountCommand = new Command('switch-agent-account')
  .argument('[agent]', 'Agent to switch, or target account when --all-from is used')
  .argument('[target-account]', 'Target account label')
  .option('--instance <id>', 'Instance ID')
  .option('--token-file <path>', 'Ingest a delivered setup-token file into the vault before switching')
  .option('--all-from <accounts...>', 'Batch mode: source-account target-account')
  .option('--dry-run', 'Run preflight only; do not flip or restart')
  .option('--json', 'Output JSON')
  .option('--drain-switch-queue', 'Drain the dashboard account-switch queue')
  .description('Gated bearer/setup-token account switch: preflight, flip, restart, verify, rollback, and functional-sweep task')
  .action(async (agentArg: string | undefined, targetArg: string | undefined, opts: SwitchAgentAccountCliOptions) => {
    const env = resolveEnv({ instanceId: opts.instance });
    const instanceId = opts.instance ?? env.instanceId;
    if (opts.drainSwitchQueue) {
      const result = await drainSwitchQueueCli({ ctxRoot: env.ctxRoot, json: opts.json });
      outputResult({ ok: true, drained: result.length, entries: result }, opts.json);
      return;
    }
    if (!env.frameworkRoot) exitCli('CTX_FRAMEWORK_ROOT is required', opts.json);
    if (!env.org) exitCli('CTX_ORG is required', opts.json);
    console.error(`[switch-agent-account] resolved operator agent: ${env.agentName}`);

    const paths = resolvePaths(env.agentName, instanceId, env.org);
    const ipc = new IPCClient(instanceId);
    const daemonRunning = await ipc.isDaemonRunning();
    if (!daemonRunning) exitCli('Daemon is not running. Start it first: cortextos start', opts.json);

    const baseOps = defaultSwitchAgentAccountOps(ipc, env.org, paths, () => Date.now());
    const ops: SwitchAgentAccountOps = {
      ...baseOps,
      createFunctionalSweepTask: opts.dryRun ? () => undefined : baseOps.createFunctionalSweepTask,
    };

    try {
      if (opts.allFrom) {
        if (opts.allFrom.length !== 2 || agentArg || targetArg) {
          exitCli('Usage: cortextos switch-agent-account --all-from <source-account> <target-account>', opts.json);
        }
        const [sourceAccount, targetAccount] = opts.allFrom;
        const result = await switchAllFrom({
          ctxRoot: env.ctxRoot,
          frameworkRoot: env.frameworkRoot,
          org: env.org,
          instanceId,
          operatorAgent: env.agentName,
          sourceAccount,
          targetAccount,
          tokenFile: opts.tokenFile,
          dryRun: opts.dryRun,
          ops,
          paths,
        });
        outputResult(result, opts.json);
        return;
      }

      if (!agentArg || !targetArg) {
        exitCli('Usage: cortextos switch-agent-account <agent> <target-account>', opts.json);
      }
      const result = await switchAgentAccount({
        ctxRoot: env.ctxRoot,
        frameworkRoot: env.frameworkRoot,
        org: env.org,
        instanceId,
        operatorAgent: env.agentName,
        agent: agentArg,
        targetAccount: targetArg,
        tokenFile: opts.tokenFile,
        dryRun: opts.dryRun,
        ops,
        paths,
      });
      outputResult(result, opts.json);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof SwitchAgentAccountError ? err.code : 'SWITCH_FAILED';
      const rolledBack = err instanceof SwitchAgentAccountError ? err.rolledBack : false;
      if (opts.json) {
        console.log(JSON.stringify({ ok: false, code, rolledBack, error: message }, null, 2));
      } else {
        console.error(`FAILED: ${message}`);
        if (rolledBack) console.error('Rollback was attempted; inspect the error above for final state.');
      }
      process.exit(1);
    }
  });

function outputResult(value: unknown, json = false): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (typeof value === 'object' && value !== null && 'message' in value && typeof (value as { message: unknown }).message === 'string') {
    console.log((value as { message: string }).message);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function exitCli(message: string, json = false): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  else console.error(message);
  process.exit(1);
}
