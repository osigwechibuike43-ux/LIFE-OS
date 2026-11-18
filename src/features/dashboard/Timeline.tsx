import { useMemo } from 'react';
import { CalendarClock, CheckSquare, Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PriorityDot } from '@/components/ui';
import { fmtTime, zonedParts } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { CalendarEvent, Priority, Reminder, Task } from '@/types/db';

interface Entry {
  id: string; title: string; kind: 'task' | 'reminder' | 'event'; startMin: number; endMin: number; priority?: Priority; done?: boolean; color?: string;
}

const minutesOf = (iso: string, tz: string) => { const p = zonedParts(iso, tz); return p.hour * 60 + p.minute; };
const labelHour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;

/** Horizontal day timeline of real tasks, reminders and events (modelled on the reference design). */
export function Timeline({ tasks, reminders, events, tz, dayKey }: { tasks: Task[]; reminders: Reminder[]; events: CalendarEvent[]; tz: string; dayKey: string }) {
  const { entries, startH, endH, lanes } = useMemo(() => {
    const list: Entry[] = [];
    const sameDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz }) === dayKey;
    for (const t of tasks) if (t.due_at && sameDay(t.due_at)) { const m = minutesOf(t.due_at, tz); list.push({ id: t.id, title: t.title, kind: 'task', startMin: m, endMin: m + 60, priority: t.priority, done: t.status === 'done' }); }
    for (const r of reminders) if (sameDay(r.remind_at)) { const m = minutesOf(r.remind_at, tz); list.push({ id: r.id, title: r.title, kind: 'reminder', startMin: m, endMin: m + 45, priority: r.priority, done: r.status !== 'pending' }); }
    for (const e of events) {
      const s = sameDay(e.starts_at) ? minutesOf(e.starts_at, tz) : 0;
      const en = sameDay(e.ends_at) ? minutesOf(e.ends_at, tz) : 24 * 60;
      list.push({ id: e.id, title: e.title, kind: 'event', startMin: e.all_day ? 8 * 60 : s, endMin: e.all_day ? 18 * 60 : Math.max(en, s + 45), color: e.color });
    }
    list.sort((a, b) => a.startMin - b.startMin);
    const lo = list.length ? Math.min(8, Math.floor(list[0].startMin / 60)) : 8;
    const hi = list.length ? Math.max(20, Math.ceil(Math.max(...list.map((x) => x.endMin)) / 60)) : 20;
    // Greedy lane assignment so overlapping pills never collide.
    const ends: number[] = [];
    const laneOf = new Map<string, number>();
    for (const e of list) {
      const minWidth = 150; // visual minimum width in minutes-equivalent is handled by percent below
      void minWidth;
      let l = ends.findIndex((x) => x <= e.startMin);
      if (l === -1) { l = ends.length; ends.push(0); }
      ends[l] = Math.max(e.endMin, e.startMin + (hi - lo) * 60 * 0.28);
      laneOf.set(e.id, l);
    }
    return { entries: list.map((e) => ({ ...e, lane: laneOf.get(e.id) ?? 0 })), startH: Math.min(lo, 23), endH: Math.min(hi, 24), lanes: Math.max(ends.length, 1) };
  }, [tasks, reminders, events, tz, dayKey]);

  const span = (endH - startH) * 60;
  const hours = Array.from({ length: endH - startH + 1 }, (_, i) => startH + i);
  const total = entries.length;

  return (
    <section aria-label="Daily timeline" className="rounded-3xl border border-line bg-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium">Daily timeline</h2>
          <span className="hidden h-4 w-px bg-line sm:block" />
          <span className="text-sm text-muted">{total} {total === 1 ? 'item' : 'items'} on this day</span>
        </div>
        <Link to="/app/calendar?new=1" className="text-sm font-medium underline underline-offset-4 hover:text-accent">Add an event</Link>
      </div>

      {/* Wide screens: positioned timeline */}
      <div className="mt-6 hidden md:block">
        <div className="relative" style={{ height: lanes * 56 + 36 }}>
          <div className="absolute inset-x-0 top-0 flex justify-between text-xs text-muted">
            {hours.map((h) => <span key={h} className="w-0 -translate-x-1/2 whitespace-nowrap first:translate-x-0">{labelHour(h)}</span>)}
          </div>
          {hours.map((h, i) => <span key={h} aria-hidden className="absolute bottom-0 top-7 w-px bg-line/70" style={{ left: `${(i / (hours.length - 1)) * 100}%` }} />)}
          {total === 0 && <p className="absolute inset-x-0 top-12 text-center text-sm text-muted">Nothing scheduled. Enjoy the open space, or add a task.</p>}
          {entries.map((e) => {
            const left = Math.min(Math.max(((e.startMin - startH * 60) / span) * 100, 0), 78);
            const width = Math.min(Math.max(((e.endMin - e.startMin) / span) * 100, 24), 100 - left);
            const Icon = e.kind === 'task' ? CheckSquare : e.kind === 'reminder' ? Bell : CalendarClock;
            return (
              <div key={e.id} title={`${e.title} · ${fmtTime(new Date(Date.UTC(2000, 0, 1, 0, e.startMin)).toISOString(), 'UTC')}`}
                className={cn('absolute flex h-11 items-center gap-2.5 overflow-hidden rounded-full border border-line bg-surface-2 px-3.5 text-sm shadow-soft', e.done && 'opacity-55')}
                style={{ left: `${left}%`, width: `${width}%`, top: 36 + e.lane * 56 }}>
                <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className={cn('truncate', e.done && 'line-through')}>{e.title}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-bg/60 px-2.5 py-1 text-[11px] text-muted">
                  {e.priority ? <><PriorityDot priority={e.priority} />{e.priority === 'high' ? 'High' : e.priority === 'low' ? 'Low' : 'Medium'}</>
                    : <><span className="h-2 w-2 rounded-full" style={{ background: e.color }} />Event</>}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: simple chronological list */}
      <ol className="mt-5 space-y-2 md:hidden">
        {total === 0 && <li className="py-6 text-center text-sm text-muted">Nothing scheduled for this day.</li>}
        {entries.map((e) => (
          <li key={e.id} className={cn('flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3.5 py-3', e.done && 'opacity-55')}>
            <span className="w-12 shrink-0 text-xs tabular-nums text-muted">{String(Math.floor(e.startMin / 60)).padStart(2, '0')}:{String(e.startMin % 60).padStart(2, '0')}</span>
            <span className={cn('min-w-0 flex-1 truncate text-sm', e.done && 'line-through')}>{e.title}</span>
            {e.priority ? <PriorityDot priority={e.priority} /> : <span className="h-2 w-2 rounded-full" style={{ background: e.color }} />}
          </li>
        ))}
      </ol>
    </section>
  );
}
