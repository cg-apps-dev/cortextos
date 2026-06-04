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

// "how long has it been open" without the trailing "ago"
function openFor(iso?: string): string {
  const a = relativeAge(iso);
  return a === 'just now' ? 'under a minute' : a.replace(' ago', '');
}

function formatAssigned(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function MyTasksPage() {
  const { currentOrg } = useOrg();

  const [pending, setPending] = useState<Task[]>([]);
  const [doneToday, setDoneToday] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const fetchItems = useCallback(async () => {
    const base = new URLSearchParams();
    base.set('agent', 'human'); // virtual filter: [HUMAN] titles, assignee human/user, project=human-tasks
    if (currentOrg && currentOrg !== 'all') base.set('org', currentOrg);

    const pendingParams = new URLSearchParams(base);
    pendingParams.set('status', 'pending');
    // Blocked human tasks are still action items that need attention — fetch them too.
    // (Bug fix: previously only pending+completed were fetched, so status=blocked
    // human-tasks were dropped by the status filter and never rendered here.)
    const blockedParams = new URLSearchParams(base);
    blockedParams.set('status', 'blocked');
    const completedParams = new URLSearchParams(base);
    completedParams.set('status', 'completed');

    try {
      const [pRes, bRes, cRes] = await Promise.all([
        fetch(`/api/tasks?${pendingParams.toString()}`),
        fetch(`/api/tasks?${blockedParams.toString()}`),
        fetch(`/api/tasks?${completedParams.toString()}`),
      ]);
      if (pRes.ok || bRes.ok) {
        const active: Task[] = [];
        if (pRes.ok) active.push(...((await pRes.json()) as Task[]));
        if (bRes.ok) active.push(...((await bRes.json()) as Task[]));
        setPending(active);
      }
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
            const isOpen = expanded.has(task.id);
            return (
              <li
                key={task.id}
                className="rounded-lg border border-border bg-card transition-colors hover:border-violet-500/40"
              >
                <div className="flex items-start gap-3 p-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={busy}
                    disabled={busy}
                    onCheckedChange={() => complete(task)}
                    aria-label={`Mark "${cleanTitle(task.title)}" done`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleExpand(task.id)}
                    aria-expanded={isOpen}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium leading-snug">{cleanTitle(task.title)}</span>
                      <Badge variant="outline" className={cat.cls}>{cat.label}</Badge>
                      {task.priority && task.priority !== 'normal' && (
                        <Badge variant="outline" className={PRIORITY_STYLES[task.priority] ?? ''}>
                          {task.priority}
                        </Badge>
                      )}
                      <span className="ml-auto shrink-0 text-muted-foreground">
                        {isOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                      </span>
                    </div>
                    {!isOpen && (
                      <p className="mt-1 text-xs text-muted-foreground">Open {relativeAge(task.created_at)}</p>
                    )}
                  </button>
                </div>
                {isOpen && (
                  <div className="space-y-3 border-t border-border px-3 pb-3 pt-3 pl-11 text-sm">
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Instructions
                      </p>
                      <p className="whitespace-pre-wrap text-foreground">
                        {task.description || 'No additional details provided.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                      <span><span className="text-foreground/70">Assigned:</span> {formatAssigned(task.created_at)}</span>
                      <span><span className="text-foreground/70">Open for:</span> {openFor(task.created_at)}</span>
                      {task.project && <span><span className="text-foreground/70">Project:</span> {task.project}</span>}
                      <span><span className="text-foreground/70">Priority:</span> {task.priority}</span>
                    </div>
                  </div>
                )}
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
