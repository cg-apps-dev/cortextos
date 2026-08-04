import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('passes resilientLookup to https.request for Telegram file downloads', async () => {
    vi.resetModules();

    let capturedOptions: any;
    const requestMock = vi.fn((options: any, cb: (res: EventEmitter & { statusCode?: number; resume?: () => void }) => void) => {
      capturedOptions = options;
      const req = new EventEmitter() as EventEmitter & {
        setTimeout: (ms: number, cb: () => void) => void;
        end: () => void;
        destroy: (err: Error) => void;
      };
      req.setTimeout = vi.fn();
      req.destroy = vi.fn((err: Error) => req.emit('error', err));
      req.end = vi.fn(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode?: number; resume?: () => void };
        res.statusCode = 200;
        res.resume = vi.fn();
        process.nextTick(() => {
          cb(res);
          res.emit('data', Buffer.from([0, 1, 2, 255]));
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
    await expect(api.downloadFile('photos/file.jpg')).resolves.toEqual(Buffer.from([0, 1, 2, 255]));

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(capturedOptions.hostname).toBe('api.telegram.org');
    expect(capturedOptions.path).toBe('/file/bot111:AAA/photos/file.jpg');
    expect(capturedOptions.method).toBe('GET');
    expect(capturedOptions.lookup).toBe(resilientLookup);

    vi.doUnmock('node:https');
  });

  it('preserves the existing non-2xx download error shape', async () => {
    vi.resetModules();

    const requestMock = vi.fn((_: any, cb: (res: EventEmitter & { statusCode?: number; resume?: () => void }) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        setTimeout: (ms: number, cb: () => void) => void;
        end: () => void;
        destroy: (err: Error) => void;
      };
      req.setTimeout = vi.fn();
      req.destroy = vi.fn((err: Error) => req.emit('error', err));
      req.end = vi.fn(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode?: number; resume?: () => void };
        res.statusCode = 404;
        res.resume = vi.fn();
        process.nextTick(() => cb(res));
      });
      return req;
    });

    vi.doMock('node:https', () => ({ request: requestMock }));
    const { TelegramAPI } = await import('../../../src/telegram/api.js');

    const api = new TelegramAPI('111:AAA');
    await expect(api.downloadFile('missing.jpg')).rejects.toThrow('Failed to download file: 404');

    vi.doUnmock('node:https');
  });

  it('builds multipart bodies with raw file bytes intact', async () => {
    vi.resetModules();
    const { buildTelegramMultipartBody } = await import('../../../src/telegram/api.js');
    const bytes = Buffer.from([0, 255, 10, 13, 34, 92]);
    const { body } = buildTelegramMultipartBody(
      [
        { name: 'chat_id', value: '123' },
        { name: 'caption', value: 'hello' },
      ],
      { field: 'photo', filename: 'x.bin', bytes },
      'BOUNDARY',
    );

    const prefix = Buffer.from(
      '--BOUNDARY\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n123\r\n' +
      '--BOUNDARY\r\nContent-Disposition: form-data; name="caption"\r\n\r\nhello\r\n' +
      '--BOUNDARY\r\nContent-Disposition: form-data; name="photo"; filename="x.bin"\r\n' +
      'Content-Type: application/octet-stream\r\n\r\n',
      'utf8',
    );
    const suffix = Buffer.from('\r\n--BOUNDARY--\r\n', 'utf8');
    expect(body.subarray(0, prefix.length)).toEqual(prefix);
    expect(body.subarray(prefix.length, prefix.length + bytes.length)).toEqual(bytes);
    expect(body.subarray(prefix.length + bytes.length)).toEqual(suffix);
  });

  it('rejects CR/LF in multipart filenames before building headers', async () => {
    vi.resetModules();
    const { buildTelegramMultipartBody } = await import('../../../src/telegram/api.js');

    expect(() => buildTelegramMultipartBody(
      [{ name: 'chat_id', value: '123' }],
      { field: 'photo', filename: 'bad\nname.bin', bytes: Buffer.from([1]) },
      'BOUNDARY',
    )).toThrow('Multipart header values must not contain CR or LF');
  });

  it('passes resilientLookup to https.request for multipart Telegram sends', async () => {
    vi.resetModules();
    const testDir = mkdtempSync(join(tmpdir(), 'cortextos-tg-dns-'));
    try {
      const imagePath = join(testDir, 'photo.bin');
      writeFileSync(imagePath, Buffer.from([1, 2, 3, 4]));

      let capturedOptions: any;
      let capturedBody = Buffer.alloc(0);
      const requestMock = vi.fn((options: any, cb: (res: EventEmitter) => void) => {
        capturedOptions = options;
        const req = new EventEmitter() as EventEmitter & {
          setTimeout: (ms: number, cb: () => void) => void;
          write: (payload: Buffer) => void;
          end: () => void;
          destroy: (err: Error) => void;
        };
        req.setTimeout = vi.fn();
        req.write = vi.fn((payload: Buffer) => {
          capturedBody = Buffer.concat([capturedBody, payload]);
        });
        req.destroy = vi.fn((err: Error) => req.emit('error', err));
        req.end = vi.fn(() => {
          const res = new EventEmitter();
          process.nextTick(() => {
            cb(res);
            res.emit('data', Buffer.from(JSON.stringify({ ok: true, result: { message_id: 55 } })));
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
      await expect(api.sendPhoto('chat1', imagePath, 'caption')).resolves.toMatchObject({
        ok: true,
        result: { message_id: 55 },
      });

      expect(capturedOptions.hostname).toBe('api.telegram.org');
      expect(capturedOptions.path).toBe('/bot111:AAA/sendPhoto');
      expect(capturedOptions.method).toBe('POST');
      expect(capturedOptions.lookup).toBe(resilientLookup);
      expect(capturedOptions.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
      expect(capturedOptions.headers['Content-Length']).toBe(capturedBody.length);
      expect(capturedBody.includes(Buffer.from([1, 2, 3, 4]))).toBe(true);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
      vi.doUnmock('node:https');
    }
  });
});
