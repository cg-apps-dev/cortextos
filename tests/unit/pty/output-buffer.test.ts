import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock fs.appendFileSync so tests don't actually write to disk. We still
// need the real existsSync etc. for other imports in the module graph.
const appendFileSyncMock = vi.fn();
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    appendFileSync: (...args: unknown[]) => appendFileSyncMock(...args),
  };
});

const { OutputBuffer } = await import('../../../src/pty/output-buffer');

// Synthetic JWT used across tests. Has the canonical 3-segment shape and
// the `eyJ` header prefix so the redactor matches it. Length exceeds the
// {10,} per-segment minimum.
const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXNlc3Npb24taWQifQ.abcdefghij_-abcdefghij';

// Synthetic sk-ant tokens — NEVER a real credential. Each has a valid family
// segment and a 48-char suffix (>= the 40-char qualifier) so the redactor
// matches it. The `FAKE` marker makes it unmistakable these are fixtures.
const FAKE_SK_ANT_OAT = `sk-ant-oat01-FAKE${'0'.repeat(44)}`;
const FAKE_SK_ANT_API = `sk-ant-api03-FAKE${'1'.repeat(44)}`;
const FAKE_SK_ANT_SID = `sk-ant-sid01-FAKE${'2'.repeat(44)}`;
const FAKE_SK_ANT_SK = `sk-ant-sk01-FAKE${'3'.repeat(44)}`;
// ort01 = the OAuth REFRESH token (spend-adjacent). It is NOT in the original
// spec's closed enumeration; the pattern must match ANY subtype (gitleaks
// parity), so ort01 and a hypothetical future subtype both redact.
const FAKE_SK_ANT_ORT = `sk-ant-ort01-FAKE${'4'.repeat(44)}`;
const FAKE_SK_ANT_FUTURE = `sk-ant-zz99-FAKE${'5'.repeat(44)}`;

beforeEach(() => {
  appendFileSyncMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OutputBuffer redaction', () => {
  it('single JWT in a single chunk: redacted in both disk log and in-memory buffer', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    buf.push(`session cookie: authjs.session-token=${FAKE_JWT}\n`);

    expect(appendFileSyncMock).toHaveBeenCalledTimes(1);
    const writtenData = String(appendFileSyncMock.mock.calls[0][1]);
    expect(writtenData).toContain('[REDACTED_JWT]');
    expect(writtenData).not.toContain(FAKE_JWT);

    // In-memory ring buffer should also see the redacted form.
    const recent = buf.getRecent();
    expect(recent).toContain('[REDACTED_JWT]');
    expect(recent).not.toContain(FAKE_JWT);
  });

  it('multiple JWTs in one chunk: all redacted', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    const another =
      'eyJxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyy.zzzzzzzzzzzzzzzz__';
    buf.push(`a=${FAKE_JWT} b=${another} c=${FAKE_JWT}`);

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    // Every JWT-shaped token replaced with the literal redaction marker.
    expect(written).not.toContain(FAKE_JWT);
    expect(written).not.toContain(another);
    const matches = (written.match(/\[REDACTED_JWT\]/g) || []).length;
    expect(matches).toBe(3);
  });

  it('non-JWT PTY data passes through unchanged (regression guard)', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    // TUI ANSI escapes, regular stdout, plausible-but-too-short alphanum.
    const tuiOutput =
      '\x1b[38;5;114m●\x1b[39m Running tests... version v1.2.3 hash=abc.def.ghi\n';
    buf.push(tuiOutput);

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    expect(written).toBe(tuiOutput); // byte-for-byte identical
    expect(written).not.toContain('[REDACTED_JWT]');
  });

  it('bootstrap detection still works after redaction', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    // Claude Code's permissions status bar line — contains "permissions"
    // which isBootstrapped() searches for. No JWT in this chunk — the
    // test guards that redaction does not accidentally break the ring
    // buffer's search path.
    buf.push('\x1b[2m ? \x1b[0mfor shortcuts                  permissions: bypass\n');
    expect(buf.isBootstrapped()).toBe(true);
  });

  it('chunk-boundary edge case is NOT redacted (documents the known limitation)', () => {
    // Split a JWT across two push() calls. Neither chunk matches the
    // regex on its own — the redactor is stateless and chunk-local. This
    // test INTENTIONALLY asserts the un-redacted behavior so that any
    // future refactor adding buffer-aware redaction has to be an
    // explicit decision (the test fails and forces a re-review).
    // sk-ant tokens share this exact cross-chunk limitation.
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    const half1 = FAKE_JWT.slice(0, 40);
    const half2 = FAKE_JWT.slice(40);
    buf.push(`prefix ${half1}`);
    buf.push(`${half2} suffix`);

    const firstWrite = String(appendFileSyncMock.mock.calls[0][1]);
    const secondWrite = String(appendFileSyncMock.mock.calls[1][1]);
    // Each half survives because neither chunk is a complete JWT shape.
    expect(firstWrite).toContain(half1);
    expect(secondWrite).toContain(half2);
    // Neither chunk contains the redaction marker.
    expect(firstWrite).not.toContain('[REDACTED_JWT]');
    expect(secondWrite).not.toContain('[REDACTED_JWT]');
  });

  it('short alphanumeric that resembles a truncated JWT is NOT redacted (length guard)', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    // "eyJab.x.y" has the right header prefix and the right shape but
    // segments are all too short — the {10,} length qualifier must
    // prevent this from matching.
    const shortTokenLike = 'eyJab.x.y';
    buf.push(`debug_token=${shortTokenLike} ok=true\n`);

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    expect(written).toContain(shortTokenLike);
    expect(written).not.toContain('[REDACTED_JWT]');
  });

  it('sk-ant oat01 token in a single chunk: redacted in disk log and ring buffer', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    buf.push(`CLAUDE_CODE_OAUTH_TOKEN=${FAKE_SK_ANT_OAT}\n`);

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    expect(written).toContain('[REDACTED_SK_ANT]');
    expect(written).not.toContain(FAKE_SK_ANT_OAT);

    const recent = buf.getRecent();
    expect(recent).toContain('[REDACTED_SK_ANT]');
    expect(recent).not.toContain(FAKE_SK_ANT_OAT);
  });

  it('sk-ant api03 / sid01 / sk01 family variants are all redacted', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    buf.push(`a=${FAKE_SK_ANT_API} b=${FAKE_SK_ANT_SID} c=${FAKE_SK_ANT_SK}`);

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    expect(written).not.toContain(FAKE_SK_ANT_API);
    expect(written).not.toContain(FAKE_SK_ANT_SID);
    expect(written).not.toContain(FAKE_SK_ANT_SK);
    const matches = (written.match(/\[REDACTED_SK_ANT\]/g) || []).length;
    expect(matches).toBe(3);
  });

  it('sk-ant ort01 (OAuth refresh token, spend-adjacent) is redacted (not in the old closed enumeration)', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    buf.push(`refresh_token=${FAKE_SK_ANT_ORT}\n`);

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    expect(written).toContain('[REDACTED_SK_ANT]');
    expect(written).not.toContain(FAKE_SK_ANT_ORT);
  });

  it('a future/unknown sk-ant subtype is redacted (any-subtype gitleaks parity, not a fixed set)', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    buf.push(`token=${FAKE_SK_ANT_FUTURE}\n`);

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    expect(written).toContain('[REDACTED_SK_ANT]');
    expect(written).not.toContain(FAKE_SK_ANT_FUTURE);
  });

  it('bare / suffixless / truncated sk-ant strings are NOT redacted (no false positive)', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    // bare prose, a family with no suffix, and a suffix under the 40-char
    // qualifier — none should match (mirrors the JWT length-guard discipline).
    const bare = 'sk-ant';
    const suffixless = 'sk-ant-oat01';
    const truncated = `sk-ant-oat01-${'A'.repeat(20)}`;
    buf.push(`talking about ${bare} and ${suffixless} and ${truncated} in prose\n`);

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    expect(written).not.toContain('[REDACTED_SK_ANT]');
    expect(written).toContain(bare);
    expect(written).toContain(suffixless);
    expect(written).toContain(truncated);
  });

  it('a chunk containing BOTH a JWT and an sk-ant token: both redacted', () => {
    const buf = new OutputBuffer(1000, '/tmp/fake-stdout.log');
    buf.push(`cookie=${FAKE_JWT} bearer=${FAKE_SK_ANT_OAT}\n`);

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    expect(written).toContain('[REDACTED_JWT]');
    expect(written).toContain('[REDACTED_SK_ANT]');
    expect(written).not.toContain(FAKE_JWT);
    expect(written).not.toContain(FAKE_SK_ANT_OAT);
  });

  it('ReDoS guard: a long adversarial sk-ant-prefixed run completes in linear time', () => {
    const buf = new OutputBuffer(2_000_000, '/tmp/fake-stdout.log');
    // A megabyte of the suffix char-class after a valid family segment. The
    // pattern is a single bounded char-class run (no nested quantifiers), so
    // this must complete well under any catastrophic-backtracking threshold.
    const adversarial = `sk-ant-oat01-${'A'.repeat(1_000_000)}`;
    const start = Date.now();
    buf.push(adversarial);
    const elapsedMs = Date.now() - start;

    const written = String(appendFileSyncMock.mock.calls[0][1]);
    expect(written).toContain('[REDACTED_SK_ANT]');
    expect(elapsedMs).toBeLessThan(1000);
  });
});
