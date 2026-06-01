// cortextOS Dashboard - Cost parser
// Parses ~/.claude/projects/*.jsonl AND <ctxRoot>/logs/<agent>/codex-tokens.jsonl
// for token usage and calculates cost.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { db } from '@/lib/db';
import { CTX_ROOT, getAgentsForOrg, getAllAgents, getOrgs } from '@/lib/config';
import type { CostEntry } from '@/lib/types';

// -- Pricing per million tokens --

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheWritePerMillion: number;
  cacheReadPerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  opus: { inputPerMillion: 15, outputPerMillion: 75, cacheWritePerMillion: 3.75, cacheReadPerMillion: 1.50 },
  sonnet: { inputPerMillion: 3, outputPerMillion: 15, cacheWritePerMillion: 3.75, cacheReadPerMillion: 0.30 },
  haiku: { inputPerMillion: 0.8, outputPerMillion: 4, cacheWritePerMillion: 1.00, cacheReadPerMillion: 0.08 },
  // gpt-5-codex: OpenAI list pricing as of 2026-01. cache write n/a (no separate
  // write cost on cached input). Update when codex pricing changes upstream.
  'gpt-5-codex': { inputPerMillion: 1.25, outputPerMillion: 10, cacheWritePerMillion: 0, cacheReadPerMillion: 0.125 },
};

/**
 * Resolve model name to pricing key. Matches substrings: claude variants map to
 * opus/sonnet/haiku; gpt-5-codex (and bare "codex" / "gpt-5" variants) map to
 * gpt-5-codex pricing rather than silently defaulting to sonnet.
 */
function resolvePricingKey(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('haiku')) return 'haiku';
  if (lower.includes('codex') || lower.includes('gpt-5')) return 'gpt-5-codex';
  // Default to sonnet for all other claude models
  return 'sonnet';
}

/**
 * Calculate USD cost for a single entry, including cache token pricing.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens: number = 0,
  cacheReadTokens: number = 0,
): number {
  const key = resolvePricingKey(model);
  const pricing = MODEL_PRICING[key] ?? MODEL_PRICING.sonnet;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * pricing.cacheWritePerMillion;
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  return Math.round((inputCost + outputCost + cacheWriteCost + cacheReadCost) * 1_000_000) / 1_000_000;
}

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

interface RawTokenEntry {
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  timestamp?: string;
  costUSD?: number;
}

/**
 * Parse a single JSONL file and return cost entries.
 */
function parseJsonlFile(filePath: string, agent: string, org: string): CostEntry[] {
  const entries: CostEntry[] = [];

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.split('\n').filter((l) => l.trim());

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      // Claude Code JSONL nests data in .message, plain JSONL has it at top level
      const raw: RawTokenEntry = parsed.message ?? parsed;
      const model = raw.model;
      if (!model) continue;

      const inputTokens = raw.input_tokens ?? raw.usage?.input_tokens ?? 0;
      const outputTokens = raw.output_tokens ?? raw.usage?.output_tokens ?? 0;
      const cacheWriteTokens = raw.usage?.cache_creation_input_tokens ?? 0;
      const cacheReadTokens = raw.usage?.cache_read_input_tokens ?? 0;
      if (inputTokens === 0 && outputTokens === 0 && cacheWriteTokens === 0 && cacheReadTokens === 0) continue;

      const totalTokens = inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens;
      const costUsd = raw.costUSD ?? calculateCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens);
      const timestamp = parsed.timestamp ?? raw.timestamp ?? new Date().toISOString();

      entries.push({
        timestamp,
        agent,
        org,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        cost_usd: costUsd,
        source_file: filePath,
      });
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

/**
 * Decode an encoded ~/.claude/projects dir name into {org, agent}.
 *
 * Format: a filesystem path with slashes replaced by dashes, e.g.
 *   -Users-…-cortextos-orgs-<org>-agents-<agent>
 * Both <org> and <agent> can themselves contain dashes (e.g.
 * "clean-green-marketing", "cortextos-dev-agent"), so the org is EVERYTHING
 * between the "orgs" and "agents" markers and the agent is everything after
 * the last "agents". (The previous code took a single segment — parts[orgsIdx+1]
 * — which yielded "clean" for "clean-green-marketing", failing the org allow-list
 * and silently dropping every agent's transcripts.)
 *
 * Returns a skip reason for dirs that are not agent project dirs (e.g. the
 * primary repo checkout, which has no -orgs-/-agents- markers).
 */
export function parseAgentProjectDir(
  dirName: string,
): { org: string; agent: string } | { skipReason: string } {
  const parts = dirName.split('-');
  const orgsIdx = parts.indexOf('orgs');
  const agentsIdx = parts.lastIndexOf('agents');
  if (orgsIdx < 0 || agentsIdx < 0) return { skipReason: 'missing orgs/agents markers' };
  if (orgsIdx >= agentsIdx) return { skipReason: 'orgs marker not before agents marker' };
  const org = parts.slice(orgsIdx + 1, agentsIdx).join('-');
  const agent = parts.slice(agentsIdx + 1).join('-');
  if (!org) return { skipReason: 'empty org segment' };
  if (!agent) return { skipReason: 'empty agent segment' };
  return { org, agent };
}

/**
 * Scan ~/.claude/projects/ for JSONL files and parse them.
 * Scoped to the current instance's orgs to prevent cross-instance data bleed.
 *
 * Observability (silent-failure class, cf. #459): directory-read and per-file
 * parse errors are logged, not swallowed, and a skip summary is logged so an
 * empty result can never silently masquerade as "no usage".
 */
export function scanClaudeProjectsCosts(): CostEntry[] {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];

  const allowedOrgs = new Set(getOrgs());
  // Also allow the instance ID itself as a fallback org label
  const instanceId = process.env.CTX_INSTANCE_ID ?? 'default';
  allowedOrgs.add(instanceId);

  const allEntries: CostEntry[] = [];
  // Track WHY agent-looking dirs were skipped, so empty results are diagnosable.
  const skips: Record<string, number> = {};
  const note = (reason: string) => { skips[reason] = (skips[reason] ?? 0) + 1; };

  let projectDirs: fs.Dirent[];
  try {
    projectDirs = fs.readdirSync(claudeDir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[cost-parser] cannot read ${claudeDir}: ${(err as Error).message}`);
    return [];
  }

  for (const dir of projectDirs) {
    if (!dir.isDirectory()) continue;
    // Unrelated projects (no 'agents' marker) are silently out of scope.
    if (!dir.name.includes('agents')) continue;

    const parsed = parseAgentProjectDir(dir.name);
    if ('skipReason' in parsed) { note(parsed.skipReason); continue; }
    const { org: orgName, agent: agentName } = parsed;

    // Scope to current instance's orgs — prevent cross-instance bleed
    if (!allowedOrgs.has(orgName)) { note(`org not allowed: ${orgName}`); continue; }

    const projectPath = path.join(claudeDir, dir.name);
    let files: string[];
    try {
      files = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'));
    } catch (err) {
      console.warn(`[cost-parser] cannot read ${projectPath}: ${(err as Error).message}`);
      continue;
    }

    for (const file of files) {
      try {
        allEntries.push(...parseJsonlFile(path.join(projectPath, file), agentName, orgName));
      } catch (err) {
        console.warn(`[cost-parser] failed parsing ${path.join(projectPath, file)}: ${(err as Error).message}`);
      }
    }
  }

  const skipSummary = Object.entries(skips).map(([r, n]) => `${r} ×${n}`).join('; ');
  if (skipSummary) {
    console.log(`[cost-parser] claude projects: ${allEntries.length} entries; skipped agent dirs — ${skipSummary}`);
  }

  return allEntries;
}

// ---------------------------------------------------------------------------
// Codex JSONL scanning
// ---------------------------------------------------------------------------

interface CodexTokenEntry {
  timestamp?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  session_id?: string;
  turn_id?: string;
}

/**
 * Parse a single codex-tokens.jsonl file. Schema differs from claude JSONL:
 * one record per `thread/tokenUsage/updated` notification with the shape
 * written by CodexAppServerPTY.appendCodexTokenLog.
 */
function parseCodexJsonlFile(filePath: string, agent: string, org: string): CostEntry[] {
  const entries: CostEntry[] = [];
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const lines = content.split('\n').filter((l) => l.trim());
  for (const line of lines) {
    try {
      const raw = JSON.parse(line) as CodexTokenEntry;
      const model = raw.model;
      if (!model) continue;

      const inputTokens = raw.input_tokens ?? 0;
      const outputTokens = raw.output_tokens ?? 0;
      const cacheReadTokens = raw.cache_read_tokens ?? 0;
      const cacheWriteTokens = raw.cache_write_tokens ?? 0;
      if (inputTokens === 0 && outputTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) continue;

      const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
      const costUsd = calculateCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens);
      const timestamp = raw.timestamp ?? new Date().toISOString();

      entries.push({
        timestamp,
        agent,
        org,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: totalTokens,
        cost_usd: costUsd,
        source_file: filePath,
      });
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Scan <ctxRoot>/logs/<agent>/codex-tokens.jsonl for every enabled agent.
 * Codex token logs are written per-agent under the instance's logs dir, not
 * under ~/.claude/projects, so we walk the agent registry instead of a single
 * root directory.
 */
export function scanCodexLogsCosts(): CostEntry[] {
  const allEntries: CostEntry[] = [];

  // Build (agent, org) pairs. Prefer getAllAgents so we pick up CLI-created
  // agents; fall back to per-org enumeration if it returns nothing.
  const pairs: Array<{ name: string; org: string }> = getAllAgents();
  if (pairs.length === 0) {
    for (const org of getOrgs()) {
      for (const name of getAgentsForOrg(org)) pairs.push({ name, org });
    }
  }

  for (const { name, org } of pairs) {
    const filePath = path.join(CTX_ROOT, 'logs', name, 'codex-tokens.jsonl');
    if (!fs.existsSync(filePath)) continue;
    allEntries.push(...parseCodexJsonlFile(filePath, name, org));
  }

  return allEntries;
}

// ---------------------------------------------------------------------------
// SQLite persistence
// ---------------------------------------------------------------------------

const INSERT_COST = db.prepare(`
  INSERT OR IGNORE INTO cost_entries (timestamp, agent, org, model, input_tokens, output_tokens, total_tokens, cost_usd, source_file)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

/**
 * Persist cost entries to SQLite. Skips duplicates via INSERT OR IGNORE.
 */
export function persistCostEntries(entries: CostEntry[]): number {
  let inserted = 0;
  const insertMany = db.transaction((items: CostEntry[]) => {
    for (const e of items) {
      const result = INSERT_COST.run(
        e.timestamp,
        e.agent,
        e.org,
        e.model,
        e.input_tokens,
        e.output_tokens,
        e.total_tokens,
        e.cost_usd,
        e.source_file ?? null,
      );
      if (result.changes > 0) inserted++;
    }
  });
  insertMany(entries);
  return inserted;
}

/**
 * Full sync: scan claude JSONL + codex JSONL files and persist to DB.
 *
 * Dedup contract: an (agent, model, source_file, timestamp) tuple from claude
 * scan and codex scan should never collide in practice, because codex turns are
 * only ever written to <ctxRoot>/logs/<agent>/codex-tokens.jsonl while claude
 * turns are only ever written under ~/.claude/projects/. We still build the
 * union explicitly so any future overlap (e.g., a codex agent that also gets
 * scanned through claude's projects dir) does not double-count.
 */
export function syncCosts(): { scanned: number; inserted: number } {
  const claudeEntries = scanClaudeProjectsCosts();
  const codexEntries = scanCodexLogsCosts();

  const seen = new Set<string>();
  const merged: CostEntry[] = [];
  for (const entry of [...claudeEntries, ...codexEntries]) {
    const key = `${entry.source_file ?? ''}|${entry.timestamp}|${entry.model}|${entry.agent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }

  const inserted = merged.length > 0 ? persistCostEntries(merged) : 0;
  return { scanned: merged.length, inserted };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Get cost entries from the DB, newest first.
 */
export function getCostEntries(
  limit: number = 100,
  org?: string,
): CostEntry[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (org) {
    conditions.push('org = ?');
    params.push(org);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    return db
      .prepare(
        `SELECT id, timestamp, agent, org, model, input_tokens, output_tokens, total_tokens, cost_usd, source_file
         FROM cost_entries ${where}
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(...params, limit) as CostEntry[];
  } catch {
    return [];
  }
}

/**
 * Get daily cost totals for the last N days.
 */
export function getDailyCosts(days: number = 30): Array<{ date: string; cost: number }> {
  try {
    const rows = db
      .prepare(
        `SELECT DATE(timestamp) as date, SUM(cost_usd) as cost
         FROM cost_entries
         WHERE timestamp >= DATE('now', ?)
         GROUP BY DATE(timestamp)
         ORDER BY date ASC`,
      )
      .all(`-${days} days`) as Array<{ date: string; cost: number }>;
    return rows;
  } catch {
    return [];
  }
}

/**
 * Get cost totals grouped by model.
 */
export function getCostByModel(): Array<{ model: string; cost: number; tokens: number }> {
  try {
    return db
      .prepare(
        `SELECT model, SUM(cost_usd) as cost, SUM(total_tokens) as tokens
         FROM cost_entries
         GROUP BY model
         ORDER BY cost DESC`,
      )
      .all() as Array<{ model: string; cost: number; tokens: number }>;
  } catch {
    return [];
  }
}

/**
 * Per-agent token + cost breakdown, highest token use first.
 * Optionally scoped to the last `days` (default: all-time).
 */
export function getCostByAgent(
  days?: number,
): Array<{ agent: string; tokens: number; inputTokens: number; outputTokens: number; cost: number }> {
  try {
    const where = days ? `WHERE timestamp >= DATE('now', ?)` : '';
    const stmt = db.prepare(
      `SELECT agent,
              SUM(total_tokens)  as tokens,
              SUM(input_tokens)  as inputTokens,
              SUM(output_tokens) as outputTokens,
              SUM(cost_usd)      as cost
       FROM cost_entries
       ${where}
       GROUP BY agent
       ORDER BY tokens DESC`,
    );
    const rows = (days ? stmt.all(`-${days} days`) : stmt.all()) as Array<{
      agent: string; tokens: number; inputTokens: number; outputTokens: number; cost: number;
    }>;
    return rows;
  } catch {
    return [];
  }
}

/**
 * Get daily cost breakdown by model for stacked bar chart.
 */
export function getDailyCostByModel(
  days: number = 30,
): Array<Record<string, unknown>> {
  try {
    const rows = db
      .prepare(
        `SELECT DATE(timestamp) as date, model, SUM(cost_usd) as cost
         FROM cost_entries
         WHERE timestamp >= DATE('now', ?)
         GROUP BY DATE(timestamp), model
         ORDER BY date ASC`,
      )
      .all(`-${days} days`) as Array<{ date: string; model: string; cost: number }>;

    // Pivot: group by date, model names as keys
    const dateMap = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      if (!dateMap.has(row.date)) {
        dateMap.set(row.date, { date: row.date });
      }
      const entry = dateMap.get(row.date)!;
      const key = resolvePricingKey(row.model);
      entry[key] = ((entry[key] as number) ?? 0) + row.cost;
    }

    return Array.from(dateMap.values());
  } catch {
    return [];
  }
}

/**
 * Get total cost for the current month, useful for projections.
 */
export function getCurrentMonthCost(): number {
  try {
    const row = db
      .prepare(
        `SELECT SUM(cost_usd) as total
         FROM cost_entries
         WHERE timestamp >= DATE('now', 'start of month')`,
      )
      .get() as { total: number | null } | undefined;
    return row?.total ?? 0;
  } catch {
    return 0;
  }
}
