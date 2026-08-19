/**
 * cost-parser-isolated-claude.test.ts — coverage for per-agent CLAUDE_CONFIG_DIR
 * ("claude-home") transcript ingestion + the per-source ingestion-staleness watch.
 *
 * Regression target: per-agent Claude config isolation (CLI `claude-home`) moved
 * each agent's transcripts from ~/.claude/projects to
 * <ctxRoot>/state/<agent>/claude-home/projects. The parser scanned ONLY the
 * former, so once agents were isolated their Claude-side cost ingestion silently
 * froze (~2026-07-12) while codex (its own <ctxRoot>/logs path) kept working.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-parser-isolated-test-'));
process.env.CTX_ROOT = tmpDir;
process.env.CTX_FRAMEWORK_ROOT = tmpDir;

let scanClaudeProjectsCosts: typeof import('../cost-parser')['scanClaudeProjectsCosts'];
let checkCostIngestionStaleness: typeof import('../cost-parser')['checkCostIngestionStaleness'];
let syncCosts: typeof import('../cost-parser')['syncCosts'];
let db: typeof import('../db')['db'];

const AGENT = 'iso-claude-agent';
const ORG = 'acme';

beforeAll(async () => {
  const mod = await import('../cost-parser');
  scanClaudeProjectsCosts = mod.scanClaudeProjectsCosts;
  checkCostIngestionStaleness = mod.checkCostIngestionStaleness;
  syncCosts = mod.syncCosts;
  db = (await import('../db')).db;

  // enabled-agents.json → getAllAgents() returns our fixture agent.
  const cfgDir = path.join(tmpDir, 'config');
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, 'enabled-agents.json'),
    JSON.stringify({ [AGENT]: { enabled: true, org: ORG } }, null, 2),
  );
  // orgs/<org> dir → getOrgs() returns ORG, so the org-scope allow-list admits it.
  fs.mkdirSync(path.join(tmpDir, 'orgs', ORG), { recursive: true });
});

beforeEach(() => {
  // Wipe the isolated state tree AND this agent's ledger rows between tests
  // (the DB persists across tests; only the fs fixtures are per-test).
  const stateDir = path.join(tmpDir, 'state');
  if (fs.existsSync(stateDir)) fs.rmSync(stateDir, { recursive: true, force: true });
  db.prepare('DELETE FROM cost_entries WHERE agent = ?').run(AGENT);
});

// Write a Claude transcript into an agent's ISOLATED claude-home projects dir.
function writeClaudeHomeJsonl(
  agent: string,
  org: string,
  lines: Array<Record<string, unknown>>,
  mtime?: Date,
): string {
  const encoded = `-Users-x-cortextos-orgs-${org}-agents-${agent}`;
  const dir = path.join(tmpDir, 'state', agent, 'claude-home', 'projects', encoded);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'session-0001.jsonl');
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  if (mtime) fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

const claudeLine = (timestamp: string) => ({
  timestamp,
  message: {
    model: 'claude-3-5-sonnet-20240620',
    usage: { input_tokens: 100, output_tokens: 50 },
  },
});

describe('scanClaudeProjectsCosts — isolated per-agent claude-home', () => {
  it('ingests transcripts from an agent CLAUDE_CONFIG_DIR/projects (the isolation orphan fix)', () => {
    writeClaudeHomeJsonl(AGENT, ORG, [claudeLine('2026-08-19T00:00:00.000Z')]);
    const mine = scanClaudeProjectsCosts().filter((e) => e.agent === AGENT && e.org === ORG);
    expect(mine).toHaveLength(1);
    expect(mine[0].model).toContain('sonnet');
    expect(mine[0].total_tokens).toBe(150);
    expect(mine[0].source_file).toContain(
      path.join('state', AGENT, 'claude-home', 'projects'),
    );
  });

  it('returns nothing for the agent when it has no isolated transcript', () => {
    const mine = scanClaudeProjectsCosts().filter((e) => e.agent === AGENT);
    expect(mine).toHaveLength(0);
  });
});

describe('checkCostIngestionStaleness — per-source watch', () => {
  it('flags an agent with a FRESH transcript but an absent ledger', () => {
    writeClaudeHomeJsonl(AGENT, ORG, [claudeLine('2026-08-19T00:00:00.000Z')]); // mtime = now
    const stale = checkCostIngestionStaleness(Date.now());
    expect(stale.some((s) => s.agent === AGENT)).toBe(true);
  });

  it('does NOT flag once the ledger reflects the fresh transcript (post-sync)', () => {
    writeClaudeHomeJsonl(AGENT, ORG, [claudeLine(new Date().toISOString())]);
    syncCosts(); // ingests → a fresh cost_entry now exists for the agent
    const stale = checkCostIngestionStaleness(Date.now());
    expect(stale.some((s) => s.agent === AGENT)).toBe(false);
  });

  it('does NOT flag an agent whose source is itself old (just quiet, not broken)', () => {
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    writeClaudeHomeJsonl(AGENT, ORG, [claudeLine('2026-08-09T00:00:00.000Z')], old);
    const stale = checkCostIngestionStaleness(Date.now());
    expect(stale.some((s) => s.agent === AGENT)).toBe(false);
  });
});
