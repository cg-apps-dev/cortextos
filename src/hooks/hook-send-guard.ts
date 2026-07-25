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

export interface SendCommandInfo {
  kind: GuardedBusCommand;
  bodyArg?: ShellToken;
  optionAfterSeparatorArg?: ShellToken;
  bodyStatus: 'found' | 'not-found' | 'unparseable' | 'not-applicable';
}

export type SendGuardDecision =
  | { permissionDecision: 'allow' }
  | { permissionDecision: 'deny'; permissionDecisionReason: string };

export function formatPreToolUseDecision(decision: SendGuardDecision): {
  hookSpecificOutput: { hookEventName: 'PreToolUse' } & SendGuardDecision;
} {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      ...decision,
    },
  };
}

export function outputPreToolUseDecision(decision: SendGuardDecision): void {
  process.stdout.write(JSON.stringify(formatPreToolUseDecision(decision)) + '\n');
}

export function detectBusSendCommand(command: string): SendCommandInfo | null {
  const parsed = findGuardedBusCommand(command);
  if (!parsed) return null;
  const bodyArg = isBodyGuardedCommand(parsed.kind)
    ? extractGuardedBodyArg(parsed.kind, parsed.args)
    : undefined;

  return {
    kind: parsed.kind,
    bodyArg,
    optionAfterSeparatorArg: isOptionAfterSeparatorRiskCommand(parsed.kind)
      ? findOptionAfterSeparatorArg(parsed.args)
      : undefined,
    bodyStatus: !isBodyGuardedCommand(parsed.kind)
      ? 'not-applicable'
      : parsed.args === null
        ? 'unparseable'
        : bodyArg === undefined
          ? 'not-found'
          : 'found',
  };
}

function stripHeredocBodies(command: string): string {
  const lines = command.split('\n');
  const output: string[] = [];
  let quote: '"' | "'" | null = null;
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

function findHeredocOperator(line: string, initialQuote: '"' | "'" | null): RegExpMatchArray | null {
  let quote = initialQuote;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && quote !== "'" && i + 1 < line.length) {
      i++;
      continue;
    }
    if (ch === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'";
      continue;
    }
    if (ch === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (!quote && ch === '<' && line[i + 1] === '<') {
      return line.slice(i).match(/^<<(-)?\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z0-9_:-]+))/);
    }
  }
  return null;
}

function updateQuoteState(line: string, initialQuote: '"' | "'" | null): '"' | "'" | null {
  let quote = initialQuote;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && quote !== "'" && i + 1 < line.length) {
      i++;
      continue;
    }
    if (ch === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'";
      continue;
    }
    if (ch === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"';
    }
  }
  return quote;
}

function tokenizeShellLine(line: string): ShellToken[] | null {
  const tokens: ShellToken[] = [];
  let i = 0;

  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (line[i] === ')') break;
    if (i >= line.length) break;

    let raw = '';
    let expansionRegion = '';
    let quote: '"' | "'" | null = null;
    while (i < line.length) {
      const ch = line[i];
      if (!quote && /\s/.test(ch)) break;
      if (!quote && ch === ')') break;

      raw += ch;
      if (quote !== "'") expansionRegion += ch;
      i++;

      if (ch === '\\' && quote !== "'" && i < line.length) {
        raw += line[i];
        expansionRegion += line[i];
        i++;
        continue;
      }
      if (ch === "'" && quote !== '"') {
        quote = quote === "'" ? null : "'";
        continue;
      }
      if (ch === '"' && quote !== "'") {
        quote = quote === '"' ? null : '"';
      }
    }

    if (quote) return null;
    if (raw) tokens.push({ raw, expansionRegion });
  }

  return tokens;
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

function findGuardedBusCommand(command: string): { kind: GuardedBusCommand; args: string[] | null } | null {
  const withoutHeredocBodies = stripHeredocBodies(command);
  const start = findGuardedCommandStart(withoutHeredocBodies);
  if (!start) return null;
  if (hasShellOperatorAfterCommand(withoutHeredocBodies.slice(start.index))) {
    return { kind: start.kind, args: null };
  }

  const tokens = tokenizeShellLine(withoutHeredocBodies.slice(start.index));
  if (tokens && tokens.length >= 3 && tokens[0].raw === 'cortextos' && tokens[1].raw === 'bus' && isGuardedBusCommand(tokens[2].raw)) {
    return { kind: tokens[2].raw, args: tokens.slice(3).map(token => `${token.raw}\0${token.expansionRegion}`) };
  }

  return { kind: start.kind, args: null };
}

function findGuardedCommandStart(command: string): { kind: GuardedBusCommand; index: number } | null {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      i++;
      continue;
    }
    if (ch === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'";
      continue;
    }
    if (ch === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (quote || !command.startsWith('cortextos', i)) continue;
    if (i > 0 && /[A-Za-z0-9_-]/.test(command[i - 1])) continue;

    const match = command.slice(i).match(/^cortextos\s+bus\s+([A-Za-z0-9-]+)/);
    if (match && isGuardedBusCommand(match[1])) {
      return { kind: match[1], index: i };
    }
  }
  return null;
}

function hasShellOperatorAfterCommand(command: string): boolean {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      i++;
      continue;
    }
    if (ch === "'" && quote !== '"') {
      quote = quote === "'" ? null : "'";
      continue;
    }
    if (ch === '"' && quote !== "'") {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (quote) continue;
    if (ch === '\n') return true;
    if (ch === '#') return true;
    if (ch === '|' || ch === ';' || ch === '&') return true;
    if (ch === '>' || ch === '<') return true;
  }
  return false;
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

function extractGuardedBodyArg(kind: GuardedBusCommand, args: string[] | null): ShellToken | undefined {
  if (!args) return undefined;

  switch (kind) {
    case 'send-message': {
      const positionals = positionalArgs(args, new Set(['--reply-to']));
      return positionals[2];
    }
    case 'send-telegram': {
      const positionals = positionalArgs(args, new Set(['--image', '--file']));
      return positionals[1];
    }
    case 'create-task':
      return flagValue(args, '--desc');
    case 'complete-task':
      return flagValue(args, '--result') ?? positionalArgs(args, new Set(['--result']))[1];
    case 'log-event':
      return flagValue(args, '--meta');
    case 'update-heartbeat':
      return positionalArgs(args, new Set(['--task', '--timezone', '--interval']))[0];
    case 'create-approval':
      return positionalArgs(args, new Set())[2];
    default:
      return undefined;
  }
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

function logAllowAndContinue(kind: GuardedBusCommand, reason: string): void {
  console.error(`send-guard: allowing ${kind} because ${reason}; body argument was not confidently inspectable.`);
}

export function decideSendGuard(command: string, _opts?: unknown): SendGuardDecision {
  const busSend = detectBusSendCommand(command);
  if (!busSend) return { permissionDecision: 'allow' };

  if (busSend.bodyStatus === 'unparseable') {
    logAllowAndContinue(busSend.kind, 'the command line contains shell syntax after the guarded bus command or could not be parsed');
    return { permissionDecision: 'allow' };
  }

  if (busSend.optionAfterSeparatorArg) {
    return { permissionDecision: 'deny', permissionDecisionReason: OPTION_AFTER_SEPARATOR_DENY_REASON };
  }

  if (busSend.bodyStatus === 'not-found') {
    logAllowAndContinue(busSend.kind, 'the guarded body argument could not be located');
  } else if (busSend.bodyArg) {
    if (isBareDoubleQuotedVariableReference(busSend.bodyArg.raw)) {
      // Canonical safe call site after quoted heredoc assembly.
    } else if (isUnquotedVariableReference(busSend.bodyArg.raw)) {
      return { permissionDecision: 'deny', permissionDecisionReason: UNQUOTED_BODY_DENY_REASON };
    } else if (hasShellExpansionSyntax(busSend.bodyArg.expansionRegion)) {
      return { permissionDecision: 'deny', permissionDecisionReason: SHELL_EXPANSION_DENY_REASON };
    }
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
