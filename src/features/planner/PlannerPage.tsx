import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCircle2, Plus, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorState, Input, PageHeader, PriorityDot, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useAppMutation, useTimezone, useUserQuery } from '@/hooks/queries';
import { useInsights } from '@/hooks/useInsights';
import { addDaysToKey, fmtKey, fmtTime, localDateKey, localDayRange } from '@/lib/dates';
import { cn, errorMessage } from '@/lib/utils';
import { streamMessage, AiError } from '@/services/ai';
import { eventApi, planApi, reminderApi, taskApi } from '@/services/data';
import type { DailyPlan, PlanItem } from '@/types/db';

const KINDS: PlanItem['kind'][] = ['task', 'focus', 'event', 'reminder', 'break'];
const uid = () => crypto.randomUUID();

export default function PlannerPage() {
  const tz = useTimezone();
  const toast = useToast();
  const todayKey = localDateKey(new Date(), tz);
  const [day, setDay] = useState(todayKey);
  const { start, end } = localDayRange(day, tz);

  const plan = useUserQuery(['plans', day], () => planApi.get(day));
  const tasks = useUserQuery(['tasks', 'day', day], () => taskApi.range(start.toISOString(), end.toISOString()));
  const reminders = useUserQuery(['reminders', 'day', day], () => reminderApi.range(start.toISOString(), end.toISOString()));
  const events = useUserQuery(['events', 'day', day], () => eventApi.range(start.toISOString(), end.toISOString()));
  const { insights } = useInsights();

  const [items, setItems] = useState<PlanItem[]>([]);
  const [summary, setSummary] = useState('');
  const [dirty, setDirty] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => { setItems(plan.data?.items ?? []); setSummary(plan.data?.summary ?? ''); setDirty(false); }, [plan.data, day]);

  const save = useAppMutation((status: DailyPlan['status']) => planApi.save({ plan_date: day, summary: summary.trim() || null, items, status, source: plan.data?.source ?? 'manual' }),
    { invalidate: ['plans'], success: (p) => (p.status === 'approved' ? 'Plan approved' : 'Plan saved') });
  const discard = useAppMutation(() => planApi.remove(plan.data!.id), { invalidate: ['plans'], success: 'Plan discarded' });

  const update = (next: PlanItem[]) => { setItems(next); setDirty(true); };
  const patch = (id: string, p: Partial<PlanItem>) => update(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const move = (idx: number, dir: -1 | 1) => { const n = [...items]; const j = idx + dir; if (j < 0 || j >= n.length) return; [n[idx], n[j]] = [n[j], n[idx]]; update(n); };

  /** Deterministic plan from real data (no AI): overdue + due-today tasks by priority, reminders and events at their times. */
  async function quickPlan() {
    const [open] = await Promise.all([taskApi.today(end.toISOString())]);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const list: PlanItem[] = [];
    for (const e of events.data ?? []) list.push({ id: uid(), title: e.title, start: e.all_day ? null : fmtTime(e.starts_at, tz), end: e.all_day ? null : fmtTime(e.ends_at, tz), kind: 'event', ref_id: e.id, done: false });
    for (const r of (reminders.data ?? []).filter((x) => x.status === 'pending')) list.push({ id: uid(), title: r.title, start: fmtTime(r.remind_at, tz), end: null, kind: 'reminder', ref_id: r.id, done: false });
    for (const t of [...open].sort((a, b) => rank[a.priority] - rank[b.priority]).slice(0, 8)) list.push({ id: uid(), title: t.title, start: null, end: null, kind: 'task', ref_id: t.id, done: false });
    if (!list.length) return toast.info('Nothing is due on this day, so there is nothing to plan from. Add items manually.');
    setItems(list); setSummary('Built from your due tasks, reminders and events.'); setDirty(true);
  }

  async function aiPlan() {
    setAiBusy(true);
    try {
      let gotError = '';
      for await (const ev of streamMessage(`Create a proposed daily plan for ${day} using my real schedule and tasks. Use get_daily_schedule first, then generate_daily_plan. Only use items that exist.`, null)) {
        if (ev.type === 'error') gotError = ev.message;
      }
      if (gotError) throw new Error(gotError);
      await plan.refetch();
      toast.success('The assistant proposed a plan. Review it before approving.');
    } catch (e) {
      toast.error(e instanceof AiError ? e.message : errorMessage(e));
    } finally { setAiBusy(false); }
  }

  const approved = plan.data?.status === 'approved';
  const doneCount = items.filter((i) => i.done).length;
  const focusHints = useMemo(() => {
    const h: string[] = [];
    if (insights?.overdueCount) h.push(`${insights.overdueCount} overdue ${insights.overdueCount === 1 ? 'task' : 'tasks'}: clear or reschedule these first.`);
    if (insights?.peakHour != null) h.push(`You complete the most tasks around ${insights.peakHour}:00. Protect that hour for deep work.`);
    if ((tasks.data ?? []).some((t) => t.priority === 'high' && t.status !== 'done')) h.push('High-priority tasks are due on this day.');
    return h;
  }, [insights, tasks.data]);

  return (
    <div>
      <PageHeader title="Daily planner" description="Draft your day from real data, edit it, then approve."
        actions={<div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" className="h-9 w-9" aria-label="Previous day" onClick={() => setDay(addDaysToKey(day, -1))}><ArrowLeft className="h-4 w-4" /></Button>
          <button onClick={() => setDay(todayKey)} className="min-w-[150px] text-center text-sm font-medium">{day === todayKey ? 'Today · ' : ''}{fmtKey(day, { weekday: 'short', day: 'numeric', month: 'short' })}</button>
          <Button variant="secondary" size="icon" className="h-9 w-9" aria-label="Next day" onClick={() => setDay(addDaysToKey(day, 1))}><ArrowRight className="h-4 w-4" /></Button>
        </div>} />

      {plan.isError ? <ErrorState message="Could not load this plan." onRetry={() => plan.refetch()} /> : (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <section className="card p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Plan</h2>
                {plan.data && <Badge tone={approved ? 'success' : 'warning'}>{approved ? 'Approved' : 'Proposed'}</Badge>}
                {plan.data?.source === 'ai' && <Badge tone="accent">AI</Badge>}
                {plan.data?.source === 'automation' && <Badge tone="accent">Automation</Badge>}
              </div>
              {items.length > 0 && <span className="text-xs text-muted">{doneCount}/{items.length} done</span>}
            </div>

            {plan.isLoading ? <Skeleton className="h-48" /> : items.length === 0 ? (
              <EmptyState icon={<Sparkles className="h-6 w-6" />} title="No plan for this day yet"
                description="Let the assistant draft one from your tasks, build a quick plan from what is due, or add items yourself."
                action={<div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={aiPlan} loading={aiBusy}><Wand2 className="h-4 w-4" />Plan with AI</Button>
                  <Button variant="secondary" onClick={quickPlan}>Quick plan from due items</Button>
                  <Button variant="ghost" onClick={() => update([{ id: uid(), title: '', start: null, end: null, kind: 'task', ref_id: null, done: false }])}><Plus className="h-4 w-4" />Add item</Button>
                </div>} />
            ) : (
              <>
                <Input aria-label="Plan summary" placeholder="Summary or focus for the day (optional)" value={summary} maxLength={500} onChange={(e) => { setSummary(e.target.value); setDirty(true); }} />
                <ul className="mt-4 space-y-2">
                  {items.map((it, idx) => (
                    <li key={it.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/50 p-2.5 sm:flex-nowrap">
                      <button onClick={() => patch(it.id, { done: !it.done })} aria-label={it.done ? 'Mark not done' : 'Mark done'} aria-pressed={it.done}
                        className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border', it.done ? 'border-accent bg-accent text-accent-fg' : 'border-muted/50')}>{it.done && <Check className="h-3 w-3" />}</button>
                      <input aria-label="Item title" value={it.title} maxLength={200} onChange={(e) => patch(it.id, { title: e.target.value })} placeholder="What will you do?"
                        className={cn('min-w-[140px] flex-1 bg-transparent text-sm focus:outline-none', it.done && 'text-muted line-through')} />
                      <input aria-label="Start" type="time" value={it.start ?? ''} onChange={(e) => patch(it.id, { start: e.target.value || null })} className="field h-8 w-[104px] px-2 py-0 text-xs" />
                      <input aria-label="End" type="time" value={it.end ?? ''} onChange={(e) => patch(it.id, { end: e.target.value || null })} className="field h-8 w-[104px] px-2 py-0 text-xs" />
                      <Select aria-label="Kind" value={it.kind} onChange={(e) => patch(it.id, { kind: e.target.value as PlanItem['kind'] })} className="h-8 w-[100px] py-0 text-xs">{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select>
                      <div className="ml-auto flex">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Move up" disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Move down" disabled={idx === items.length - 1} onClick={() => move(idx, 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Remove item" onClick={() => update(items.filter((i) => i.id !== it.id))}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => update([...items, { id: uid(), title: '', start: null, end: null, kind: 'task', ref_id: null, done: false }])}><Plus className="h-4 w-4" />Add item</Button>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {plan.data && <Button variant="ghost" size="sm" onClick={() => discard.mutate(undefined)} loading={discard.isPending}>Discard plan</Button>}
                    <Button variant="secondary" size="sm" disabled={!dirty || items.some((i) => !i.title.trim())} loading={save.isPending && save.variables === 'proposed'} onClick={() => save.mutate('proposed')}>Save draft</Button>
                    <Button size="sm" disabled={items.some((i) => !i.title.trim()) || (approved && !dirty)} loading={save.isPending && save.variables === 'approved'} onClick={() => save.mutate('approved')}>
                      <CheckCircle2 className="h-4 w-4" />{approved ? 'Update approved plan' : 'Approve plan'}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </section>

          <aside className="space-y-4">
            <section className="card p-4" aria-label="Priorities">
              <h3 className="mb-2 text-sm font-semibold">Due this day</h3>
              {tasks.isLoading ? <Skeleton className="h-16" /> : !tasks.data?.length ? <p className="text-sm text-muted">No tasks due.</p>
                : tasks.data.map((t) => <div key={t.id} className="flex items-center gap-2 py-1.5 text-sm"><PriorityDot priority={t.priority} /><span className={cn('truncate', t.status === 'done' && 'text-muted line-through')}>{t.title}</span></div>)}
            </section>
            <section className="card p-4" aria-label="Suggested focus">
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-3.5 w-3.5 text-accent" />Suggested focus</h3>
              {focusHints.length === 0 ? <p className="text-sm text-muted">Suggestions appear as you use LIFE OS, based on your own history.</p>
                : <ul className="space-y-2 text-sm text-muted">{focusHints.map((h) => <li key={h}>{h}</li>)}</ul>}
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
