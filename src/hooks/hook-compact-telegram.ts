/**
 * hook-compact-telegram.ts — PreCompact hook.
 * SUPPRESSES the per-compaction user notification (goal-3: it was unsolicited internal-mechanics noise
 * that bypassed the in-process TelegramAPI belt — this hook is a separate process — and reached Adam on
 * every compaction). Instead emits an INTERNAL log-event (context_compact) so a long compaction can be
 * disambiguated from a silent-death without a user-facing ping. (Historically it sent a "[agent] Context
 * compacting... resuming shortly" Telegram notice, #18 — now removed.)
 *
 * This hook fires and returns immediately — it never blocks the compaction (fire-and-forget, 5s cap).
 * Registered in settings.json under the "PreCompact" event.
 */

import { loadEnv } from './index.js';
import { execFile } from 'child_process';
import { join } from 'path';

async function main(): Promise<void> {
  const env = loadEnv();
  const agentName = env.agentName || 'agent';

  // D1 (locked, goal-3): SUPPRESS the per-compaction Telegram notify ("[agent] Context compacting...
  // resuming shortly") — unsolicited internal-mechanics noise off Adam's AND ops' inboxes. The in-process
  // belt (TelegramAPI.sendMessage) cannot reach this OUT-OF-PROCESS hook, so the old raw fetch bypassed it
  // entirely and reached Adam per-compaction. Instead emit an INTERNAL durable LOG-EVENT (queryable
  // activity record, NOT a telegram send): a compaction that outlasts the ~10min liveness window could
  // make a compacting agent look silent-dead → a FALSE silent-death alert; the log-event disambiguates
  // compaction-from-death, removing that spurious-alert class. Fire-and-forget, 5s cap, never blocks
  // compaction. process.execPath + dist/cli.js is the PATH-safe invocation (matches notifyAgents).
  const frameworkRoot = process.env.CTX_FRAMEWORK_ROOT;
  const args = ['bus', 'log-event', 'action', 'context_compact', 'info',
    '--meta', JSON.stringify({ agent: agentName })];
  try {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      if (frameworkRoot) {
        execFile(process.execPath, [join(frameworkRoot, 'dist', 'cli.js'), ...args], { timeout: 5000 }, done);
      } else {
        execFile('cortextos', args, { timeout: 5000 }, done);
      }
    });
  } catch {
    // Never fail — compaction must not be blocked
  }
}

main().catch(() => process.exit(0));
