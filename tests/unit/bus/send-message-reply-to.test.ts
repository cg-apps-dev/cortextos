import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateSendMessageReplyTo } from '../../../src/cli/bus';

describe('validateSendMessageReplyTo', () => {
  const agentName = 'codex-dev-agent';
  let ctxRoot: string;

  function createRetainedInbox(): void {
    mkdirSync(join(ctxRoot, 'inflight', agentName), { recursive: true });
    mkdirSync(join(ctxRoot, 'processed', agentName), { recursive: true });
  }

  function retainMessage(id: string, location: 'inflight' | 'processed' = 'inflight'): void {
    writeFileSync(join(ctxRoot, location, agentName, `${id}.json`), JSON.stringify({ id }));
  }

  beforeEach(() => {
    ctxRoot = mkdtempSync(join(tmpdir(), 'cortextos-reply-to-test-'));
  });

  afterEach(() => {
    rmSync(ctxRoot, { recursive: true, force: true });
  });

  it('blocks relay-as-reply when the message sender differs from the addressee', () => {
    const result = validateSendMessageReplyTo(
      '1790394137665-codex-dev-agent-abc12',
      { ctxRoot },
      agentName,
      'the-orchestrator',
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("message from 'codex-dev-agent'");
    expect(result.error).toContain("sending to 'the-orchestrator'");
  });

  it('allows a matching sender to continue to retained-inbox validation', () => {
    const result = validateSendMessageReplyTo(
      '1790394137665-claude-dev-agent-abc12',
      { ctxRoot },
      agentName,
      'claude-dev-agent',
    );

    expect(result).toMatchObject({ ok: true, lookupStatus: 'unresolvable' });
  });

  it('parses the complete hyphenated addressee from the message id', () => {
    const replyTo = '1790394137665-meta-ads-agent-abc12';
    createRetainedInbox();
    retainMessage(replyTo, 'processed');

    const result = validateSendMessageReplyTo(
      replyTo,
      { ctxRoot },
      agentName,
      'meta-ads-agent',
    );

    expect(result).toEqual({ ok: true, lookupStatus: 'found' });
  });

  it('blocks a sender mismatch before attempting retained-inbox lookup', () => {
    const result = validateSendMessageReplyTo(
      '1790394137665-codex-dev-agent-abc12',
      { ctxRoot: join(ctxRoot, 'missing') },
      agentName,
      'the-orchestrator',
    );

    expect(result).toMatchObject({ ok: false });
    expect(result.lookupStatus).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(result.error).toContain('relay-as-reply misuse');
  });

  it('retains malformed and omitted reply_to behavior', () => {
    const malformed = validateSendMessageReplyTo(
      'not-a-message-id',
      { ctxRoot },
      agentName,
      'claude-dev-agent',
    );
    const omitted = validateSendMessageReplyTo(
      undefined,
      { ctxRoot },
      agentName,
      'claude-dev-agent',
    );

    expect(malformed.ok).toBe(false);
    expect(malformed.error).toContain('Use the exact msg_id');
    expect(omitted).toEqual({ ok: true });
  });

  it('retains the older-than-retained block for a matching sender', () => {
    createRetainedInbox();
    retainMessage('1790395000000-other-agent-def34');

    const result = validateSendMessageReplyTo(
      '1790394000000-claude-dev-agent-abc12',
      { ctxRoot },
      agentName,
      'claude-dev-agent',
    );

    expect(result).toMatchObject({ ok: false, lookupStatus: 'older-than-retained' });
    expect(result.error).toContain('older than the retained inbox window');
  });

  it('allows a fully valid reply to a retained message from the addressee', () => {
    const replyTo = '1790394137665-claude-dev-agent-abc12';
    createRetainedInbox();
    retainMessage(replyTo);

    const result = validateSendMessageReplyTo(
      replyTo,
      { ctxRoot },
      agentName,
      'claude-dev-agent',
    );

    expect(result).toEqual({ ok: true, lookupStatus: 'found' });
  });
});
