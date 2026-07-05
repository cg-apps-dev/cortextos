import { createHash } from 'crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import {
  hashLiveProcessToken,
  hashLiveTokenFromPsOutput,
  shortTokenHash,
} from '../../../src/utils/live-token-hash';

const TOKEN = 'sk-ant-live-token-secret';

function expectedHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

describe('live-token-hash', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it('hashes only CLAUDE_CODE_OAUTH_TOKEN from ps output', () => {
    const output = `1234 ?? S node OTHER_SECRET=do-not-hash CLAUDE_CODE_OAUTH_TOKEN=${TOKEN} PATH=/bin`;

    expect(hashLiveTokenFromPsOutput(output)).toBe(expectedHash(TOKEN));
    expect(hashLiveTokenFromPsOutput(output)).toBe(shortTokenHash(TOKEN));
  });

  it('returns null when ps output has no token', () => {
    expect(hashLiveTokenFromPsOutput('1234 ?? S node PATH=/bin')).toBeNull();
  });

  it('returns only a short hash and never the raw token', () => {
    const value = hashLiveTokenFromPsOutput(`CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`);

    expect(value).toMatch(/^[a-f0-9]{12}$/);
    expect(value).not.toContain(TOKEN);
    expect(value).not.toContain('sk-ant');
  });

  it('returns null on ps failure without surfacing token bytes', () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error(`ps failed ${TOKEN}`);
    });

    const value = hashLiveProcessToken(1234);

    expect(value).toBeNull();
  });

  it('calls ps with eww and the explicit pid only', () => {
    execFileSyncMock.mockReturnValue(`CLAUDE_CODE_OAUTH_TOKEN=${TOKEN}`);

    expect(hashLiveProcessToken(4321)).toBe(expectedHash(TOKEN));
    expect(execFileSyncMock).toHaveBeenCalledWith('ps', ['eww', '-p', '4321'], expect.objectContaining({
      encoding: 'utf-8',
    }));
  });
});
