import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  decideSendGuard,
  detectBusSendCommand,
  formatPreToolUseDecision,
  OPTION_AFTER_SEPARATOR_DENY_REASON,
  SHELL_EXPANSION_DENY_REASON,
  UNQUOTED_BODY_DENY_REASON,
} from '../../../src/hooks/hook-send-guard';

const AGENT = 'codex-dev-agent';
const INFLIGHT_ID = '2000000000000-claude-dev-agent-abc12';
const PROCESSED_ID = '2000000000100-the-orchestrator-def34';
const ABSENT_ID = '2000000000200-claude-dev-agent-miss5';
const OLD_PRUNED_ID = '1999999999000-claude-dev-agent-old99';
const NEWER_RETAINED_ID = '2000000000001-claude-dev-agent-newer';

function sendMessageCommand(replyTo?: string): string {
  const suffix = replyTo ? ` ${replyTo}` : '';
  return `cortextos bus send-message claude-dev-agent normal 'hello there'${suffix}`;
}

function writeMessage(dir: string, id: string): void {
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, text: 'hello' }), 'utf-8');
}

describe('hook-send-guard command checks', () => {
  let ctxRoot: string;
  let inflight: string;
  let processed: string;

  beforeEach(() => {
    ctxRoot = mkdtempSync(join(tmpdir(), 'send-guard-'));
    inflight = join(ctxRoot, 'inflight', AGENT);
    processed = join(ctxRoot, 'processed', AGENT);
    mkdirSync(inflight, { recursive: true });
    mkdirSync(processed, { recursive: true });
    writeMessage(inflight, INFLIGHT_ID);
    writeMessage(processed, PROCESSED_ID);
    writeMessage(processed, NEWER_RETAINED_ID);
  });

  afterEach(() => {
    rmSync(ctxRoot, { recursive: true, force: true });
  });

  it('denies shell expansion syntax in a double-quoted send-message body', () => {
    const decision = decideSendGuard('cortextos bus send-message claude-dev-agent normal "run $(date)"');

    expect(decision).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: SHELL_EXPANSION_DENY_REASON,
    });
  });

  it('denies dollar-brace, backtick, arithmetic, and process-substitution syntax in the body argument', () => {
    const cases = [
      'cortextos bus send-message claude-dev-agent normal "home ${HOME}"',
      'cortextos bus send-message claude-dev-agent normal "run `date`"',
      'cortextos bus send-message claude-dev-agent normal "math $((1+1))"',
      'cortextos bus send-message claude-dev-agent normal "proc <(cat file)"',
      'cortextos bus send-message claude-dev-agent normal $(date)',
      'cortextos bus send-message claude-dev-agent normal ${HOME}',
      'cortextos bus send-message claude-dev-agent normal `date`',
    ];

    for (const command of cases) {
      expect(decideSendGuard(command)).toEqual({
        permissionDecision: 'deny',
        permissionDecisionReason: SHELL_EXPANSION_DENY_REASON,
      });
    }
  });

  it('denies shell expansion syntax in any unquoted body token, not just the first body token', () => {
    const cases = [
      'cortextos bus send-message claude-dev-agent normal hello $(date)',
      'cortextos bus send-telegram 123 hello $(whoami)',
      'cortextos bus send-message claude-dev-agent normal hello `whoami`',
      'cortextos bus send-message claude-dev-agent normal hello ${HOME}',
      'cortextos bus send-message claude-dev-agent normal one two $(date) three',
    ];

    for (const command of cases) {
      expect(decideSendGuard(command)).toEqual({
        permissionDecision: 'deny',
        permissionDecisionReason: SHELL_EXPANSION_DENY_REASON,
      });
    }
  });

  it('allows a quoted heredoc body passed as a double-quoted variable reference', () => {
    const command = `BODY=$(cat <<'CG_HEREDOC_7f3a91c4_END'
customer copy with \`backticks\`
literal $(date), \${HOME}, $267, and <(cat file)
CG_HEREDOC_7f3a91c4_END
)
cortextos bus send-message claude-dev-agent normal "$BODY"`;

    expect(decideSendGuard(command)).toEqual({ permissionDecision: 'allow' });
  });

  it('allows literal backticks when they are single-quoted in the body argument', () => {
    expect(decideSendGuard("cortextos bus send-message claude-dev-agent normal 'run `date`'"))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows quoted leading-dash bodies without treating them as malformed reply_to tokens', () => {
    expect(decideSendGuard("cortextos bus send-message -- claude-dev-agent normal '--- markdown hr'"))
      .toEqual({ permissionDecision: 'allow' });
    expect(decideSendGuard('cortextos bus send-message claude-dev-agent normal "--- markdown hr"'))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows quoted body content containing arrows and greater-than characters', () => {
    expect(decideSendGuard('cortextos bus send-message claude-dev-agent normal "default -> 324 ads, with flag -> 339 ads"'))
      .toEqual({ permissionDecision: 'allow' });
    expect(decideSendGuard('cortextos bus send-message claude-dev-agent normal "threshold > baseline"'))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('denies option-shaped tokens after the -- operand separator', () => {
    const cases = [
      'cortextos bus add-cron -- codex-dev-agent inbox-sweep 15m --reply-to',
    ];

    for (const command of cases) {
      expect(decideSendGuard(command, { ctxRoot, agentName: AGENT })).toEqual({
        permissionDecision: 'deny',
        permissionDecisionReason: OPTION_AFTER_SEPARATOR_DENY_REASON,
      });
    }
  });

  it('does not deny option-shaped tokens after -- on non-silent-risk commands', () => {
    expect(decideSendGuard('cortextos bus create-task -- title --desc'))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows options before -- and operands after --', () => {
    expect(decideSendGuard(
      `cortextos bus send-message --reply-to ${INFLIGHT_ID} -- claude-dev-agent normal "$BODY"`,
      { ctxRoot, agentName: AGENT },
    )).toEqual({ permissionDecision: 'allow' });
  });

  it('does not inspect option-shaped send-message reply_to operands after --', () => {
    expect(decideSendGuard('cortextos bus send-message -- claude-dev-agent low "BODY" --reply-to'))
      .toEqual({ permissionDecision: 'allow' });
    expect(decideSendGuard(`cortextos bus send-message -- claude-dev-agent low "BODY" --reply-to ${INFLIGHT_ID}`))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows and logs bus sends with shell operators after the command instead of deriving operands from them', () => {
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };

    try {
      expect(decideSendGuard('cortextos bus send-message -- claude-dev-agent low "BODY" 2>&1 | tail -2'))
        .toEqual({ permissionDecision: 'allow' });
      expect(decideSendGuard('cortextos bus send-message claude-dev-agent low "BODY" 2>&1 | tail -2'))
        .toEqual({ permissionDecision: 'allow' });
      expect(decideSendGuard('cortextos bus send-message -- claude-dev-agent low "BODY" >/dev/null 2>&1'))
        .toEqual({ permissionDecision: 'allow' });
    } finally {
      console.error = originalError;
    }

    expect(errors).toHaveLength(3);
    expect(errors.join('\n')).toContain('shell syntax after the guarded bus command');
  });

  it('allows plain -- send-message calls without shell operators', () => {
    expect(decideSendGuard('cortextos bus send-message -- claude-dev-agent low "BODY"'))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows dollar amounts in single-quoted body arguments', () => {
    expect(decideSendGuard("cortextos bus send-message claude-dev-agent normal 'nCAC was $267 and cap $2,275'"))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows shell-safe single-quoted bodies assembled around escaped apostrophes', () => {
    const command = "cortextos bus send-message claude-dev-agent normal 'Adam'\\''s note said $267 and `literal`'";
    expect(decideSendGuard(command)).toEqual({ permissionDecision: 'allow' });
  });

  it('allows multi-line single-quoted body arguments without fail-open logging', () => {
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };

    try {
      expect(decideSendGuard("cortextos bus send-message claude-dev-agent normal 'line one\n$267 and `literal`\nline three'"))
        .toEqual({ permissionDecision: 'allow' });
    } finally {
      console.error = originalError;
    }

    expect(errors).toEqual([]);
  });

  it('does not inspect cortextos-looking text inside a quoted body as a command', () => {
    const command = "cortextos bus send-message claude-dev-agent normal 'example: cortextos bus send-message a normal \"raw $(date)\"'";
    expect(decideSendGuard(command)).toEqual({ permissionDecision: 'allow' });
  });

  it('denies an unquoted variable reference as the body argument', () => {
    expect(decideSendGuard('cortextos bus send-message claude-dev-agent normal $BODY')).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: UNQUOTED_BODY_DENY_REASON,
    });
  });

  it('allows send-message commands without backticks and without reply_to', () => {
    expect(decideSendGuard(sendMessageCommand())).toEqual({ permissionDecision: 'allow' });
  });

  it('does not validate reply_to ids in the hook layer', () => {
    expect(decideSendGuard(sendMessageCommand(INFLIGHT_ID), { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
    expect(decideSendGuard(sendMessageCommand(ABSENT_ID), { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
    expect(decideSendGuard(`${sendMessageCommand()} not-a-message-id`, { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
    expect(decideSendGuard(`${sendMessageCommand()} --reply-to=the-orchestrator`, { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('denies expansion syntax in guarded sends that are not at command-string start', () => {
    const cases = [
      'OUT=$(cortextos bus send-message claude-dev-agent normal "run $(date)")',
      'true && cortextos bus send-message claude-dev-agent normal "run $(date)"',
    ];

    for (const command of cases) {
      expect(decideSendGuard(command)).toEqual({
        permissionDecision: 'deny',
        permissionDecisionReason: SHELL_EXPANSION_DENY_REASON,
      });
    }
  });

  it('allows when reply_to is absent', () => {
    expect(decideSendGuard(sendMessageCommand(), { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows non-bus-send Bash commands as pass-through', () => {
    expect(decideSendGuard('echo `date`')).toEqual({ permissionDecision: 'allow' });
  });

  it('denies send-telegram with double-quoted expansion syntax but does not reply_to lint send-telegram', () => {
    expect(decideSendGuard('cortextos bus send-telegram 123 "hello $(date)"')).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: SHELL_EXPANSION_DENY_REASON,
    });

    expect(decideSendGuard(`cortextos bus send-telegram 123 'hello' ${ABSENT_ID}`, { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('guards higher-frequency bus body flags and positionals', () => {
    const denied = [
      'cortextos bus create-task title --desc "raw $(date)"',
      'cortextos bus complete-task task_123 --result "raw $(date)"',
      'cortextos bus complete-task task_123 "raw $(date)"',
      'cortextos bus log-event action event info --meta "raw $(date)"',
      'cortextos bus update-heartbeat "raw $(date)"',
      'cortextos bus create-approval title other "raw $(date)"',
    ];

    for (const command of denied) {
      expect(decideSendGuard(command)).toEqual({
        permissionDecision: 'deny',
        permissionDecisionReason: SHELL_EXPANSION_DENY_REASON,
      });
    }
  });

  it('denies unquoted variable references in named body flags', () => {
    expect(decideSendGuard('cortextos bus create-task title --desc=$BODY')).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: UNQUOTED_BODY_DENY_REASON,
    });
  });

  it('allows named body flags when passed as double-quoted variable references', () => {
    expect(decideSendGuard('cortextos bus create-task title --desc="$BODY"'))
      .toEqual({ permissionDecision: 'allow' });
    expect(decideSendGuard('cortextos bus complete-task task_123 --result "$BODY"'))
      .toEqual({ permissionDecision: 'allow' });
    expect(decideSendGuard('cortextos bus log-event action event info --meta="$BODY"'))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows and logs when a guarded command body cannot be confidently parsed', () => {
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };

    try {
      expect(decideSendGuard('cortextos bus send-message claude-dev-agent normal "unterminated'))
        .toEqual({ permissionDecision: 'allow' });
    } finally {
      console.error = originalError;
    }

    expect(errors.join('\n')).toContain('send-guard: allowing send-message');
  });

  it('allows and logs when another command follows on the next line', () => {
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };

    try {
      expect(decideSendGuard('cortextos bus send-message claude-dev-agent normal "BODY"\necho done'))
        .toEqual({ permissionDecision: 'allow' });
    } finally {
      console.error = originalError;
    }

    expect(errors.join('\n')).toContain('shell syntax after the guarded bus command');
  });

  it('formats the correct PreToolUse hookSpecificOutput shape', () => {
    expect(formatPreToolUseDecision({ permissionDecision: 'allow' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    });

    expect(formatPreToolUseDecision({
      permissionDecision: 'deny',
      permissionDecisionReason: 'nope',
    })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'nope',
      },
    });
  });
});

// The pre-index-scan matcher was /(?:^|[;&|]\s*)cortextos\s+bus\s+(send-...)/ with
// no `m` flag, so its real discriminator was POSITION, not syntax: a send only
// matched at offset 0 or straight after a ; & | -- which made it miss every real
// send that was indented or nested, AND fire on prose that merely happened to sit
// after a separator inside quotes. One matcher, both errors, exactly inverted.
// Each case below is chosen to DIVERGE between the two builds. Shapes that agree
// on both (e.g. space-preceded prose) are deliberately marked as baselines only:
// they cannot prove anything about the matcher, and are here to fail loudly if
// detection stops working wholesale.
describe('detectBusSendCommand shape matrix', () => {
  const SEND = `cortextos bus send-telegram 123 'hello'`;

  describe('fail-open half: real sends that are not at a separator MUST be inspected', () => {
    const REAL: Array<[string, string]> = [
      ['indented 4 spaces', `    ${SEND}`],
      ['indented 1 tab', `\t${SEND}`],
      ['command substitution', `OUT=$(${SEND})`],
      ['if-guard form', `if ! ${SEND}; then :; fi`],
      ['backtick capture', 'OUT=`' + SEND + '`'],
    ];
    it.each(REAL)('detects a real send: %s', (_name, command) => {
      expect(detectBusSendCommand(command)).not.toBeNull();
    });
  });

  describe('fail-closed half: prose ABOUT a send MUST NOT be inspected', () => {
    // These assert a NON-detection and so read like they test nothing. They are
    // the guard against a fix that widens the matcher without teaching it where
    // quoted regions are -- that fix would close the fail-open and keep the
    // false blocks, which is how the guard blocked two agents' measurements.
    const PROSE: Array<[string, string]> = [
      ['semicolon before send, double-quoted', `echo "step 1; ${SEND}"`],
      ['semicolon before send, single-quoted', `echo 'step 1; ${SEND}'`],
      ['pipe before send, double-quoted', `echo "a | ${SEND}"`],
      ['ampersand before send, double-quoted', `echo "a & ${SEND}"`],
    ];
    it.each(PROSE)('ignores prose: %s', (_name, command) => {
      expect(detectBusSendCommand(command)).toBeNull();
    });
  });

  describe('baselines and negative controls (agree on both builds)', () => {
    it('detects a plain send', () => {
      expect(detectBusSendCommand(SEND)).not.toBeNull();
    });

    it('detects a send after a real semicolon', () => {
      expect(detectBusSendCommand(`echo x; ${SEND}`)).not.toBeNull();
    });

    it('ignores an unrelated command', () => {
      expect(detectBusSendCommand('ls -la /tmp')).toBeNull();
    });

    it('ignores prose whose send is merely space-preceded', () => {
      expect(detectBusSendCommand(`echo "run ${SEND} later"`)).toBeNull();
    });
  });
});
