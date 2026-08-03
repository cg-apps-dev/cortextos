import dns from 'node:dns';
import type { LookupFunction } from 'node:net';

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | dns.LookupAddress[],
  family?: number,
) => void;
type ResolveRecord = { address: string; ttl?: number };

type LookupOptions = dns.LookupOptions;

export type ResilientLookup = LookupFunction;

export type ResilientLookupDeps = {
  resolve4?: (hostname: string) => Promise<ResolveRecord[]>;
  resolve6?: (hostname: string) => Promise<ResolveRecord[]>;
  directResolve4?: (hostname: string) => Promise<ResolveRecord[]>;
  directResolve6?: (hostname: string) => Promise<ResolveRecord[]>;
  lookup?: (hostname: string, options: LookupOptions) => Promise<{ address: string; family: number }>;
  now?: () => number;
  log?: (message: string) => void;
  timeoutMs?: number;
  maxTtlMs?: number;
};

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_MAX_TTL_MS = 180_000;
const MIN_TTL_MS = 1000;

function normalizeRecords(records: ResolveRecord[] | string[] | undefined): ResolveRecord[] {
  if (!records) return [];
  return records.map((record) => (typeof record === 'string' ? { address: record } : record));
}

function callbackResolve(
  fn: (hostname: string, options: { ttl: true }, cb: (err: NodeJS.ErrnoException | null, records?: any[]) => void) => void,
  hostname: string,
): Promise<ResolveRecord[]> {
  return new Promise((resolve, reject) => {
    fn(hostname, { ttl: true }, (err, records) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(normalizeRecords(records));
    });
  });
}

function callbackLookup(
  hostname: string,
  options: LookupOptions,
): Promise<{ address: string; family: number }> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, options, (err, address, family) => {
      if (err) {
        reject(err);
        return;
      }
      if (Array.isArray(address)) {
        const first = address[0];
        if (!first) {
          reject(new Error(`No lookup results for ${hostname}`));
          return;
        }
        resolve({ address: first.address, family: first.family });
        return;
      }
      resolve({ address, family: family ?? 0 });
    });
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function pickRecord(records: ResolveRecord[]): ResolveRecord | undefined {
  return records.find((record) => record.address.length > 0);
}

function ttlMs(record: ResolveRecord | undefined, maxTtlMs: number): number {
  if (!record || typeof record.ttl !== 'number' || !Number.isFinite(record.ttl) || record.ttl <= 0) {
    return MIN_TTL_MS;
  }
  return Math.min(Math.max(record.ttl * 1000, MIN_TTL_MS), maxTtlMs);
}

function cacheKey(hostname: string, family: number | undefined): string {
  return `${hostname}|${family ?? 0}`;
}

function makeDefaultDeps(): Required<Omit<ResilientLookupDeps, 'now' | 'log'>> {
  const publicResolver = new dns.Resolver();
  publicResolver.setServers(['1.1.1.1', '8.8.8.8']);
  return {
    resolve4: (hostname) => callbackResolve(dns.resolve4, hostname),
    resolve6: (hostname) => callbackResolve(dns.resolve6, hostname),
    directResolve4: (hostname) => callbackResolve(publicResolver.resolve4.bind(publicResolver), hostname),
    directResolve6: (hostname) => callbackResolve(publicResolver.resolve6.bind(publicResolver), hostname),
    lookup: callbackLookup,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxTtlMs: DEFAULT_MAX_TTL_MS,
  };
}

async function resolveViaFamily(
  family: number | undefined,
  resolve4: (hostname: string) => Promise<ResolveRecord[]>,
  resolve6: (hostname: string) => Promise<ResolveRecord[]>,
  hostname: string,
): Promise<{ record: ResolveRecord; family: number }> {
  if (family === 6) {
    const record = pickRecord(await resolve6(hostname));
    if (record) return { record, family: 6 };
    throw new Error(`No AAAA records for ${hostname}`);
  }

  const v4 = pickRecord(await resolve4(hostname));
  if (v4) return { record: v4, family: 4 };

  if (family === 4) {
    throw new Error(`No A records for ${hostname}`);
  }

  const v6 = pickRecord(await resolve6(hostname));
  if (v6) return { record: v6, family: 6 };
  throw new Error(`No A or AAAA records for ${hostname}`);
}

export function createResilientLookup(deps: ResilientLookupDeps = {}): ResilientLookup {
  const defaults = makeDefaultDeps();
  const resolve4 = deps.resolve4 ?? defaults.resolve4;
  const resolve6 = deps.resolve6 ?? defaults.resolve6;
  const directResolve4 = deps.directResolve4 ?? defaults.directResolve4;
  const directResolve6 = deps.directResolve6 ?? defaults.directResolve6;
  const lookup = deps.lookup ?? defaults.lookup;
  const timeoutMs = deps.timeoutMs ?? defaults.timeoutMs;
  const maxTtlMs = deps.maxTtlMs ?? defaults.maxTtlMs;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const cache = new Map<string, { address: string; family: number; expiresAt: number }>();

  return (hostname, options, cb) => {
    const family = options.family === 4 || options.family === 6 ? options.family : undefined;
    const key = cacheKey(hostname, family);
    const cached = cache.get(key);
    const currentTime = now();
    if (cached && cached.expiresAt > currentTime) {
      if (options.all) {
        cb(null, [{ address: cached.address, family: cached.family }]);
      } else {
        cb(null, cached.address, cached.family);
      }
      return;
    }

    (async () => {
      const attempts: Array<{
        label: string;
        run: () => Promise<{ address: string; family: number; ttl?: number }>;
      }> = [
        {
          label: 'c-ares',
          run: async () => {
            const result = await resolveViaFamily(family, resolve4, resolve6, hostname);
            return { address: result.record.address, family: result.family, ttl: result.record.ttl };
          },
        },
        {
          label: 'public-resolver',
          run: async () => {
            const result = await resolveViaFamily(family, directResolve4, directResolve6, hostname);
            return { address: result.record.address, family: result.family, ttl: result.record.ttl };
          },
        },
        {
          label: 'getaddrinfo',
          run: async () => {
            const result = await lookup(hostname, options);
            return { address: result.address, family: result.family };
          },
        },
      ];

      let lastErr: unknown;
      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        try {
          const result = await withTimeout(attempt.run(), timeoutMs, attempt.label);
          cache.set(key, {
            address: result.address,
            family: result.family,
            expiresAt: now() + ttlMs(result, maxTtlMs),
          });
          if (i > 0) {
            log(`[resilient-lookup] ${hostname} resolved via ${attempt.label}`);
          }
          if (options.all) {
            cb(null, [{ address: result.address, family: result.family }]);
          } else {
            cb(null, result.address, result.family);
          }
          return;
        } catch (err) {
          lastErr = err;
        }
      }

      const finalErr =
        lastErr instanceof Error ? lastErr : new Error(`Failed to resolve ${hostname}`);
      cb(finalErr as NodeJS.ErrnoException, '');
    })();
  };
}

export const resilientLookup = createResilientLookup({
  now: Date.now,
});
