import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'crypto';
import { createServer, type Server, type Socket } from 'net';
import { EventEmitter } from 'events';
import { mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { IPCClient } from '../../../src/daemon/ipc-server';
import { getIpcPath } from '../../../src/utils/paths';

describe('IPCClient', () => {
  let server: Server | undefined;
  let instanceId: string | undefined;
  let sockets: Socket[] = [];

  afterEach(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets = [];
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => err ? reject(err) : resolve());
      });
    }
    server = undefined;
    if (instanceId) {
      rmSync(join(homedir(), '.cortextos', instanceId), { recursive: true, force: true });
    }
    instanceId = undefined;
  });

  it('includes the IPC request type when a request times out', async () => {
    instanceId = `ipcclienttest_${randomBytes(6).toString('hex')}`;
    const socketPath = getIpcPath(instanceId);
    mkdirSync(dirname(socketPath), { recursive: true });
    let connections = 0;
    server = createServer((socket) => {
      connections += 1;
      sockets.push(socket);
    });
    await listen(server, socketPath);

    const client = new IPCClient(instanceId);

    await expect(client.send({ type: 'stop-agent', agent: 'worker-a' }, 20))
      .rejects.toMatchObject({ code: 'IPC_TIMEOUT', message: 'IPC request timed out: stop-agent' });
    expect(connections).toBe(2);
  });

  it('returns not-running without retrying refused IPC connections', async () => {
    instanceId = `ipcclienttest_${randomBytes(6).toString('hex')}`;
    let calls = 0;
    const client = new IPCClient(instanceId, () => {
      calls += 1;
      const socket = new EventEmitter() as EventEmitter & {
        write: ReturnType<typeof vi.fn>;
        setTimeout: ReturnType<typeof vi.fn>;
        destroy: ReturnType<typeof vi.fn>;
      };
      socket.write = vi.fn();
      socket.setTimeout = vi.fn();
      socket.destroy = vi.fn();
      process.nextTick(() => {
        socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
      });
      return socket;
    });

    await expect(client.send({ type: 'status' }, 20)).resolves.toEqual({
      success: false,
      code: 'DAEMON_DOWN',
      error: 'Daemon is not running. Start it with: cortextos start',
    });
    expect(calls).toBe(1);
  });

  it('treats refused IPC as daemon not running', async () => {
    instanceId = `ipcclienttest_${randomBytes(6).toString('hex')}`;
    const client = new IPCClient(instanceId);

    await expect(client.isDaemonRunning()).resolves.toBe(false);
  });

  it('assumes the daemon is running after retry timeout', async () => {
    instanceId = `ipcclienttest_${randomBytes(6).toString('hex')}`;
    const socketPath = getIpcPath(instanceId);
    mkdirSync(dirname(socketPath), { recursive: true });
    server = createServer((socket) => {
      sockets.push(socket);
    });
    await listen(server, socketPath);

    const client = new IPCClient(instanceId);

    await expect(client.isDaemonRunning(20)).resolves.toBe(true);
  });

  it('keeps successful IPC responses unchanged', async () => {
    instanceId = `ipcclienttest_${randomBytes(6).toString('hex')}`;
    const socketPath = getIpcPath(instanceId);
    mkdirSync(dirname(socketPath), { recursive: true });
    server = createServer((socket) => {
      socket.on('data', () => {
        socket.write(JSON.stringify({ success: true, data: 'ok' }));
        socket.end();
      });
    });
    await listen(server, socketPath);

    const client = new IPCClient(instanceId);

    await expect(client.send({ type: 'status' }, 500)).resolves.toEqual({ success: true, data: 'ok' });
  });
});

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
}
