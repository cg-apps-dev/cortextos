import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  BACKTICK_DENY_REASON,
  decideSendGuard,
  extractTrailingReplyTo,
  findReplyToInRetainedInbox,
  formatPreToolUseDecision,
  replyToDenyReason,
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

  it('denies any backtick in send-message commands', () => {
    const decision = decideSendGuard("cortextos bus send-message claude-dev-agent normal 'run `date`'");

    expect(decision).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: BACKTICK_DENY_REASON,
    });
  });

  it('allows send-message commands without backticks and without reply_to', () => {
    expect(decideSendGuard(sendMessageCommand())).toEqual({ permissionDecision: 'allow' });
  });

  it('allows reply_to found in inflight', () => {
    expect(decideSendGuard(sendMessageCommand(INFLIGHT_ID), { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows reply_to found in processed', () => {
    expect(decideSendGuard(sendMessageCommand(PROCESSED_ID), { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('denies msg-id-shaped reply_to absent within retained window', () => {
    expect(decideSendGuard(sendMessageCommand(ABSENT_ID), { ctxRoot, agentName: AGENT }))
      .toEqual({
        permissionDecision: 'deny',
        permissionDecisionReason: replyToDenyReason(ABSENT_ID),
      });
  });

  it('allows non-msg-id-shaped trailing args', () => {
    expect(extractTrailingReplyTo(`${sendMessageCommand()} not-a-message-id`)).toBeNull();
    expect(decideSendGuard(`${sendMessageCommand()} not-a-message-id`, { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows when reply_to is absent', () => {
    expect(extractTrailingReplyTo(sendMessageCommand())).toBeNull();
    expect(decideSendGuard(sendMessageCommand(), { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows when inbox path is unresolvable', () => {
    expect(findReplyToInRetainedInbox(ABSENT_ID, { ctxRoot: join(ctxRoot, 'missing'), agentName: AGENT }))
      .toEqual({ status: 'unresolvable' });
    expect(decideSendGuard(sendMessageCommand(ABSENT_ID), { ctxRoot: join(ctxRoot, 'missing'), agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows pruning-edge reply_to older than oldest retained message', () => {
    expect(findReplyToInRetainedInbox(OLD_PRUNED_ID, { ctxRoot, agentName: AGENT }))
      .toEqual({ status: 'older-than-retained' });
    expect(decideSendGuard(sendMessageCommand(OLD_PRUNED_ID), { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
  });

  it('allows non-bus-send Bash commands as pass-through', () => {
    expect(decideSendGuard('echo `date`')).toEqual({ permissionDecision: 'allow' });
  });

  it('denies send-telegram with backticks but does not reply_to lint send-telegram', () => {
    expect(decideSendGuard("cortextos bus send-telegram 123 'hello `date`'")).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: BACKTICK_DENY_REASON,
    });

    expect(decideSendGuard(`cortextos bus send-telegram 123 'hello' ${ABSENT_ID}`, { ctxRoot, agentName: AGENT }))
      .toEqual({ permissionDecision: 'allow' });
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
