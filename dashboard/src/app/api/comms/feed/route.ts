import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCTXRoot } from '@/lib/config';
import { resolveIdentity } from '@/lib/comms-identity';
import { loadBusMessages } from '@/lib/comms-source';

export const dynamic = 'force-dynamic';

/**
 * GET /api/comms/feed — Org-wide chronological feed of bus messages.
 *
 * Message sourcing (history log + inbox/processed scan + Telegram logs) is
 * centralized in loadBusMessages(); this route only filters and sorts.
 * Returns newest first.
 *
 * Query params:
 *   org    — filter by org (required for agent discovery)
 *   agent  — filter by sender OR recipient
 *   limit  — max messages (default 100, max 500)
 *   before — ISO cursor for pagination
 *   search — text search in message body
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  // `org` param is accepted but not yet applied — agents for different orgs
  // are already isolated at the filesystem level under the configured
  // CTX_ROOT, so the feed naturally scopes to the active org.
  const agentFilter = searchParams.get('agent') || '';
  const defaultLimit = 200;
  const maxLimit = 500;
  const rawLimit = parseInt(searchParams.get('limit') ?? String(defaultLimit), 10) || defaultLimit;
  const before = searchParams.get('before');
  const search = searchParams.get('search')?.toLowerCase().trim() || '';
  // When searching, scan all messages (capped at maxLimit). When not
  // searching, use the requested limit (default 200) for the recent view.
  const limit = search ? maxLimit : Math.min(Math.max(rawLimit, 1), maxLimit);
  // Word-boundary search: build a regex so "help" matches "help" and
  // "helpful" but not "chelp". Falls back to substring if the search
  // term contains characters that break regex construction.
  let searchRegex: RegExp | null = null;
  if (search) {
    try {
      searchRegex = new RegExp(`\\b${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    } catch {
      searchRegex = null; // fall back to includes
    }
  }
  function matchesSearch(text: string): boolean {
    if (!search) return true;
    if (searchRegex) return searchRegex.test(text);
    return text.toLowerCase().includes(search);
  }

  const ctxRoot = getCTXRoot();
  const identity = resolveIdentity(ctxRoot);
  const inboxBase = path.join(ctxRoot, 'inbox');

  if (!fs.existsSync(inboxBase)) {
    return Response.json([]);
  }

  // Single source of truth for message loading (history log + inbox/processed
  // scan + Telegram logs, deduplicated). This route applies the feed's own
  // filters and newest-first ordering.
  const messages = loadBusMessages(ctxRoot, identity).filter(msg => {
    if (agentFilter && msg.from !== agentFilter && msg.to !== agentFilter) return false;
    if (!matchesSearch(msg.text)) return false;
    if (before && msg.timestamp >= before) return false;
    return true;
  });

  // Sort by timestamp descending (newest first)
  messages.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return Response.json(messages.slice(0, limit));
}
