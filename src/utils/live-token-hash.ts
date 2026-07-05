import { createHash } from 'crypto';
import { execFileSync } from 'child_process';

const LIVE_TOKEN_VAR = 'CLAUDE_CODE_OAUTH_TOKEN';
const SHA256_PREFIX_LENGTH = 12;

export function shortTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, SHA256_PREFIX_LENGTH);
}

export function hashLiveTokenFromPsOutput(psOutput: string): string | null {
  const marker = `${LIVE_TOKEN_VAR}=`;
  const start = psOutput.indexOf(marker);
  if (start < 0) return null;
  const valueStart = start + marker.length;
  const nextSpace = psOutput.slice(valueStart).search(/\s/);
  const valueEnd = nextSpace < 0 ? psOutput.length : valueStart + nextSpace;
  let token: string | null = psOutput.slice(valueStart, valueEnd);
  const hash = shortTokenHash(token);
  token = null;
  return hash;
}

export function hashLiveProcessToken(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  let psOutput: string | null = null;
  try {
    psOutput = execFileSync('ps', ['eww', '-p', String(pid)], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 1024 * 1024,
    });
    const hash = hashLiveTokenFromPsOutput(psOutput);
    psOutput = null;
    return hash;
  } catch {
    psOutput = null;
    return null;
  }
}
