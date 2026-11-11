import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { busCommand, SEND_MESSAGE_REJECTED_PREFIX, validateSendMessageReplyTo } from '../../../src/cli/bus';

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

  it('drops relay-as-reply when the message sender differs from the addressee', () => {
    const replyTo = '1790394137665-codex-dev-agent-abc12';
    const result = validateSendMessageReplyTo(
      replyTo,
      { ctxRoot },
      agentName,
      'the-orchestrator',
    );

    expect(result).toMatchObject({ ok: true, drop: true });
    expect(result.error).toBeUndefined();
    expect(result.warning).toContain("message from 'codex-dev-agent'");
    expect(result.warning).toContain("sending to 'the-orchestrator'");
    expect(result.warning).toContain('DROPPED');
    expect(result.warning).toContain('UNTHREADED');
    expect(result.warning).toContain(`cortextos bus ack-inbox ${replyTo}`);
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

  it('drops a sender mismatch before attempting retained-inbox lookup', () => {
    const result = validateSendMessageReplyTo(
      '1790394137665-codex-dev-agent-abc12',
      { ctxRoot: join(ctxRoot, 'missing') },
      agentName,
      'the-orchestrator',
    );

    expect(result).toMatchObject({ ok: true, drop: true });
    expect(result.lookupStatus).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.warning).toContain('DROPPED');
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

  it('retains the not-in-retained-inbox block for a matching sender', () => {
    createRetainedInbox();
    retainMessage('1790393000000-claude-dev-agent-def34');

    const result = validateSendMessageReplyTo(
      '1790394000000-claude-dev-agent-abc12',
      { ctxRoot },
      agentName,
      'claude-dev-agent',
    );

    expect(result).toMatchObject({ ok: false, lookupStatus: 'absent' });
    expect(result.error).toContain('not a message in your retained inbox');
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

describe('send-message reply_to action', () => {
  const agentName = 'codex-dev-agent';
  const org = 'clean-green-marketing';
  const envKeys = [
    'CTX_FRAMEWORK_ROOT',
    'CTX_PROJECT_ROOT',
    'CTX_INSTANCE_ID',
    'CTX_AGENT_NAME',
    'CTX_AGENT_DIR',
    'CTX_ORG',
  ] as const;
  let projectRoot: string;
  let instanceId: string;
  let ctxRoot: string;
  let originalEnv: Record<(typeof envKeys)[number], string | undefined>;

  function mockExit(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__PROCESS_EXIT_${code}__`);
    }) as never);
  }

  function createTargetAgent(to: string): void {
    mkdirSync(join(projectRoot, 'orgs', org, 'agents', to), { recursive: true });
  }

  function createRetainedInbox(): void {
    mkdirSync(join(ctxRoot, 'inflight', agentName), { recursive: true });
    mkdirSync(join(ctxRoot, 'processed', agentName), { recursive: true });
  }

  function retainMessage(id: string): void {
    writeFileSync(join(ctxRoot, 'inflight', agentName, `${id}.json`), JSON.stringify({ id }));
  }

  function sentMessages(to: string): Array<Record<string, unknown>> {
    const inboxDir = join(ctxRoot, 'inbox', to);
    if (!existsSync(inboxDir)) return [];
    return readdirSync(inboxDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(join(inboxDir, file), 'utf-8')) as Record<string, unknown>);
  }

  async function runSend(to: string, replyTo: string): Promise<void> {
    await busCommand.parseAsync([
      'node',
      'bus',
      'send-message',
      to,
      'normal',
      'hello',
      '--reply-to',
      replyTo,
    ]);
  }

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'send-message-reply-action-project-'));
    instanceId = `send-message-reply-action-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    ctxRoot = join(homedir(), '.cortextos', instanceId);
    originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]])) as typeof originalEnv;

    process.env.CTX_FRAMEWORK_ROOT = projectRoot;
    process.env.CTX_PROJECT_ROOT = projectRoot;
    process.env.CTX_INSTANCE_ID = instanceId;
    process.env.CTX_AGENT_NAME = agentName;
    process.env.CTX_AGENT_DIR = join(projectRoot, 'orgs', org, 'agents', agentName);
    process.env.CTX_ORG = org;
    mkdirSync(process.env.CTX_AGENT_DIR, { recursive: true });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(ctxRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('sends a wrong-sender reply unthreaded with a loud ACK warning', async () => {
    const to = 'the-orchestrator';
    const replyTo = '1790394137665-claude-dev-agent-abc12';
    const exitSpy = mockExit();
    createTargetAgent(to);

    await runSend(to, replyTo);

    expect(exitSpy).not.toHaveBeenCalled();
    const messages = sentMessages(to);
    expect(messages).toHaveLength(1);
    expect(messages[0].reply_to).toBeNull();
    expect(messages[0].reply_to).not.toBe(replyTo);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("message from 'claude-dev-agent'"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("sending to 'the-orchestrator'"));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`cortextos bus ack-inbox ${replyTo}`));
  });

  it('keeps a valid reply threaded without a warning', async () => {
    const to = 'claude-dev-agent';
    const replyTo = '1790394137665-claude-dev-agent-abc12';
    const exitSpy = mockExit();
    createTargetAgent(to);
    createRetainedInbox();
    retainMessage(replyTo);

    await runSend(to, replyTo);

    expect(exitSpy).not.toHaveBeenCalled();
    const messages = sentMessages(to);
    expect(messages).toHaveLength(1);
    expect(messages[0].reply_to).toBe(replyTo);
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'regex-invalid',
      replyTo: 'not-a-message-id',
      prepare: () => {},
      error: 'Use the exact msg_id',
    },
    {
      name: 'older-than-retained',
      replyTo: '1790394000000-claude-dev-agent-abc12',
      prepare: () => {
        createRetainedInbox();
        retainMessage('1790395000000-claude-dev-agent-def34');
      },
      error: 'older than the retained inbox window',
    },
    {
      name: 'not-in-retained-inbox',
      replyTo: '1790395000000-claude-dev-agent-abc12',
      prepare: () => {
        createRetainedInbox();
        retainMessage('1790394000000-claude-dev-agent-def34');
      },
      error: 'not a message in your retained inbox',
    },
  ])('keeps the $name branch as an exit-1 rejection', async ({ replyTo, prepare, error }) => {
    const to = 'claude-dev-agent';
    const exitSpy = mockExit();
    createTargetAgent(to);
    prepare();

    await expect(runSend(to, replyTo)).rejects.toThrow('__PROCESS_EXIT_1__');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(SEND_MESSAGE_REJECTED_PREFIX));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(error));
    expect(sentMessages(to)).toEqual([]);
  });
});
