import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AgentProcess } from '../../../src/daemon/agent-process.js';

// Focused unit test for the --continue-no-conversation auto-recovery
// (research-agent 34h-down root cause, 2026-07-31). Exercises the two new
// pure-ish units directly; the handleExit wiring mirrors the already-tested
// image-poison recovery block. No PTY is spawned (we never call start()).

describe('no-conversation auto-recovery', () => {
  const ctxRoot = join(tmpdir(), `cortextos-noconv-${Date.now()}`);
  const mkEnv = (root: string) => ({
    instanceId: 'test',
    ctxRoot: root,
    frameworkRoot: '/tmp/fw',
    agentName: 'research-agent',
    agentDir: '/tmp/fw/orgs/acme/agents/research-agent',
    org: 'acme',
    projectRoot: '/tmp/fw',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ap = (root: string): any => new AgentProcess('research-agent', mkEnv(root) as any, {});

  beforeEach(() => mkdirSync(ctxRoot, { recursive: true }));
  afterEach(() => rmSync(ctxRoot, { recursive: true, force: true }));

  describe('detectNoConversationCrash — precise signature only', () => {
    const a = ap(ctxRoot);
    it('matches the exact "No conversation found to continue" message', () => {
      expect(a.detectNoConversationCrash('...\nNo conversation found to continue\n...')).toBe(true);
    });
    it('does NOT fire on empty or normal output (no false-positive session discard)', () => {
      expect(a.detectNoConversationCrash('')).toBe(false);
      expect(a.detectNoConversationCrash(undefined as unknown as string)).toBe(false);
      expect(a.detectNoConversationCrash('SESSION CONTINUATION: resumed with --continue')).toBe(false);
      expect(a.detectNoConversationCrash('conversation loaded, continuing')).toBe(false);
      expect(a.detectNoConversationCrash('No conversation')).toBe(false); // partial must NOT match
      expect(a.detectNoConversationCrash('API Error: 400 image.source.base64')).toBe(false); // that is the OTHER recovery
    });
  });

  describe('armForceFresh — persistence + boolean safety return', () => {
    it('writes the .force-fresh marker and returns true', () => {
      const a = ap(ctxRoot);
      const ok = a.armForceFresh('no-conversation-to-continue auto-recovery');
      expect(ok).toBe(true);
      const marker = join(ctxRoot, 'state', 'research-agent', '.force-fresh');
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, 'utf-8')).toContain('no-conversation-to-continue auto-recovery');
    });
    it('returns FALSE when the marker cannot be persisted (so handleExit falls through to crash-counting, no uncounted loop)', () => {
      // Point ctxRoot at a path whose parent is a FILE, so ensureDir/write fails.
      const badRoot = join(ctxRoot, 'a-file');
      require('fs').writeFileSync(badRoot, 'x');
      const a = ap(join(badRoot, 'under-a-file'));
      expect(a.armForceFresh('x')).toBe(false);
    });
  });
});
