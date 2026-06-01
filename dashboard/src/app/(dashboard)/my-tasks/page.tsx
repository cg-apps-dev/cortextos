'use client';

import { useEffect, useState, useCallback } from 'react';
import { useOrg } from '@/hooks/use-org';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  IconChecklist,
  IconCircleCheck,
  IconChevronDown,
  IconChevronRight,
  IconRefresh,
} from '@tabler/icons-react';
import type { Task } from '@/lib/types';

// Adam's personal action list. Surfaces every task that needs a human —
// [HUMAN] tasks, decisions awaiting sign-off, and action-reminders — as a
// clean checklist. Checking an item routes through the real completion path
// (PATCH -> complete-task.sh), which already notifies the agent that created
// it so their blocked work unblocks. No new sync layer: the cortextOS task
// store stays the single source of truth.

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  normal: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  low: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

// Classify an item by its title convention so the list reads at a glance.
function categoryOf(task: Task): { label: string; cls: string } {
  const t = task.title || '';
  if (/^\[HUMAN\]/i.test(t)) return { label: 'Setup', cls: 'bg-violet-500/15 text-violet-400 border-violet-500/30' };
  if (/^\[DECISION\]/i.test(t)) return { label: 'Decision', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
  if (/^\[REMINDER\]/i.test(t)) return { label: 'Reminder', cls: 'bg-teal-500/15 text-teal-400 border-teal-500/30' };
  return { label: 'To-do', cls: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30' };
}

// Strip the leading [TAG] from the title for clean display.
function cleanTitle(title: string): string {
  return (title || '').replace(/^\[(HUMAN|DECISION|REMINDER)\]\s*/i, '').trim();
}

function relativeAge(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function MyTasksPage() {
  const { currentOrg } = useOrg();

  const [pending, setPending] = useState<Task[]>([]);
  const [doneToday, setDoneToday] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);

  const fetchItems = useCallback(async () => {
    const base = new URLSearchParams();
    base.set('agent', 'human'); // virtual filter: [HUMAN] titles, assignee human/user, project=human-tasks
    if (currentOrg && currentOrg !== 'all') base.set('org', currentOrg);

    const pendingParams = new URLSearchParams(base);
    pendingParams.set('status', 'pending');
    const completedParams = new URLSearchParams(base);
    completedParams.set('status', 'completed');

    try {
      const [pRes, cRes] = await Promise.all([
        fetch(`/api/tasks?${pendingParams.toString()}`),
        fetch(`/api/tasks?${completedParams.toString()}`),
      ]);
      if (pRes.ok) setPending(await pRes.json());
      if (cRes.ok) {
        const data: Task[] = await cRes.json();
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);
        setDoneToday(
          data.filter((t) => t.completed_at && new Date(t.completed_at) >= dayStart),
        );
      }
    } catch {
      /* leave existing state on transient failure */
    } finally {
      setLoading(false);
    }
  }, [currentOrg]);

  useEffect(() => {
    fetchItems();
    const id = setInterval(fetchItems, 20000); // keep the list live as agents add items
    return () => clearInterval(id);
  }, [fetchItems]);

  async function complete(task: Task) {
    if (checking.has(task.id)) return;
    setChecking((s) => new Set(s).add(task.id));
    // optimistic: move it out of pending immediately
    setPending((items) => items.filter((t) => t.id !== task.id));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' }),
      });
      if (!res.ok) throw new Error('failed');
      // reflect in done-today + refresh from source of truth
      setDoneToday((d) => [{ ...task, status: 'completed', completed_at: new Date().toISOString() }, ...d]);
      fetchItems();
    } catch {
      // rollback on failure
      setPending((items) => [task, ...items]);
    } finally {
      setChecking((s) => {
        const n = new Set(s);
        n.delete(task.id);
        return n;
      });
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <IconChecklist size={24} className="text-violet-400" />
            My Action Items
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything that needs you — setup tasks, decisions, and reminders. Check them off as you go;
            the agent waiting on each one is unblocked automatically.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => fetchItems()} title="Refresh">
          <IconRefresh size={16} />
        </Button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : pending.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <IconCircleCheck size={32} className="mx-auto mb-3 text-emerald-400" />
          <p className="text-base font-medium">You&apos;re all caught up 🎉</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing needs you right now. New items will appear here automatically.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {pending.map((task) => {
            const cat = categoryOf(task);
            const busy = checking.has(task.id);
            return (
              <li
                key={task.id}
                className="group flex items-start gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-violet-500/40"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={busy}
                  disabled={busy}
                  onCheckedChange={() => complete(task)}
                  aria-label={`Mark "${cleanTitle(task.title)}" done`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium leading-snug">{cleanTitle(task.title)}</span>
                    <Badge variant="outline" className={cat.cls}>{cat.label}</Badge>
                    {task.priority && task.priority !== 'normal' && (
                      <Badge variant="outline" className={PRIORITY_STYLES[task.priority] ?? ''}>
                        {task.priority}
                      </Badge>
                    )}
                  </div>
                  {task.description && (
                    <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{task.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {relativeAge(task.created_at)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {doneToday.length > 0 && (
        <div className="mt-8">
          <button
            onClick={() => setShowDone((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {showDone ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            Done today ({doneToday.length})
          </button>
          {showDone && (
            <ul className="mt-3 space-y-1.5">
              {doneToday.map((task) => (
                <li key={task.id} className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                  <IconCircleCheck size={16} className="shrink-0 text-emerald-400" />
                  <span className="line-through">{cleanTitle(task.title)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
