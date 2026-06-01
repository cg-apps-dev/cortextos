import { createServer } from 'net';

/**
 * Port helpers for isolated dev-worktree previews.
 *
 * The served dashboard runs on :3000; each feature worktree gets its own
 * preview port so it can run an isolated `next dev` without colliding with the
 * live view or with other worktrees.
 */

/** Check whether a TCP port is free to bind on the loopback interface. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find the first free port at or after `start`, scanning up to `maxTries`
 * candidates. Throws if none are free in the window.
 *
 * Defaults to 3001 so preview servers cluster just above the served :3000.
 */
export async function findFreePort(start = 3001, maxTries = 100): Promise<number> {
  for (let port = start; port < start + maxTries; port++) {
    if (port > 65535) break;
    if (await isPortFree(port)) return port;
  }
  throw new Error(
    `No free port found in range ${start}–${Math.min(start + maxTries - 1, 65535)}`,
  );
}
