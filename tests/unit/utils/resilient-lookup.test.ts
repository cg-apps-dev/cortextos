import { describe, expect, it, vi } from 'vitest';
import { createResilientLookup, type ResilientLookupDeps } from '../../../src/utils/resilient-lookup.js';

function err(message: string): Error {
  return new Error(message);
}

function lookup(
  deps: ResilientLookupDeps,
  hostname = 'api.telegram.org',
  family?: 4 | 6,
): Promise<{ address: string; family: number }> {
  const resilientLookup = createResilientLookup({
    timeoutMs: 25,
    log: vi.fn(),
    ...deps,
  });
  return new Promise((resolve, reject) => {
    resilientLookup(hostname, family ? { family } : {}, (lookupErr, address, resolvedFamily) => {
      if (lookupErr) {
        reject(lookupErr);
        return;
      }
      resolve({ address: address ?? '', family: resolvedFamily ?? 0 });
    });
  });
}

describe('resilientLookup', () => {
  it('returns the c-ares A result on step-1 success', async () => {
    const resolve4 = vi.fn(async () => [{ address: '149.154.166.110', ttl: 120 }]);
    const directResolve4 = vi.fn();
    const getaddrinfo = vi.fn();

    await expect(lookup({ resolve4, directResolve4, lookup: getaddrinfo })).resolves.toEqual({
      address: '149.154.166.110',
      family: 4,
    });
    expect(resolve4).toHaveBeenCalledTimes(1);
    expect(directResolve4).not.toHaveBeenCalled();
    expect(getaddrinfo).not.toHaveBeenCalled();
  });

  it('falls back from c-ares to the direct public resolver', async () => {
    const log = vi.fn();
    const resilientLookup = createResilientLookup({
      resolve4: vi.fn(async () => { throw err('default resolver failed'); }),
      directResolve4: vi.fn(async () => [{ address: '149.154.166.111', ttl: 60 }]),
      lookup: vi.fn(),
      log,
      timeoutMs: 25,
    });

    await expect(new Promise((resolve, reject) => {
      resilientLookup('api.telegram.org', {}, (lookupErr, address, family) => {
        if (lookupErr) reject(lookupErr);
        else resolve({ address, family });
      });
    })).resolves.toEqual({ address: '149.154.166.111', family: 4 });
    expect(log).toHaveBeenCalledWith(
      '[resilient-lookup] api.telegram.org resolved via public-resolver',
    );
  });

  it('falls back to getaddrinfo when both c-ares resolver steps fail', async () => {
    await expect(lookup({
      resolve4: vi.fn(async () => { throw err('step1 failed'); }),
      directResolve4: vi.fn(async () => { throw err('step2 failed'); }),
      lookup: vi.fn(async () => ({ address: '203.0.113.10', family: 4 })),
    })).resolves.toEqual({ address: '203.0.113.10', family: 4 });
  });

  it('surfaces an error when all resolver steps fail', async () => {
    await expect(lookup({
      resolve4: vi.fn(async () => { throw err('step1 failed'); }),
      directResolve4: vi.fn(async () => { throw err('step2 failed'); }),
      lookup: vi.fn(async () => { throw err('getaddrinfo failed'); }),
    })).rejects.toThrow(/getaddrinfo failed/);
  });

  it('prefers IPv4 before querying IPv6 when no family is requested', async () => {
    const resolve4 = vi.fn(async () => [{ address: '149.154.166.110', ttl: 120 }]);
    const resolve6 = vi.fn(async () => [{ address: '2001:db8::1', ttl: 120 }]);

    await expect(lookup({ resolve4, resolve6 })).resolves.toEqual({
      address: '149.154.166.110',
      family: 4,
    });
    expect(resolve6).not.toHaveBeenCalled();
  });

  it('honors family=6 when IPv6 is explicitly requested', async () => {
    const resolve4 = vi.fn(async () => [{ address: '149.154.166.110', ttl: 120 }]);
    const resolve6 = vi.fn(async () => [{ address: '2001:db8::1', ttl: 120 }]);

    await expect(lookup({ resolve4, resolve6 }, 'api.telegram.org', 6)).resolves.toEqual({
      address: '2001:db8::1',
      family: 6,
    });
    expect(resolve4).not.toHaveBeenCalled();
  });

  it('uses the TTL cache and avoids a second resolver call while fresh', async () => {
    let now = 1000;
    const resolve4 = vi.fn(async () => [{ address: '149.154.166.110', ttl: 120 }]);
    const resilientLookup = createResilientLookup({
      resolve4,
      now: () => now,
      log: vi.fn(),
      timeoutMs: 25,
    });

    const call = () => new Promise((resolve, reject) => {
      resilientLookup('api.telegram.org', {}, (lookupErr, address, family) => {
        if (lookupErr) reject(lookupErr);
        else resolve({ address, family });
      });
    });

    await expect(call()).resolves.toEqual({ address: '149.154.166.110', family: 4 });
    now += 10_000;
    await expect(call()).resolves.toEqual({ address: '149.154.166.110', family: 4 });
    expect(resolve4).toHaveBeenCalledTimes(1);
  });

  it('fires the cache-hit callback ASYNCHRONOUSLY (never synchronously)', async () => {
    // REGRESSION (daemon fleet-crash 2026-08-08 + 2026-08-12): a dns.lookup-style callback
    // invoked SYNCHRONOUSLY makes net's internalConnect run inside the lookup's sync stack —
    // before net attaches the socket 'error' handler — so a synchronous connect error
    // (ENETUNREACH on a transient network blip) throws to process 'uncaughtException' and
    // kills the ENTIRE daemon (all hosted agents). The cache-hit path must defer (process
    // .nextTick) exactly like the async resolution path. This test fails if the cache-hit
    // callback is ever made synchronous again.
    let now = 1000;
    const resolve4 = vi.fn(async () => [{ address: '149.154.166.110', ttl: 120 }]);
    const resilientLookup = createResilientLookup({
      resolve4,
      now: () => now,
      log: vi.fn(),
      timeoutMs: 25,
    });

    // Prime the cache with a first (non-cached) resolution.
    await new Promise<void>((resolve, reject) => {
      resilientLookup('api.telegram.org', {}, (e) => (e ? reject(e) : resolve()));
    });

    // Second call is a cache hit. Exercise the options.all branch — the exact crash path
    // (the crash stack was net emitLookup -> our cache-hit cb with all:true -> internalConnect).
    let firedBeforeReturn = false;
    let fired = false;
    await new Promise<void>((resolve) => {
      resilientLookup('api.telegram.org', { all: true }, () => {
        fired = true;
        resolve();
      });
      // Synchronously after the lookup() call returns, the cache-hit cb must NOT have run yet.
      firedBeforeReturn = fired;
    });

    expect(firedBeforeReturn).toBe(false); // deferred to a later tick — the crash-prevent invariant
    expect(fired).toBe(true); // but it does still fire
    expect(resolve4).toHaveBeenCalledTimes(1); // and it was a genuine cache hit (no re-resolve)
  });
});
