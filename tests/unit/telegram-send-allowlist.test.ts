import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Enumeration-allowlist-guard (goal-3 out-of-process belt-completeness) — the durable DRIFT-LOCK.
 *
 * The notification belt is IN-PROCESS at TelegramAPI.sendMessage. It CANNOT govern out-of-process raw
 * sends (hooks / daemon / shell run in separate processes and cannot reach the belted instance). The
 * alert-fix's "20 sendMessage sites" enumeration was complete FOR that method, but the send-PATH surface is
 * wider (raw fetch / spawnSync curl). Durable lesson: a belt is only as complete as its enumeration —
 * enumerate every way bytes leave for api.telegram.org, not one method name.
 *
 * This test enumerates every raw sendMessage-to-a-chat sender in the tree and FAILS if one appears OUTSIDE
 * the reviewed allowlist — so a NEW belt-bypass (or a reactivated dormant one) cannot land silently; it
 * forces a re-triage per the out-of-process routing rules. Mirrors the modality _SOURCE_MODALITY
 * completeness test.
 */

const REPO = join(__dirname, '..', '..');

// Every file PERMITTED to raw-sendMessage (bypass the in-process belt), with the ruling that allows it.
// Adding a raw sendMessage anywhere else — or reactivating a dormant one un-triaged — FAILS this test.
const ALLOWLIST: Record<string, string> = {
  'src/daemon/index.ts':
    'daemon crash-LOOP last-resort: ops-first (notify-agent) with an operator-direct FALLBACK only when the '
    + 'fleet/bus may be DOWN — a plain ops-route could silently not-deliver a whole-fleet-down alert.',
  'orgs/clean-green-marketing/agents/security-agent/tools/fleet-scan.sh':
    'security real-threat -> Adam = the LEGIT decision-relevant keep-channel (FP/triage -> security-inbox).',
  'orgs/clean-green-marketing/agents/security-agent/tools/daily-backup.sh':
    'DEAD send_telegram() helper (defined, ZERO call sites); the live path is the category-router '
    + '(send-message security / notify-agent orch). Removal candidate; harmless (unreachable).',
  'scripts/self-healing/agent-recover.sh':
    'DORMANT (in no launchd plist / cron). Annotated GOAL-3-ALLOWLIST-DORMANT; re-triage if reactivated.',
  'scripts/self-healing/usage-monitor.sh':
    'DORMANT (in no launchd plist / cron). Annotated GOAL-3-ALLOWLIST-DORMANT; re-triage if reactivated.',
};

/**
 * Raw sendMessage-to-a-chat senders across source + scripts + tools. Two-step (grep candidates, then keep
 * only files that literally contain '/sendMessage') to avoid fragile regex quoting. Excludes
 * node_modules/dist/.git/tests and src/telegram/api.ts (that IS the in-process belt — the one legitimate
 * choke-point every belted send routes through; it is not a bypass).
 */
// Paths EXCLUDED from the sender scan: build artifacts, tests, and LOCAL git-worktree copies.
// Worktree copies (.claude/worktrees/, cortextos-worktrees/) are gitignored DUPLICATES of tracked
// files, not NEW senders — the drift-lock catches new senders in the CANONICAL tree; a worktree copy
// would false-positive AND could MASK a real new sender in the noise. (src/telegram/api.ts = the belt
// itself, excluded separately in the raw-send axis only.)
const EXCLUDE_PATH_RE = /node_modules|\/dist\/|\.git\/|(?:^|\/)\.claude\/worktrees\/|(?:^|\/)cortextos-worktrees\/|(?:^|\/)tests\/|\.test\.|test_/;

function rawSendMessageSenders(): string[] {
  let candidates: string[] = [];
  try {
    const out = execSync(`grep -rl 'api.telegram.org' --include='*.ts' --include='*.sh' .`, {
      cwd: REPO, encoding: 'utf-8',
    });
    candidates = out.split('\n').map((s) => s.replace(/^\.\//, '').trim()).filter(Boolean);
  } catch {
    candidates = []; // grep exits non-zero when there are no matches
  }
  return candidates
    .filter((f) => !EXCLUDE_PATH_RE.test(f) && f !== 'src/telegram/api.ts')
    .filter((f) => {
      try {
        return readFileSync(join(REPO, f), 'utf-8').includes('/sendMessage');
      } catch {
        return false;
      }
    })
    .sort();
}

// Axis 2 — wrapper-INDIRECTION. bus/_telegram-curl.sh is a GENERIC poster (`telegram_api_post "${method}"`)
// with NO literal "/sendMessage", so axis-1 (rawSendMessageSenders) cannot see it OR its callers. A future
// operational script that does `source bus/_telegram-curl.sh; telegram_api_post "sendMessage" ...` would
// evade BOTH the in-process belt AND axis-1 — the exact enumeration-gap this guard exists to lock. So
// enumerate the wrapper + every caller against a reviewed allowlist (a NEW caller fails CI).
const WRAPPER_ALLOWLIST: Record<string, string> = {
  'bus/_telegram-curl.sh': 'the generic poster itself (defines telegram_api_post / telegram_api_get).',
  'bus/hook-ask-telegram.sh': 'permission/ask prompt -> the HUMAN (legit human-facing prompt, not an operational bypass).',
  'bus/hook-planmode-telegram.sh': 'plan-review prompt -> the HUMAN (legit human-facing prompt, not an operational bypass).',
};

function wrapperCallers(): string[] {
  let candidates: string[] = [];
  try {
    const out = execSync(
      `grep -rlE '_telegram-curl\\.sh|telegram_api_post|telegram_api_get' --include='*.ts' --include='*.sh' .`,
      { cwd: REPO, encoding: 'utf-8' },
    );
    candidates = out.split('\n').map((s) => s.replace(/^\.\//, '').trim()).filter(Boolean);
  } catch {
    candidates = [];
  }
  return candidates
    .filter((f) => !EXCLUDE_PATH_RE.test(f))
    .sort();
}

describe('telegram raw-sendMessage enumeration-allowlist-guard (goal-3)', () => {
  it('no raw sendMessage send exists outside the reviewed allowlist (new belt-bypass drift-lock)', () => {
    const found = rawSendMessageSenders();
    const allow = Object.keys(ALLOWLIST);
    const rogue = found.filter((f) => !allow.includes(f));
    expect(
      rogue,
      `UNREVIEWED raw sendMessage belt-bypass(es): ${rogue.join(', ')} — route via the belt `
      + `(cortextos bus send-telegram / notify-agent) or add to the ALLOWLIST here with a ruling.`,
    ).toEqual([]);
  });

  it('no wrapper-indirection sender (source _telegram-curl.sh / telegram_api_post) outside the allowlist', () => {
    const found = wrapperCallers();
    const allow = Object.keys(WRAPPER_ALLOWLIST);
    const rogue = found.filter((f) => !allow.includes(f));
    expect(
      rogue,
      `UNREVIEWED wrapper-indirection telegram sender(s): ${rogue.join(', ')} — the generic poster `
      + `bus/_telegram-curl.sh bypasses the in-process belt; route via the belt (cortextos bus send-telegram `
      + `/ notify-agent) or add to the WRAPPER_ALLOWLIST here with a ruling.`,
    ).toEqual([]);
  });

  it('every allowlisted sender still exists (allowlist is not stale)', () => {
    const found = rawSendMessageSenders();
    const missing = Object.keys(ALLOWLIST).filter((f) => !found.includes(f));
    // Informational: a removed sender is safe, but keep the allowlist honest.
    expect(missing, `allowlisted senders no longer present (prune the allowlist): ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('the DORMANT allowlisted senders carry the re-triage annotation (reactivation stays visible)', () => {
    for (const f of ['scripts/self-healing/agent-recover.sh', 'scripts/self-healing/usage-monitor.sh']) {
      const body = readFileSync(join(REPO, f), 'utf-8');
      expect(body, `${f} lost its GOAL-3-ALLOWLIST-DORMANT annotation`).toContain('GOAL-3-ALLOWLIST-DORMANT');
    }
  });

  it('excludes local git-worktree copies from the scan (kills false-positives WITHOUT over-matching real senders)', () => {
    // A worktree COPY of a real sender must be excluded — it is a gitignored duplicate, not a new sender.
    expect(EXCLUDE_PATH_RE.test('.claude/worktrees/agent-x/scripts/self-healing/agent-recover.sh')).toBe(true);
    expect(EXCLUDE_PATH_RE.test('cortextos-worktrees/foo/src/daemon/index.ts')).toBe(true);
    // ...but a REAL canonical-tree sender must STILL be scanned — the exclusion must not over-match.
    expect(EXCLUDE_PATH_RE.test('scripts/self-healing/agent-recover.sh')).toBe(false);
    expect(EXCLUDE_PATH_RE.test('src/daemon/index.ts')).toBe(false);
    expect(EXCLUDE_PATH_RE.test('bus/_telegram-curl.sh')).toBe(false);
    // LEFT-ANCHORED: a non-boundary substring must NOT be excluded (would mask a real sender).
    expect(EXCLUDE_PATH_RE.test('my-cortextos-worktrees/x.sh')).toBe(false);
    expect(EXCLUDE_PATH_RE.test('foo.claude/worktrees/x.sh')).toBe(false);
    // ...and the real repo-root worktree dirs (with a leading path boundary) still ARE excluded.
    expect(EXCLUDE_PATH_RE.test('src/x/.claude/worktrees/w/foo.sh')).toBe(true);
  });

  it('the fixed hooks no longer raw-send (crash-alert -> ops, compact -> suppress+log)', () => {
    for (const f of ['src/hooks/hook-crash-alert.ts', 'src/hooks/hook-compact-telegram.ts']) {
      const body = readFileSync(join(REPO, f), 'utf-8');
      expect(body, `${f} must not raw-send to api.telegram.org (goal-3)`).not.toContain('api.telegram.org');
    }
  });
});
