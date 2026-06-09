import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  buildContextFooter,
  readContextStatus,
  appendContextFooter,
  DEFAULT_MAX_AGE_MS,
} from '../../../src/telegram/context-footer.js';

const NOW = Date.parse('2026-06-09T18:00:00.000Z');
const fresh = (overrides: Record<string, unknown> = {}) => ({
  used_percentage: 62,
  context_window_size: 200000,
  total_input_tokens: 124300,
  written_at: new Date(NOW - 1000).toISOString(), // 1s old
  ...overrides,
});

describe('buildContextFooter', () => {
  it('renders ~tokens / size (pct) from real total_input_tokens', () => {
    expect(buildContextFooter(fresh(), NOW)).toBe('---\nctx: ~124k / 200k (62%)');
  });

  it('derives tokens from pct*size when total_input_tokens is absent', () => {
    const out = buildContextFooter(fresh({ total_input_tokens: null }), NOW);
    // 62% of 200000 = 124000 -> 124k
    expect(out).toBe('---\nctx: ~124k / 200k (62%)');
  });

  it('honors a non-default context_window_size (1M extended)', () => {
    const out = buildContextFooter(
      fresh({ context_window_size: 1000000, total_input_tokens: 250000, used_percentage: 25 }), NOW);
    expect(out).toBe('---\nctx: ~250k / 1000k (25%)');
  });

  it('rounds the percentage to an integer', () => {
    expect(buildContextFooter(fresh({ used_percentage: 7.75 }), NOW)).toContain('(8%)');
  });

  it('shows a genuinely-fresh low reading (does NOT omit a real 0-ish value)', () => {
    const out = buildContextFooter(fresh({ used_percentage: 1, total_input_tokens: 1500 }), NOW);
    expect(out).toBe('---\nctx: ~2k / 200k (1%)');
  });

  // --- graceful degradation: omit (return null), never a misleading 0% ---
  it('omits when status is null', () => {
    expect(buildContextFooter(null, NOW)).toBeNull();
  });

  it('omits when used_percentage is null (before first API call)', () => {
    expect(buildContextFooter(fresh({ used_percentage: null }), NOW)).toBeNull();
  });

  it('omits when the file is stale (older than max age)', () => {
    const stale = fresh({ written_at: new Date(NOW - DEFAULT_MAX_AGE_MS - 1).toISOString() });
    expect(buildContextFooter(stale, NOW)).toBeNull();
  });

  it('omits when written_at is missing or unparseable', () => {
    expect(buildContextFooter(fresh({ written_at: null }), NOW)).toBeNull();
    expect(buildContextFooter(fresh({ written_at: 'not-a-date' }), NOW)).toBeNull();
  });

  it('keeps a reading exactly at the freshness boundary', () => {
    const edge = fresh({ written_at: new Date(NOW - DEFAULT_MAX_AGE_MS).toISOString() });
    expect(buildContextFooter(edge, NOW)).not.toBeNull();
  });
});

describe('readContextStatus', () => {
  it('returns null for a missing file', () => {
    const base = mkdtempSync(join(tmpdir(), 'ctxfooter-'));
    try {
      expect(readContextStatus(base, 'nope-agent')).toBeNull();
    } finally { rmSync(base, { recursive: true, force: true }); }
  });

  it('returns null for malformed JSON', () => {
    const base = mkdtempSync(join(tmpdir(), 'ctxfooter-'));
    try {
      const dir = join(base, 'state', 'a');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'context_status.json'), '{ not json');
      expect(readContextStatus(base, 'a')).toBeNull();
    } finally { rmSync(base, { recursive: true, force: true }); }
  });

  it('parses a valid status file', () => {
    const base = mkdtempSync(join(tmpdir(), 'ctxfooter-'));
    try {
      const dir = join(base, 'state', 'a');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'context_status.json'), JSON.stringify(fresh()));
      const s = readContextStatus(base, 'a');
      expect(s?.used_percentage).toBe(62);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
});

describe('appendContextFooter', () => {
  it('appends the footer when fresh data exists', () => {
    const base = mkdtempSync(join(tmpdir(), 'ctxfooter-'));
    try {
      const dir = join(base, 'state', 'a');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'context_status.json'), JSON.stringify(fresh()));
      const out = appendContextFooter('hello', base, 'a', NOW);
      expect(out).toBe('hello\n\n---\nctx: ~124k / 200k (62%)');
    } finally { rmSync(base, { recursive: true, force: true }); }
  });

  it('returns the message unchanged when there is no data (graceful)', () => {
    const base = mkdtempSync(join(tmpdir(), 'ctxfooter-'));
    try {
      expect(appendContextFooter('hello', base, 'missing', NOW)).toBe('hello');
    } finally { rmSync(base, { recursive: true, force: true }); }
  });

  it('returns the message unchanged when data is stale', () => {
    const base = mkdtempSync(join(tmpdir(), 'ctxfooter-'));
    try {
      const dir = join(base, 'state', 'a');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'context_status.json'),
        JSON.stringify(fresh({ written_at: new Date(NOW - DEFAULT_MAX_AGE_MS - 5000).toISOString() })));
      expect(appendContextFooter('hello', base, 'a', NOW)).toBe('hello');
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
});
