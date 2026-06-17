import { describe, it, expect, beforeAll } from 'vitest';
import Sqlite from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-'));
process.env.CTX_ROOT = tmpDir;
process.env.CTX_FRAMEWORK_ROOT = tmpDir;

let migrateCostEntriesUniqueIndex: typeof import('../db')['migrateCostEntriesUniqueIndex'];

beforeAll(async () => {
  const mod = await import('../db');
  migrateCostEntriesUniqueIndex = mod.migrateCostEntriesUniqueIndex;
});

function createTestDb(): Database.Database {
  const db = new Sqlite(':memory:');
  db.exec(`
    CREATE TABLE cost_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      agent TEXT NOT NULL,
      org TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      source_file TEXT
    );
  `);
  return db;
}

function insertCostEntry(
  db: Database.Database,
  entry: {
    timestamp?: string;
    agent?: string;
    org?: string;
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
    source_file?: string | null;
  },
): Database.RunResult {
  return db
    .prepare(
      `
        INSERT OR IGNORE INTO cost_entries
          (timestamp, agent, org, model, input_tokens, output_tokens, total_tokens, cost_usd, source_file)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      entry.timestamp ?? '2026-06-16T00:00:00Z',
      entry.agent ?? 'claude-dev-agent',
      entry.org ?? 'clean-green-marketing',
      entry.model ?? 'claude-sonnet-4',
      entry.input_tokens ?? 100,
      entry.output_tokens ?? 50,
      entry.total_tokens ?? 150,
      entry.cost_usd ?? 0.001,
      entry.source_file ?? '/tmp/claude.jsonl',
    );
}

function countRows(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM cost_entries').get() as { count: number }).count;
}

describe('migrateCostEntriesUniqueIndex', () => {
  it('dedups existing rows, removes codex rows, and creates the unique index', () => {
    const db = createTestDb();
    try {
      insertCostEntry(db, { input_tokens: 100, cost_usd: 0.001 });
      insertCostEntry(db, { input_tokens: 999, cost_usd: 9.999 });
      insertCostEntry(db, {
        timestamp: '2026-06-16T01:00:00Z',
        input_tokens: 200,
        cost_usd: 0.002,
      });
      insertCostEntry(db, {
        agent: 'codex-dev-agent',
        model: 'gpt-5.5',
        input_tokens: 300,
        output_tokens: 100,
        total_tokens: 400,
        cost_usd: 0.004,
        source_file: '/logs/codex-dev-agent/codex-tokens.jsonl',
      });

      migrateCostEntriesUniqueIndex(db);

      expect(countRows(db)).toBe(2);
      expect(
        db
          .prepare("SELECT COUNT(*) AS count FROM cost_entries WHERE source_file LIKE '%codex-tokens%'")
          .get(),
      ).toEqual({ count: 0 });
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_cost_entries_unique'")
          .get(),
      ).toEqual({ name: 'idx_cost_entries_unique' });

      const kept = db
        .prepare(
          `
            SELECT input_tokens, output_tokens, total_tokens, cost_usd
            FROM cost_entries
            WHERE timestamp = '2026-06-16T00:00:00Z'
          `,
        )
        .get();
      expect(kept).toEqual({
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: 0.001,
      });
    } finally {
      db.close();
    }
  });

  it('makes duplicate INSERT OR IGNORE a no-op after migration', () => {
    const db = createTestDb();
    try {
      insertCostEntry(db, {});

      migrateCostEntriesUniqueIndex(db);

      const result = insertCostEntry(db, {
        input_tokens: 999,
        output_tokens: 999,
        total_tokens: 1998,
        cost_usd: 9.999,
      });

      expect(result.changes).toBe(0);
      expect(countRows(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('is idempotent when run more than once', () => {
    const db = createTestDb();
    try {
      insertCostEntry(db, {});
      insertCostEntry(db, { input_tokens: 999 });

      migrateCostEntriesUniqueIndex(db);
      const firstRows = db.prepare('SELECT * FROM cost_entries ORDER BY id').all();

      migrateCostEntriesUniqueIndex(db);
      const secondRows = db.prepare('SELECT * FROM cost_entries ORDER BY id').all();

      expect(secondRows).toEqual(firstRows);
      expect(countRows(db)).toBe(1);
    } finally {
      db.close();
    }
  });
});
