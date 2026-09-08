import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  analyzeShellQuoteText,
  decideSendGuard,
  detectBusSendCommand,
  formatPreToolUseDecision,
  outputPreToolUseDecision,
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

  it('analyzes ordinary, ANSI-C, and locale shell quote contexts through the shared primitive', () => {
    const ansiSingleQuote = "$'\\''";
    expect(analyzeShellQuoteText("'literal $(id)'")).toEqual({
      finalQuote: null,
      expansionRegion: '',
      balanced: true,
    });
    expect(analyzeShellQuoteText(ansiSingleQuote)).toEqual({
      finalQuote: null,
      expansionRegion: '',
      balanced: true,
    });
    expect(analyzeShellQuoteText(`${ansiSingleQuote}$(id)`).expansionRegion).toContain('$(id)');
    expect(analyzeShellQuoteText('$"locale $(id)"')).toEqual({
      finalQuote: null,
      expansionRegion: 'locale $(id)',
      balanced: true,
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

  it('allows prose or arguments that mention a guarded send with expansion-looking text', () => {
    const cases = [
      'echo cortextos bus send-message a low hello `whoami`',
      'relaying: cortextos bus send-message a low see `code` here',
      'echo Reply using: cortextos bus send-message a low `x`',
      'echo see `code` cortextos bus send-message a low `x`',
      'relaying `foo` cortextos bus send-message a low `x`',
    ];

    for (const command of cases) {
      expect(decideSendGuard(command)).toEqual({ permissionDecision: 'allow' });
      expect(detectBusSendCommand(command)).toBeNull();
    }
  });

  it('still denies the same body text when the send is in command position', () => {
    const cases = [
      'cortextos bus send-message a low hello `whoami`',
      'echo done; cortextos bus send-message a low hello `whoami`',
      '(cortextos bus send-message a low `whoami`)',
      'OUT=`cortextos bus send-message a low hello `whoami``',
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

    expect(decideSendGuard(command)).toMatchObject({ permissionDecision: 'allow' });
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
      .toMatchObject({ permissionDecision: 'allow' });
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
    const originalWrite = process.stdout.write;
    const errors: string[] = [];
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      outputPreToolUseDecision(decideSendGuard('cortextos bus send-message -- claude-dev-agent low "BODY" 2>&1 | tail -2'));
      outputPreToolUseDecision(decideSendGuard('cortextos bus send-message claude-dev-agent low "BODY" 2>&1 | tail -2'));
      outputPreToolUseDecision(decideSendGuard('cortextos bus send-message -- claude-dev-agent low "BODY" >/dev/null 2>&1'));
    } finally {
      console.error = originalError;
      process.stdout.write = originalWrite;
    }

    expect(errors).toHaveLength(6);
    expect(errors.join('\n')).toContain('send-guard: WARN send-message');
    expect(errors.join('\n')).toContain('narrow bus-send-region scan found no command-substitution forms');
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
    const originalWrite = process.stdout.write;
    const errors: string[] = [];
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      const decision = decideSendGuard('cortextos bus send-message claude-dev-agent normal "unterminated');
      expect(decision).toMatchObject({ permissionDecision: 'allow', allowReason: 'region-indeterminate' });
      outputPreToolUseDecision(decision);
    } finally {
      console.error = originalError;
      process.stdout.write = originalWrite;
    }

    expect(errors.join('\n')).toContain('send-guard: ALLOW send-message');
    expect(errors.join('\n')).toContain('bus-send region indeterminate');
  });

  it('denies an indeterminate guarded region when its raw text contains shell expansion syntax', () => {
    expect(decideSendGuard('cortextos bus send-message claude-dev-agent normal "unterminated $(id)'))
      .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
  });

  it('allows and logs when another command follows on the next line', () => {
    const originalError = console.error;
    const originalWrite = process.stdout.write;
    const errors: string[] = [];
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    process.stdout.write = (() => true) as typeof process.stdout.write;

    try {
      const decision = decideSendGuard('cortextos bus send-message claude-dev-agent normal "BODY"\necho done');
      expect(decision).toMatchObject({
        permissionDecision: 'allow',
        allowReason: 'compound-unparseable-region-clean',
        chained: true,
      });
      outputPreToolUseDecision(decision);
    } finally {
      console.error = originalError;
      process.stdout.write = originalWrite;
    }

    expect(errors.join('\n')).toContain('send-guard: WARN send-message');
    expect(errors.join('\n')).toContain('narrow bus-send-region scan found no command-substitution forms');
  });

  it('formats the correct PreToolUse hookSpecificOutput shape', () => {
    expect(formatPreToolUseDecision({ permissionDecision: 'allow' })).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    });

    expect(formatPreToolUseDecision({
      permissionDecision: 'allow',
      allowReason: 'compound-unparseable-region-clean',
      chained: true,
    })).toEqual({
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

describe('hook-send-guard compound-command fail-open (Option B narrow-scan)', () => {
  it('denies a backtick body when a semicolon-chained command follows (the proven T2 repro)', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "body `git branch -f main X`" ; echo x'))
      .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
  });

  it('denies a $(...) body when piped to another command', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "body $(git branch -f main X)" | cat'))
      .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
  });

  it('denies a backtick body when && chains a following command', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "b `id`" && echo done'))
      .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
  });

  it('denies a $(...) body followed by a # comment', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "b $(id)" # note'))
      .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
  });

  it('denies a backtick body on a multi-line command (newline operator)', () => {
    expect(decideSendGuard("cortextos bus send-message a normal \"b `id`\"\necho next"))
      .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
  });

  it('denies process-substitution <(...) in the body on a compound line', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "b <(cat x)" ; true'))
      .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
  });

  it('allows a plain body even when && chains a following command', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "plain body" && echo done'))
      .toMatchObject({
        permissionDecision: 'allow',
        allowReason: 'compound-unparseable-region-clean',
        chained: true,
      });
  });

  it('allows when a backtick lives in an earlier command before the send (out of the bus-send region)', () => {
    expect(decideSendGuard('X=`date` ; cortextos bus send-message a normal "plain body"'))
      .toMatchObject({
        permissionDecision: 'allow',
        allowReason: 'compound-unparseable-region-clean',
        chained: true,
      });
  });

  it('allows a body that mentions the word backtick as prose on a compound line', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "use a backtick carefully" && true'))
      .toMatchObject({
        permissionDecision: 'allow',
        allowReason: 'compound-unparseable-region-clean',
        chained: true,
      });
  });

  it('allows a non-bus command containing a backtick (pass-through, out of scope)', () => {
    expect(decideSendGuard('echo `date`'))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('still denies a backtick body with no trailing operator (do not regress T1)', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "b `id`"'))
      .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
  });

  it('still allows a plain body with no operator', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "plain"'))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('still allows a bare double-quoted variable-reference body', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "$BODY"'))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('still denies an unquoted variable-reference body', () => {
    expect(decideSendGuard('cortextos bus send-message a normal $BODY'))
      .toEqual({ permissionDecision: 'deny', permissionDecisionReason: UNQUOTED_BODY_DENY_REASON });
  });

  it('allows a single-quoted body containing a backtick on a compound line', () => {
    expect(decideSendGuard("cortextos bus send-message a normal 'run `date`' && echo ok"))
      .toMatchObject({
        permissionDecision: 'allow',
        allowReason: 'compound-unparseable-region-clean',
        chained: true,
      });
  });

  it('surfaces structured allow metadata for clean chained bus sends', () => {
    expect(decideSendGuard('cortextos bus send-message a normal "plain body" && echo done'))
      .toMatchObject({
        permissionDecision: 'allow',
        allowReason: 'compound-unparseable-region-clean',
        chained: true,
      });
  });

  it('emits warn and affirmative allow logs from structured metadata while stdout remains hook-shaped', () => {
    const originalError = console.error;
    const originalWrite = process.stdout.write;
    const errors: string[] = [];
    const writes: string[] = [];
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      outputPreToolUseDecision(decideSendGuard('cortextos bus send-message a normal "plain body" && echo done'));
    } finally {
      console.error = originalError;
      process.stdout.write = originalWrite;
    }

    expect(errors.join('\n')).toContain('send-guard: WARN send-message');
    expect(errors.join('\n')).toContain('send-guard: ALLOW send-message');
    expect(errors.join('\n')).toContain('narrow bus-send-region scan found no command-substitution forms');
    expect(JSON.parse(writes.join(''))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    });
  });

  it('uses an honest allow reason when the guarded bus-send region cannot be parsed', () => {
    const originalError = console.error;
    const originalWrite = process.stdout.write;
    const errors: string[] = [];
    const writes: string[] = [];
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const decision = decideSendGuard('cortextos bus send-message"extra" a normal "plain" && echo done');
      expect(decision).toMatchObject({
        permissionDecision: 'allow',
        allowReason: 'region-unparseable',
        chained: true,
      });
      outputPreToolUseDecision(decision);
    } finally {
      console.error = originalError;
      process.stdout.write = originalWrite;
    }

    expect(errors.join('\n')).toContain('send-guard: WARN send-message');
    expect(errors.join('\n')).toContain('bus-send region could not be parsed');
    expect(errors.join('\n')).not.toContain('narrow bus-send-region scan found no command-substitution forms');
    expect(JSON.parse(writes.join(''))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
      },
    });
  });

  describe('region-unparseable fail-safe deny (Item 3)', () => {
    it('denies a dollar-paren substitution glued to the subcommand name (unquoted)', () => {
      expect(decideSendGuard('cortextos bus send-message$(id) a normal "plain" && echo done'))
        .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
    });

    it('denies a dollar-paren substitution glued to the subcommand name (double-quoted, still executes)', () => {
      expect(decideSendGuard('cortextos bus send-message"$(id)" a normal "plain"'))
        .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
    });

    it('denies a backtick substitution glued to the subcommand name', () => {
      expect(decideSendGuard('cortextos bus send-message`id` a normal "plain" ; true'))
        .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
    });

    it('allows an unparseable region that has no substitution form (honest region-unparseable path preserved)', () => {
      expect(decideSendGuard('cortextos bus send-message"extra" a normal "plain" && echo done'))
        .toMatchObject({ permissionDecision: 'allow', allowReason: 'region-unparseable', chained: true });
    });

    it('allows a single-quoted substitution glued to the name (single quotes suppress execution)', () => {
      expect(decideSendGuard("cortextos bus send-message'$(id)' a normal \"plain\""))
        .toMatchObject({ permissionDecision: 'allow', allowReason: 'region-unparseable' });
    });
  });

  describe('ANSI-C quote desync backstop', () => {
    const ansiSingleQuote = "$'\\''";

    it('denies command substitution after a balanced ANSI-C quoted literal single quote', () => {
      expect(decideSendGuard(`cortextos bus send-message a normal ${ansiSingleQuote} "$(id)"`))
        .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
    });

    it('denies command substitution glued after a balanced ANSI-C quoted literal single quote', () => {
      expect(decideSendGuard(`cortextos bus send-message a normal ${ansiSingleQuote}$(id)`))
        .toEqual({ permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON });
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
