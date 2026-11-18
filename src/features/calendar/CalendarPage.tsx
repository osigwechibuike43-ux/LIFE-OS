import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, CalendarDays, CheckSquare, ChevronLeft, ChevronRight, MapPin, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, ErrorState, Input, Modal, PageHeader, Skeleton, Switch, Tabs, Textarea } from '@/components/ui';
import { useAppMutation, usePrefs, useTimezone, useUserQuery } from '@/hooks/queries';
import { addDaysToKey, fmtKey, fmtTime, fromIso, localDateKey, localDayRange, monthGrid, toIso, weekDays } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { eventFormSchema, fieldErrors } from '@/lib/validation';
import { eventApi, reminderApi, taskApi } from '@/services/data';
import type { CalendarEvent } from '@/types/db';

type View = 'month' | 'week' | 'day';
const COLORS = ['#817AFF', '#38BDF8', '#F5B544', '#34D399', '#F472B6', '#94A3B8'];

interface Item { id: string; kind: 'event' | 'task' | 'reminder'; title: string; at: string; key: string; color: string; done?: boolean; event?: CalendarEvent }

export default function CalendarPage() {
  const tz = useTimezone();
  const prefs = usePrefs();
  const [params, setParams] = useSearchParams();
  const today = localDateKey(new Date(), tz);
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState(today);
  const [modal, setModal] = useState<{ open: boolean; event: CalendarEvent | null; date: string }>({ open: false, event: null, date: today });
  const weekStart = prefs.data?.week_starts_on ?? 1;

  useEffect(() => {
    if (params.get('new') === '1') { setModal({ open: true, event: null, date: selected }); const p = new URLSearchParams(params); p.delete('new'); setParams(p, { replace: true }); }
  }, [params, setParams, selected]);

  const days = useMemo(() => (view === 'month' ? monthGrid(anchor, weekStart) : view === 'week' ? weekDays(anchor, weekStart) : [anchor]), [view, anchor, weekStart]);
  const rangeStart = localDayRange(days[0], tz).start.toISOString();
  const rangeEnd = localDayRange(days[days.length - 1], tz).end.toISOString();

  const events = useUserQuery(['events', 'range', rangeStart, rangeEnd], () => eventApi.range(rangeStart, rangeEnd));
  const tasks = useUserQuery(['tasks', 'range', rangeStart, rangeEnd], () => taskApi.range(rangeStart, rangeEnd));
  const reminders = useUserQuery(['reminders', 'range', rangeStart, rangeEnd], () => reminderApi.range(rangeStart, rangeEnd));

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    const add = (it: Item) => m.set(it.key, [...(m.get(it.key) ?? []), it]);
    for (const e of events.data ?? []) {
      // Multi-day events appear on each day they span.
      let k = localDateKey(e.starts_at, tz); const last = localDateKey(new Date(new Date(e.ends_at).getTime() - 1), tz);
      for (let i = 0; i < 31 && k <= last; i++, k = addDaysToKey(k, 1)) add({ id: e.id, kind: 'event', title: e.title, at: e.starts_at, key: k, color: e.color, event: e });
    }
    for (const t of tasks.data ?? []) if (t.due_at) add({ id: t.id, kind: 'task', title: t.title, at: t.due_at, key: localDateKey(t.due_at, tz), color: 'rgb(var(--accent))', done: t.status === 'done' });
    for (const r of reminders.data ?? []) add({ id: r.id, kind: 'reminder', title: r.title, at: r.remind_at, key: localDateKey(r.remind_at, tz), color: 'rgb(var(--amber))', done: r.status !== 'pending' });
    for (const [k, v] of m) m.set(k, v.sort((a, b) => a.at.localeCompare(b.at)));
    return m;
  }, [events.data, tasks.data, reminders.data, tz]);

  const shift = (dir: -1 | 1) => setAnchor((a) => {
    if (view === 'day') return addDaysToKey(a, dir);
    if (view === 'week') return addDaysToKey(a, dir * 7);
    const [y, m] = a.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + dir, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  });

  const title = view === 'month' ? fmtKey(anchor, { month: 'long', year: 'numeric' }) : view === 'week' ? `${fmtKey(days[0], { day: 'numeric', month: 'short' })} – ${fmtKey(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}` : fmtKey(anchor, { weekday: 'long', day: 'numeric', month: 'long' });
  const loading = events.isLoading || tasks.isLoading || reminders.isLoading;
  const failed = events.isError || tasks.isError || reminders.isError;
  const selectedItems = byDay.get(selected) ?? [];
  const dayNames = weekDays('2026-11-16', weekStart).map((k) => fmtKey(k, { weekday: 'short' }));
  const inMonth = (k: string) => k.slice(0, 7) === anchor.slice(0, 7);

  return (
    <div>
      <PageHeader title="Calendar" description="Events, task deadlines and reminders in one view."
        actions={<Button onClick={() => setModal({ open: true, event: null, date: selected })}><Plus className="h-4 w-4" />New event</Button>} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" className="h-9 w-9" onClick={() => shift(-1)} aria-label="Previous"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="secondary" size="icon" className="h-9 w-9" onClick={() => shift(1)} aria-label="Next"><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="secondary" size="sm" onClick={() => { setAnchor(today); setSelected(today); }}>Today</Button>
          <h2 className="ml-2 text-lg font-semibold">{title}</h2>
        </div>
        <Tabs<View> value={view} onChange={(v) => { setView(v); setAnchor(selected); }} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }]} />
      </div>

      {failed ? <ErrorState message="Could not load your calendar." onRetry={() => { void events.refetch(); void tasks.refetch(); void reminders.refetch(); }} /> : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="card overflow-hidden">
            {view === 'month' && (
              <>
                <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">{dayNames.map((d) => <div key={d} className="py-2">{d}</div>)}</div>
                <div className="grid grid-cols-7">
                  {days.map((k) => {
                    const items = byDay.get(k) ?? [];
                    return (
                      <button key={k} onClick={() => { setSelected(k); }} onDoubleClick={() => setModal({ open: true, event: null, date: k })}
                        aria-label={`${fmtKey(k, { weekday: 'long', day: 'numeric', month: 'long' })}, ${items.length} items`} aria-pressed={selected === k}
                        className={cn('min-h-[72px] border-b border-r border-line/60 p-1.5 text-left transition-colors hover:bg-surface-2 sm:min-h-[104px] sm:p-2', !inMonth(k) && 'bg-surface-2/40 text-muted', selected === k && 'bg-accent/8')}>
                        <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full text-xs', k === today && 'bg-accent font-semibold text-accent-fg')}>{Number(k.slice(8))}</span>
                        <div className="mt-1 hidden space-y-0.5 sm:block">
                          {items.slice(0, 3).map((i) => <div key={i.kind + i.id} className={cn('truncate rounded px-1.5 py-0.5 text-[11px]', i.done && 'line-through opacity-60')} style={{ background: `color-mix(in srgb, ${i.color} 18%, transparent)` }}>{i.title}</div>)}
                          {items.length > 3 && <div className="px-1 text-[11px] text-muted">+{items.length - 3} more</div>}
                        </div>
                        <div className="mt-1 flex gap-0.5 sm:hidden">{items.slice(0, 4).map((i) => <span key={i.kind + i.id} className="h-1.5 w-1.5 rounded-full" style={{ background: i.color }} />)}</div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {view !== 'month' && (
              <div className={cn('grid divide-x divide-line/60', view === 'week' ? 'grid-cols-1 sm:grid-cols-7' : 'grid-cols-1')}>
                {days.map((k) => {
                  const items = byDay.get(k) ?? [];
                  return (
                    <div key={k} className={cn('min-h-[200px] p-3', selected === k && view === 'week' && 'bg-accent/5')}>
                      <button onClick={() => setSelected(k)} className="mb-2 block text-left">
                        <span className="block text-xs text-muted">{fmtKey(k, { weekday: 'short' })}</span>
                        <span className={cn('inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-sm font-semibold', k === today && 'bg-accent text-accent-fg')}>{Number(k.slice(8))}</span>
                      </button>
                      {loading ? <Skeleton className="h-8" /> : items.length === 0 ? <p className="text-xs text-muted">Free</p> : (
                        <ul className="space-y-1.5">
                          {items.map((i) => <ItemRow key={i.kind + i.id} item={i} tz={tz} onEdit={(e) => setModal({ open: true, event: e, date: k })} />)}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Selected day / upcoming */}
          <aside className="card h-fit p-4" aria-label="Selected day">
            <h3 className="text-sm font-semibold">{fmtKey(selected, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
            <div className="mt-3 space-y-1.5">
              {loading ? <Skeleton className="h-16" /> : selectedItems.length === 0
                ? <div className="py-6 text-center"><CalendarDays className="mx-auto h-6 w-6 text-muted" /><p className="mt-2 text-sm text-muted">Nothing planned.</p>
                    <Button size="sm" variant="secondary" className="mt-3" onClick={() => setModal({ open: true, event: null, date: selected })}>Add event</Button></div>
                : <ul className="space-y-1.5">{selectedItems.map((i) => <ItemRow key={i.kind + i.id} item={i} tz={tz} onEdit={(e) => setModal({ open: true, event: e, date: selected })} />)}</ul>}
            </div>
          </aside>
        </div>
      )}
      <EventModal open={modal.open} event={modal.event} date={modal.date} onClose={() => setModal((m) => ({ ...m, open: false }))} />
    </div>
  );
}

function ItemRow({ item, tz, onEdit }: { item: Item; tz: string; onEdit: (e: CalendarEvent) => void }) {
  const Icon = item.kind === 'task' ? CheckSquare : item.kind === 'reminder' ? Bell : null;
  const inner = (
    <>
      {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: item.color }} /> : <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />}
      <span className="w-11 shrink-0 text-xs tabular-nums text-muted">{item.event?.all_day ? 'All day' : fmtTime(item.at, tz)}</span>
      <span className={cn('min-w-0 flex-1 truncate text-sm', item.done && 'line-through opacity-60')}>{item.title}</span>
    </>
  );
  return item.event
    ? <li><button onClick={() => onEdit(item.event!)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">{inner}</button></li>
    : <li className="flex items-center gap-2 px-2 py-1.5">{inner}</li>;
}

function EventModal({ open, onClose, event, date }: { open: boolean; onClose: () => void; event: CalendarEvent | null; date: string }) {
  const tz = useTimezone();
  const [f, setF] = useState({ title: '', description: '', location: '', date, start: '09:00', end: '10:00', all_day: false, color: COLORS[0] });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (event) { const s = fromIso(event.starts_at, tz); const e = fromIso(event.ends_at, tz); setF({ title: event.title, description: event.description ?? '', location: event.location ?? '', date: s.date, start: s.time, end: e.time, all_day: event.all_day, color: event.color }); }
    else setF({ title: '', description: '', location: '', date, start: '09:00', end: '10:00', all_day: false, color: COLORS[0] });
  }, [open, event, date, tz]);

  const save = useAppMutation((v: Omit<CalendarEvent, 'id'>) => (event ? eventApi.update(event.id, v) : eventApi.create(v)),
    { invalidate: ['events'], success: event ? 'Event updated' : 'Event added', onSuccess: onClose });
  const remove = useAppMutation(() => eventApi.remove(event!.id), { invalidate: ['events'], success: 'Event deleted', onSuccess: () => { setConfirm(false); onClose(); } });

  function submit() {
    const parsed = eventFormSchema.safeParse(f);
    if (!parsed.success) return setErrors(fieldErrors(parsed));
    setErrors({});
    const v = parsed.data;
    save.mutate({
      title: v.title, description: v.description?.trim() || null, location: v.location?.trim() || null, all_day: v.all_day, color: v.color,
      starts_at: toIso(v.date, v.all_day ? '00:00' : v.start, tz), ends_at: v.all_day ? toIso(addDaysToKey(v.date, 1), '00:00', tz) : toIso(v.date, v.end, tz),
    });
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  return (
    <>
      <Modal open={open} onClose={onClose} title={event ? 'Edit event' : 'New event'}
        footer={<>{event && <Button variant="ghost" className="mr-auto text-danger" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" />Delete</Button>}<Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={save.isPending}>Save</Button></>}>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
          <Input label="Title" value={f.title} onChange={set('title')} error={errors.title} maxLength={300} />
          <Input label="Date" type="date" value={f.date} onChange={set('date')} error={errors.date} />
          <Switch checked={f.all_day} onChange={(v) => setF((s) => ({ ...s, all_day: v }))} label="All day" />
          {!f.all_day && <div className="grid grid-cols-2 gap-3"><Input label="Starts" type="time" value={f.start} onChange={set('start')} error={errors.start} /><Input label="Ends" type="time" value={f.end} onChange={set('end')} error={errors.end} /></div>}
          <div className="relative"><Input label="Location" value={f.location} onChange={set('location')} maxLength={300} className="pl-9" /><MapPin className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-muted" /></div>
          <Textarea label="Notes" value={f.description} onChange={set('description')} maxLength={5000} />
          <div><p className="label">Colour</p><div className="flex gap-2">{COLORS.map((c) => <button type="button" key={c} onClick={() => setF((s) => ({ ...s, color: c }))} aria-label={`Colour ${c}`} aria-pressed={f.color === c} className={cn('h-7 w-7 rounded-full ring-offset-2 ring-offset-surface', f.color === c && 'ring-2 ring-accent')} style={{ background: c }} />)}</div></div>
        </form>
      </Modal>
      <ConfirmDialog open={confirm} title="Delete event?" message="This event will be permanently deleted." loading={remove.isPending} onClose={() => setConfirm(false)} onConfirm={() => remove.mutate(undefined)} />
    </>
  );
}
