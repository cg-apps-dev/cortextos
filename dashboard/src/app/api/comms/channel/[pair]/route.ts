import { NextRequest } from 'next/server';
import { getCTXRoot } from '@/lib/config';
import { resolveIdentity, buildPairKey } from '@/lib/comms-identity';
import { loadBusMessages } from '@/lib/comms-source';

export const dynamic = 'force-dynamic';

/**
 * GET /api/comms/channel/[pair] — Messages for a specific agent pair.
 * pair = "agent1--agent2" (alphabetically sorted).
 *
 * Message sourcing (history log + inbox/processed scan + Telegram logs,
 * deduplicated) is centralized in loadBusMessages(); this route filters to the
 * requested pair and returns them oldest-first for the chat view. Agent-to-
 * agent messages live in processed/{agent}/ — loadBusMessages reads that
 * canonical location (an earlier version scanned a non-existent
 * inbox/{agent}/processed path, which is why this view showed "No messages").
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ pair: string }> },
) {
  const { pair } = await params;
  const agents = pair.split('--');
  if (agents.length !== 2 || !agents.every(a => /^[a-z0-9_-]+$/.test(a))) {
    return Response.json({ error: 'Invalid pair format. Use agent1--agent2' }, { status: 400 });
  }

  const { searchParams } = request.nextUrl;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 1), 500);
  const before = searchParams.get('before');
  const search = searchParams.get('search')?.toLowerCase().trim() || '';
  let searchRegex: RegExp | null = null;
  if (search) {
    try {
      searchRegex = new RegExp(`\\b${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    } catch { searchRegex = null; }
  }
  function matchesSearch(text: string): boolean {
    if (!search) return true;
    if (searchRegex) return searchRegex.test(text);
    return text.toLowerCase().includes(search);
  }

  const ctxRoot = getCTXRoot();

  // Resolve user identity so inbound and outbound Telegram messages
  // land in the same channel as bus messages for the same conversation.
  const identity = resolveIdentity(ctxRoot);

  // Centralized load (history + processed/{agent} + inbox pending/inflight +
  // Telegram, deduplicated), then filter to this pair.
  const messages = loadBusMessages(ctxRoot, identity).filter(msg => {
    if (buildPairKey(msg.from, msg.to, identity) !== pair) return false;
    if (!matchesSearch(msg.text)) return false;
    if (before && msg.timestamp >= before) return false;
    return true;
  });

  // Sort by timestamp ascending (oldest first for chat view)
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return Response.json(messages.slice(-limit));
}
