import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getTasks } from '@/lib/data/tasks';
import { detectHumanSignals } from '@/lib/human-ask-signals';
import { getCTXRoot } from '@/lib/config';

export const dynamic = 'force-dynamic';

// Detective lane: surface non-completed tasks that MIGHT secretly need a human
// but were NOT auto-routed to human-tasks (high recall). A human Promotes the
// real ones (-> project=human-tasks, via PUT /api/tasks/[id]) or Dismisses the
// noise (persisted suppress-list below). Distinct from My Action Items, which
// shows already-confirmed human work.

const MAX_CANDIDATES = 50;

// One flat suppress-list of dismissed task IDs. Task IDs are globally unique
// (task_<epoch>_<rand>), so a single file avoids per-org bookkeeping.
function dismissedPath(): string {
  return path.join(getCTXRoot(), 'config', 'human-blocked-dismissed.json');
}

function readDismissed(): Set<string> {
  try {
    const raw = fs.readFileSync(dismissedPath(), 'utf-8');
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>): void {
  const file = dismissedPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify([...ids], null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id) && id.length <= 128;
}

// A task already surfaces in My Action Items if it is attributed to a human —
// don't double-list it as a candidate.
function isAlreadyHuman(t: { assignee?: string; title?: string; project?: string }): boolean {
  return (
    t.project === 'human-tasks' ||
    t.assignee === 'human' ||
    t.assignee === 'user' ||
    /^\s*\[HUMAN\]/i.test(t.title || '')
  );
}

// GET /api/tasks/human-blocked-candidates?org=X — list candidate tasks.
export async function GET(request: NextRequest) {
  try {
    const orgParam = request.nextUrl.searchParams.get('org');
    const org = orgParam && orgParam !== 'all' ? orgParam : undefined;

    const dismissed = readDismissed();
    const all = getTasks(org ? { org } : undefined);

    const candidates = all
      .filter((t) => t.status !== 'completed')
      .filter((t) => !isAlreadyHuman(t))
      .filter((t) => !dismissed.has(t.id))
      .map((t) => {
        const sig = detectHumanSignals(t.title || '', t.description || '');
        return sig.matched ? { ...t, signals: sig.signals } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    const truncated = candidates.length > MAX_CANDIDATES;
    return Response.json({
      candidates: candidates.slice(0, MAX_CANDIDATES),
      total: candidates.length,
      truncated,
    });
  } catch (err) {
    console.error('[api/tasks/human-blocked-candidates] GET error:', err);
    return Response.json({ candidates: [], total: 0, truncated: false }, { status: 500 });
  }
}

// POST /api/tasks/human-blocked-candidates — dismiss/undismiss a candidate.
// Body: { id, action: 'dismiss' | 'undismiss' }
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { id, action } = body as { id?: string; action?: string };
  if (!isValidId(id)) {
    return Response.json({ error: 'Invalid task ID' }, { status: 400 });
  }
  if (action !== 'dismiss' && action !== 'undismiss') {
    return Response.json({ error: "action must be 'dismiss' or 'undismiss'" }, { status: 400 });
  }

  try {
    const dismissed = readDismissed();
    if (action === 'dismiss') dismissed.add(id);
    else dismissed.delete(id);
    writeDismissed(dismissed);
    return Response.json({ success: true });
  } catch (err) {
    console.error('[api/tasks/human-blocked-candidates] POST error:', err);
    return Response.json({ error: 'Failed to update suppress-list' }, { status: 500 });
  }
}
