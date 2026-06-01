import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getCTXRoot } from '@/lib/config';
import { resolveIdentity, buildPairKey } from '@/lib/comms-identity';
import { loadBusMessages, type BusMessage } from '@/lib/comms-source';

export const dynamic = 'force-dynamic';

interface Channel {
  pair: string; // "agent1--agent2" (alphabetically sorted)
  agents: [string, string];
  last_message: { text: string; timestamp: string; from: string };
  message_count: number;
  last_activity: string;
  archived: boolean;
}

const ARCHIVE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * GET /api/comms/channels — List active agent-pair channels.
 *
 * Groups bus messages by sender-recipient pair. Message sourcing (history
 * log + inbox/processed scan + Telegram logs, deduplicated) is centralized in
 * loadBusMessages() so this list stays in sync with the feed and per-channel
 * views — including agent-to-agent traffic that lives only in processed/.
 *
 * Query params:
 *   include_archived — show archived channels (default false)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const includeArchived = searchParams.get('include_archived') === 'true';

  const ctxRoot = getCTXRoot();
  const identity = resolveIdentity(ctxRoot);
  const inboxBase = path.join(ctxRoot, 'inbox');

  if (!fs.existsSync(inboxBase)) {
    return Response.json([]);
  }

  const unique = loadBusMessages(ctxRoot, identity);

  // Group by agent pair
  const channelMap = new Map<string, BusMessage[]>();
  for (const msg of unique) {
    const pair = buildPairKey(msg.from, msg.to, identity);
    if (!channelMap.has(pair)) channelMap.set(pair, []);
    channelMap.get(pair)!.push(msg);
  }

  const now = Date.now();
  const channels: Channel[] = [];

  for (const [pair, msgs] of channelMap) {
    msgs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const latest = msgs[0];
    const lastActivity = new Date(latest.timestamp).getTime();
    const archived = (now - lastActivity) > ARCHIVE_THRESHOLD_MS;

    if (!includeArchived && archived) continue;

    const agents = pair.split('--') as [string, string];
    channels.push({
      pair,
      agents,
      last_message: { text: latest.text, timestamp: latest.timestamp, from: latest.from },
      message_count: msgs.length,
      last_activity: latest.timestamp,
      archived,
    });
  }

  // Sort by last activity descending
  channels.sort((a, b) => b.last_activity.localeCompare(a.last_activity));

  return Response.json(channels);
}
