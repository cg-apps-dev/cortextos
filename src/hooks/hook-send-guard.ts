/**
 * hook-send-guard.ts - PreToolUse hook for Bash cortextos bus commands.
 *
 * Blocks clear failure modes at safely parseable bus call sites:
 * - shell expansion syntax in inlined body arguments
 * - unquoted variable body arguments
 * - option-shaped tokens after -- for commands with silent optional/variadic tails
 */

import { parseHookInput, readStdin } from './index.js';

const BODY_GUARDED_BUS_COMMANDS = [
  'send-message',
  'send-telegram',
  'create-task',
  'complete-task',
  'log-event',
  'update-heartbeat',
  'create-approval',
] as const;

const OPTION_AFTER_SEPARATOR_RISK_COMMANDS = [
  'add-cron',
  'answer-callback',
  'complete-task',
  'create-approval',
  'edit-message',
  'get-cron-log',
  'migrate-crons',
  'react-telegram',
  'run-experiment',
  'send-mobile-reply',
  'soft-restart',
  'update-approval',
  'upgrade-cron-teaching',
  'kb-ingest',
  'check-usage-api',
  'register-telegram-commands',
] as const;

const GUARDED_BUS_COMMANDS = [
  ...new Set<string>([
    ...BODY_GUARDED_BUS_COMMANDS,
    ...OPTION_AFTER_SEPARATOR_RISK_COMMANDS,
  ]),
] as const;

type GuardedBusCommand = typeof GUARDED_BUS_COMMANDS[number];

export const SHELL_EXPANSION_DENY_REASON =
  'send-guard: shell expansion syntax inside an inlined bus body can execute commands or silently corrupt text before cortextos receives it. Put the body in a quoted heredoc with a long quoted delimiter, then pass it as a double-quoted variable reference like "$BODY".';

export const UNQUOTED_BODY_DENY_REASON =
  'send-guard: unquoted bus body references can be split or glob-expanded by the shell before cortextos receives them. Pass the body as a double-quoted variable reference like "$BODY".';

export const OPTION_AFTER_SEPARATOR_DENY_REASON =
  'send-guard: option-shaped tokens after -- are parsed as operands, not options, and can silently create malformed recurring instructions or reply_to/threading values. Put all options before --; put only operands after --.';

interface ShellToken {
  raw: string;
  expansionRegion: string;
}

type ShellQuote = 'single' | 'ansi-c-single' | 'double' | 'locale-double';

interface ShellQuoteStep {
  text: string;
  quote: ShellQuote | null;
  nextQuote: ShellQuote | null;
  nextIndex: number;
  expandable: boolean;
}

export interface ShellQuoteAnalysis {
  finalQuote: ShellQuote | null;
  expansionRegion: string;
  balanced: boolean;
}

export interface SendCommandInfo {
  kind: GuardedBusCommand;
  bodyArg?: ShellToken;
  bodyArgs?: ShellToken[];
  optionAfterSeparatorArg?: ShellToken;
  bodyStatus: 'found' | 'not-found' | 'unparseable' | 'not-applicable';
  chainedWithOtherCommand: boolean;
  guardedRegion?: string;
  unparseableReason?: string;
}

export type SendGuardDecision =
  | {
      permissionDecision: 'allow';
      kind?: GuardedBusCommand;
      allowReason?: 'compound-unparseable-region-clean' | 'region-indeterminate' | 'region-unparseable' | 'body-not-found';
      chained?: true;
    }
  | {
      permissionDecision: 'deny';
      permissionDecisionReason: string;
      kind?: GuardedBusCommand;
      chained?: true;
    };

type HookDecisionOutput = { permissionDecision: 'allow' } | { permissionDecision: 'deny'; permissionDecisionReason: string };

export function formatPreToolUseDecision(decision: SendGuardDecision): {
  hookSpecificOutput: { hookEventName: 'PreToolUse' } & HookDecisionOutput;
} {
  const hookDecision: HookDecisionOutput = decision.permissionDecision === 'deny'
    ? {
        permissionDecision: 'deny',
        permissionDecisionReason: decision.permissionDecisionReason,
      }
    : { permissionDecision: 'allow' };

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      ...hookDecision,
    },
  };
}

export function outputPreToolUseDecision(decision: SendGuardDecision): void {
  emitDecisionLogs(decision);
  process.stdout.write(JSON.stringify(formatPreToolUseDecision(decision)) + '\n');
}

export function detectBusSendCommand(command: string): SendCommandInfo | null {
  const parsed = findGuardedBusCommand(command);
  if (!parsed) return null;
  const bodyArgs = isBodyGuardedCommand(parsed.kind)
    ? extractGuardedBodyArgs(parsed.kind, parsed.args)
    : undefined;

  return {
    kind: parsed.kind,
    bodyArg: bodyArgs?.[0],
    bodyArgs,
    optionAfterSeparatorArg: isOptionAfterSeparatorRiskCommand(parsed.kind)
      ? findOptionAfterSeparatorArg(parsed.args)
      : undefined,
    chainedWithOtherCommand: parsed.chainedWithOtherCommand,
    guardedRegion: parsed.guardedRegion,
    unparseableReason: parsed.unparseableReason,
    bodyStatus: !isBodyGuardedCommand(parsed.kind)
      ? 'not-applicable'
      : parsed.args === null
        ? 'unparseable'
        : bodyArgs === undefined || bodyArgs.length === 0
          ? 'not-found'
          : 'found',
  };
}

function nextShellQuoteStep(text: string, index: number, quote: ShellQuote | null): ShellQuoteStep {
  const ch = text[index];
  const next = text[index + 1];

  if (quote === null) {
    if (ch === '$' && next === "'") {
      return { text: text.slice(index, index + 2), quote, nextQuote: 'ansi-c-single', nextIndex: index + 2, expandable: false };
    }
    if (ch === '$' && next === '"') {
      return { text: text.slice(index, index + 2), quote, nextQuote: 'locale-double', nextIndex: index + 2, expandable: false };
    }
    if (ch === "'") {
      return { text: ch, quote, nextQuote: 'single', nextIndex: index + 1, expandable: false };
    }
    if (ch === '"') {
      return { text: ch, quote, nextQuote: 'double', nextIndex: index + 1, expandable: false };
    }
    if (ch === '\\' && index + 1 < text.length) {
      return { text: text.slice(index, index + 2), quote, nextQuote: quote, nextIndex: index + 2, expandable: true };
    }
    return { text: ch, quote, nextQuote: quote, nextIndex: index + 1, expandable: true };
  }

  if (quote === 'single') {
    return {
      text: ch,
      quote,
      nextQuote: ch === "'" ? null : quote,
      nextIndex: index + 1,
      expandable: false,
    };
  }

  if (quote === 'ansi-c-single') {
    if (ch === '\\' && index + 1 < text.length) {
      return { text: text.slice(index, index + 2), quote, nextQuote: quote, nextIndex: index + 2, expandable: false };
    }
    return {
      text: ch,
      quote,
      nextQuote: ch === "'" ? null : quote,
      nextIndex: index + 1,
      expandable: false,
    };
  }

  if (ch === '\\' && index + 1 < text.length) {
    return { text: text.slice(index, index + 2), quote, nextQuote: quote, nextIndex: index + 2, expandable: true };
  }

  return {
    text: ch,
    quote,
    nextQuote: ch === '"' ? null : quote,
    nextIndex: index + 1,
    expandable: ch !== '"',
  };
}

export function analyzeShellQuoteText(text: string, initialQuote: ShellQuote | null = null): ShellQuoteAnalysis {
  let quote = initialQuote;
  let expansionRegion = '';

  for (let i = 0; i < text.length;) {
    const step = nextShellQuoteStep(text, i, quote);
    if (step.expandable) expansionRegion += step.text;
    quote = step.nextQuote;
    i = step.nextIndex;
  }

  return {
    finalQuote: quote,
    expansionRegion,
    balanced: quote === null,
  };
}

function stripHeredocBodies(command: string): string {
  const lines = command.split('\n');
  const output: string[] = [];
  let quote: ShellQuote | null = null;
  for (let i = 0; i < lines.length; i++) {
    output.push(lines[i]);
    const heredocMatch = findHeredocOperator(lines[i], quote);
    quote = updateQuoteState(lines[i], quote);
    if (!heredocMatch) continue;

    const stripTabs = Boolean(heredocMatch[1]);
    const delimiter = heredocMatch[2] ?? heredocMatch[3] ?? heredocMatch[4];
    if (!delimiter) continue;

    i++;
    for (; i < lines.length; i++) {
      const candidate = stripTabs ? lines[i].replace(/^\t+/, '') : lines[i];
      if (candidate === delimiter) {
        output.push(lines[i]);
        break;
      }
    }
  }
  return output.join('\n');
}

function findHeredocOperator(line: string, initialQuote: ShellQuote | null): RegExpMatchArray | null {
  let quote = initialQuote;
  for (let i = 0; i < line.length;) {
    const ch = line[i];
    if (!quote && ch === '<' && line[i + 1] === '<') {
      return line.slice(i).match(/^<<(-)?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_:-]+))/);
    }
    const step = nextShellQuoteStep(line, i, quote);
    quote = step.nextQuote;
    i = step.nextIndex;
  }
  return null;
}

function updateQuoteState(line: string, initialQuote: ShellQuote | null): ShellQuote | null {
  return analyzeShellQuoteText(line, initialQuote).finalQuote;
}

function tokenizeShellLine(line: string): ShellToken[] | null {
  const tokens: ShellToken[] = [];
  let i = 0;

  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (line[i] === ')') break;
    if (i >= line.length) break;

    let raw = '';
    let quote: ShellQuote | null = null;
    while (i < line.length) {
      const ch = line[i];
      if (!quote && /\s/.test(ch)) break;
      if (!quote && ch === ')') break;

      const step = nextShellQuoteStep(line, i, quote);
      raw += step.text;
      quote = step.nextQuote;
      i = step.nextIndex;
    }

    if (quote) return null;
    if (raw) tokens.push({ raw, expansionRegion: expansionRegionForShellText(raw) });
  }

  return tokens;
}

function expansionRegionForShellText(line: string): string {
  return analyzeShellQuoteText(line).expansionRegion;
}

function isBodyGuardedCommand(raw: string): raw is typeof BODY_GUARDED_BUS_COMMANDS[number] {
  return (BODY_GUARDED_BUS_COMMANDS as readonly string[]).includes(raw);
}

function isOptionAfterSeparatorRiskCommand(raw: string): raw is typeof OPTION_AFTER_SEPARATOR_RISK_COMMANDS[number] {
  return (OPTION_AFTER_SEPARATOR_RISK_COMMANDS as readonly string[]).includes(raw);
}

function isGuardedBusCommand(raw: string): raw is GuardedBusCommand {
  return (GUARDED_BUS_COMMANDS as readonly string[]).includes(raw);
}

function findGuardedBusCommand(command: string): {
  kind: GuardedBusCommand;
  args: string[] | null;
  chainedWithOtherCommand: boolean;
  guardedRegion: string;
  unparseableReason?: string;
} | null {
  const withoutHeredocBodies = stripHeredocBodies(command);
  const start = findGuardedCommandStart(withoutHeredocBodies);
  if (!start) return null;
  const commandSlice = withoutHeredocBodies.slice(start.index);
  const boundary = findFirstUnquotedShellOperatorIndex(commandSlice);
  const guardedRegion = boundary.index === null ? commandSlice : commandSlice.slice(0, boundary.index);
  const chainedWithOtherCommand = boundary.index !== null || hasUnquotedShellOperatorBeforeIndex(withoutHeredocBodies, start.index);

  const tokens = tokenizeShellLine(guardedRegion);
  if (tokens && tokens.length >= 3 && tokens[0].raw === 'cortextos' && tokens[1].raw === 'bus' && isGuardedBusCommand(tokens[2].raw)) {
    return {
      kind: tokens[2].raw,
      args: tokens.slice(3).map(token => `${token.raw}\0${token.expansionRegion}`),
      chainedWithOtherCommand,
      guardedRegion,
    };
  }

  return {
    kind: start.kind,
    args: null,
    chainedWithOtherCommand,
    guardedRegion,
    unparseableReason: boundary.quote
      ? 'bus-send region indeterminate (unbalanced quotes); could not scan'
      : 'command line unparseable by full tokenizer; narrow bus-send-region scan could not parse the guarded invocation',
  };
}

function findGuardedCommandStart(command: string): { kind: GuardedBusCommand; index: number } | null {
  let quote: ShellQuote | null = null;
  for (let i = 0; i < command.length;) {
    if (!quote && command.startsWith('cortextos', i) && isCommandPosition(command, i)) {
      const match = command.slice(i).match(/^cortextos\s+bus\s+([A-Za-z0-9-]+)/);
      if (match && isGuardedBusCommand(match[1])) {
        return { kind: match[1], index: i };
      }
    }

    const step = nextShellQuoteStep(command, i, quote);
    quote = step.nextQuote;
    i = step.nextIndex;
  }
  return null;
}

function isCommandPosition(command: string, index: number): boolean {
  let j = index - 1;
  while (j >= 0 && /[ \t\r]/.test(command[j])) j--;
  if (j < 0) return true;
  const ch = command[j];
  if (ch === '\n' || ch === ';' || ch === '|' || ch === '&' || ch === '(') return true;
  if (ch === '!') return true;
  if (ch === '`') return j === index - 1;
  return ch === '(' && j > 0 && command[j - 1] === '$';
}

export function findFirstUnquotedShellOperatorIndex(command: string): { index: number | null; quote: ShellQuote | null } {
  let quote: ShellQuote | null = null;
  for (let i = 0; i < command.length;) {
    const ch = command[i];
    if (!quote) {
      if (ch === '\n') return { index: i, quote };
      if (ch === '#') return { index: i, quote };
      if (ch === '|' || ch === ';' || ch === '&') return { index: i, quote };
      if ((ch === '>' || ch === '<') && command[i + 1] !== '(') return { index: i, quote };
    }
    const step = nextShellQuoteStep(command, i, quote);
    quote = step.nextQuote;
    i = step.nextIndex;
  }
  return { index: null, quote };
}

function hasUnquotedShellOperatorBeforeIndex(command: string, endIndex: number): boolean {
  return findFirstUnquotedShellOperatorIndex(command.slice(0, endIndex)).index !== null;
}

function splitToken(raw: string): ShellToken {
  const [tokenRaw, expansionRegion = raw] = raw.split('\0');
  return { raw: tokenRaw, expansionRegion };
}

function tokenRaw(arg: string): string {
  return splitToken(arg).raw;
}

function flagValue(args: string[], flag: string): ShellToken | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = tokenRaw(args[i]);
    if (arg === flag) return args[i + 1] ? splitToken(args[i + 1]) : undefined;
    if (arg.startsWith(`${flag}=`)) {
      const token = splitToken(args[i]);
      return {
        raw: token.raw.slice(flag.length + 1),
        expansionRegion: token.expansionRegion.slice(flag.length + 1),
      };
    }
  }
  return undefined;
}

function positionalArgs(args: string[], valueFlags: Set<string>): ShellToken[] {
  const out: ShellToken[] = [];
  let positionalOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = tokenRaw(args[i]);
    if (!positionalOnly && arg === '--') {
      positionalOnly = true;
      continue;
    }

    if (!positionalOnly && arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const flagName = eq >= 0 ? arg.slice(0, eq) : arg;
      if (valueFlags.has(flagName) && eq < 0) i++;
      continue;
    }

    out.push(splitToken(args[i]));
  }

  return out;
}

function extractGuardedBodyArgs(kind: GuardedBusCommand, args: string[] | null): ShellToken[] | undefined {
  if (!args) return undefined;

  switch (kind) {
    case 'send-message': {
      const positionals = positionalArgs(args, new Set(['--reply-to']));
      return positionals.slice(2);
    }
    case 'send-telegram': {
      const positionals = positionalArgs(args, new Set(['--image', '--file']));
      return positionals.slice(1);
    }
    case 'create-task':
      return tokenList(flagValue(args, '--desc'));
    case 'complete-task':
      return tokenList(flagValue(args, '--result') ?? positionalArgs(args, new Set(['--result']))[1]);
    case 'log-event':
      return tokenList(flagValue(args, '--meta'));
    case 'update-heartbeat':
      return tokenList(positionalArgs(args, new Set(['--task', '--timezone', '--interval']))[0]);
    case 'create-approval':
      return tokenList(positionalArgs(args, new Set())[2]);
    default:
      return undefined;
  }
}

function tokenList(token: ShellToken | undefined): ShellToken[] {
  return token ? [token] : [];
}

function findOptionAfterSeparatorArg(args: string[] | null): ShellToken | undefined {
  if (!args) return undefined;

  let afterSeparator = false;
  for (const encodedArg of args) {
    const arg = splitToken(encodedArg);
    if (!afterSeparator) {
      if (arg.raw === '--') afterSeparator = true;
      continue;
    }

    if (arg.raw.startsWith('--')) return arg;
  }

  return undefined;
}

function hasShellExpansionSyntax(raw: string): boolean {
  return raw.includes('$(')
    || raw.includes('${')
    || raw.includes('`')
    || raw.includes('$((')
    || raw.includes('<(')
    || raw.includes('>(');
}

function isBareDoubleQuotedVariableReference(raw: string): boolean {
  return /^"\$[A-Za-z_][A-Za-z0-9_]*"$/.test(raw);
}

function isUnquotedVariableReference(raw: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(raw);
}

function emitDecisionLogs(decision: SendGuardDecision): void {
  const kind = decision.kind ?? 'bus-send';

  if (decision.chained) {
    console.error(`send-guard: WARN ${kind} - bus-send is chained with other commands (unquoted operator in the command line). Bare, unchained sends are the standing fleet rule (2026-08-28 three mechanical rules); chaining is the anti-pattern.`);
  }

  if (decision.permissionDecision !== 'allow') return;

  if (decision.allowReason === 'compound-unparseable-region-clean') {
    console.error(`send-guard: ALLOW ${kind} - command line unparseable by full tokenizer; narrow bus-send-region scan found no command-substitution forms.`);
    return;
  }

  if (decision.allowReason === 'region-indeterminate') {
    console.error(`send-guard: ALLOW ${kind} - bus-send region indeterminate (unbalanced quotes); could not scan, allowing.`);
    return;
  }

  if (decision.allowReason === 'region-unparseable') {
    console.error(`send-guard: ALLOW ${kind} - bus-send region could not be parsed; allowing without claiming a clean body scan.`);
    return;
  }

  if (decision.allowReason === 'body-not-found') {
    console.error(`send-guard: allowing ${kind} because the guarded body argument could not be located; body argument was not confidently inspectable.`);
  }
}

export function decideSendGuard(command: string, _opts?: unknown): SendGuardDecision {
  const busSend = detectBusSendCommand(command);
  if (!busSend) return { permissionDecision: 'allow' };

  if (busSend.bodyStatus === 'unparseable') {
    const allowReason = busSend.unparseableReason?.startsWith('bus-send region indeterminate')
      ? 'region-indeterminate'
      : 'region-unparseable';

    const guardedRegion = busSend.guardedRegion ?? '';
    if (
      (allowReason === 'region-indeterminate' && hasShellExpansionSyntax(guardedRegion))
      || (allowReason === 'region-unparseable' && hasShellExpansionSyntax(expansionRegionForShellText(guardedRegion)))
    ) {
      return { permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON };
    }

    return {
      permissionDecision: 'allow',
      kind: busSend.kind,
      allowReason,
      chained: busSend.chainedWithOtherCommand ? true : undefined,
    };
  }

  if (busSend.optionAfterSeparatorArg) {
    return { permissionDecision: 'deny', permissionDecisionReason: OPTION_AFTER_SEPARATOR_DENY_REASON };
  }

  if (busSend.bodyStatus === 'not-found') {
    return {
      permissionDecision: 'allow',
      kind: busSend.kind,
      allowReason: 'body-not-found',
      chained: busSend.chainedWithOtherCommand ? true : undefined,
    };
  } else if (busSend.bodyArgs) {
    for (const bodyArg of busSend.bodyArgs) {
      if (isBareDoubleQuotedVariableReference(bodyArg.raw)) {
        // Canonical safe call site after quoted heredoc assembly.
      } else if (isUnquotedVariableReference(bodyArg.raw)) {
        return { permissionDecision: 'deny', permissionDecisionReason: UNQUOTED_BODY_DENY_REASON };
      } else if (hasShellExpansionSyntax(bodyArg.expansionRegion)) {
        return { permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON };
      }
    }
  }

  if (busSend.chainedWithOtherCommand) {
    return {
      permissionDecision: 'allow',
      kind: busSend.kind,
      allowReason: 'compound-unparseable-region-clean',
      chained: true,
    };
  }

  return { permissionDecision: 'allow' };
}

async function main(): Promise<void> {
  const input = await readStdin();
  const { tool_name, tool_input } = parseHookInput(input);
  if (tool_name !== 'Bash') {
    outputPreToolUseDecision({ permissionDecision: 'allow' });
    return;
  }

  const command = typeof tool_input.command === 'string' ? tool_input.command : '';
  outputPreToolUseDecision(decideSendGuard(command));
}

if (require.main === module) {
  main().catch(() => {
    outputPreToolUseDecision({ permissionDecision: 'allow' });
  });
}
