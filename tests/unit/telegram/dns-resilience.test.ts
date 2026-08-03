import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

describe('TelegramAPI DNS resilient JSON transport', () => {
  it('passes resilientLookup to https.request for JSON Telegram calls', async () => {
    vi.resetModules();

    let capturedOptions: any;
    const requestMock = vi.fn((options: any, cb: (res: EventEmitter) => void) => {
      capturedOptions = options;
      const req = new EventEmitter() as EventEmitter & {
        setTimeout: (ms: number, cb: () => void) => void;
        write: (payload: string) => void;
        end: () => void;
        destroy: (err: Error) => void;
      };
      req.setTimeout = vi.fn();
      req.write = vi.fn();
      req.destroy = vi.fn((err: Error) => req.emit('error', err));
      req.end = vi.fn(() => {
        const res = new EventEmitter();
        process.nextTick(() => {
          cb(res);
          res.emit('data', Buffer.from(JSON.stringify({ ok: true, result: { message_id: 123 } })));
          res.emit('end');
        });
      });
      return req;
    });

    vi.doMock('node:https', () => ({ request: requestMock }));
    const [{ TelegramAPI }, { resilientLookup }] = await Promise.all([
      import('../../../src/telegram/api.js'),
      import('../../../src/utils/resilient-lookup.js'),
    ]);

    const api = new TelegramAPI('111:AAA');
    await expect(api.sendMessage('chat1', 'hello')).resolves.toMatchObject({
      ok: true,
      result: { message_id: 123 },
    });

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(capturedOptions.hostname).toBe('api.telegram.org');
    expect(capturedOptions.path).toBe('/bot111:AAA/sendMessage');
    expect(capturedOptions.method).toBe('POST');
    expect(capturedOptions.lookup).toBe(resilientLookup);

    vi.doUnmock('node:https');
  });
});
