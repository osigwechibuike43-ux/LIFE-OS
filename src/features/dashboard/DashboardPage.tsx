import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUp, Flame, SlidersHorizontal, Sparkles } from 'lucide-react';
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Button, EmptyState, ErrorState, Skeleton, Switch } from '@/components/ui';
import { useAppMutation, usePrefs, useProfile, useTimezone, useUserQuery } from '@/hooks/queries';
import { useInsights } from '@/hooks/useInsights';
import { addDaysToKey, fmtKey, fmtTime, localDateKey, localDayRange } from '@/lib/dates';
import { cn, greeting } from '@/lib/utils';
import { eventApi, noteApi, prefsApi, reminderApi, taskApi } from '@/services/data';
import { zonedParts } from '@/lib/dates';
import { FocusTile } from './FocusTile';
import { Timeline } from './Timeline';

const WIDGETS: Array<[string, string]> = [
  ['focus', 'Deep work timer'], ['completion', 'Task completion'], ['rhythm', 'Productivity rhythm'],
  ['timeline', 'Daily timeline'], ['reminders', 'Upcoming reminders'], ['notes', 'Recent notes'],
];

export default function DashboardPage() {
  const tz = useTimezone();
  const nav = useNavigate();
  const profile = useProfile();
  const prefs = usePrefs();
  const todayKey = localDateKey(new Date(), tz);
  const [dayKey, setDayKey] = useState(todayKey);
  const [customize, setCustomize] = useState(false);
  const [prompt, setPrompt] = useState('');
  const isToday = dayKey === todayKey;

  const { start, end } = localDayRange(dayKey, tz);
  const tasks = useUserQuery(['tasks', 'day', dayKey], () => taskApi.range(start.toISOString(), end.toISOString()));
  const reminders = useUserQuery(['reminders', 'day', dayKey], () => reminderApi.range(start.toISOString(), end.toISOString()));
  const events = useUserQuery(['events', 'day', dayKey], () => eventApi.range(start.toISOString(), end.toISOString()));
  const upcoming = useUserQuery(['reminders', 'upcoming'], () => reminderApi.list('pending'));
  const notes = useUserQuery(['notes', 'recent'], () => noteApi.recent(4));
  const { insights, isLoading: insightsLoading, isError: insightsError, refetch } = useInsights();

  const widgets = prefs.data?.dashboard_widgets ?? {};
  const show = (k: string) => widgets[k] !== false;
  const saveWidgets = useAppMutation((w: Record<string, boolean>) => prefsApi.update({ dashboard_widgets: w }), { invalidate: ['prefs'] });

  const dayTasks = tasks.data ?? [];
  const doneCount = dayTasks.filter((t) => t.status === 'done').length;
  const pct = dayTasks.length ? Math.round((doneCount / dayTasks.length) * 100) : null;

  const name = (profile.data?.display_name ?? '').split(' ')[0];
  const hour = zonedParts(new Date(), tz).hour;
  const loading = tasks.isLoading || reminders.isLoading || events.isLoading;

  function ask(e: FormEvent) {
    e.preventDefault();
    const p = prompt.trim();
    if (p) nav(`/app/assistant?prompt=${encodeURIComponent(p)}`);
  }

  const rhythm = (insights?.byHour ?? []).map((v, h) => ({ h, v })).filter((d) => d.h >= 6 && d.h <= 22);
  const peak = insights?.peakHour;

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted">{isToday ? `${greeting(hour)}${name ? `, ${name}` : ''}` : 'Planning ahead'}</p>
          <h1 className="mt-1 font-display text-3xl font-light sm:text-4xl">
            {isToday ? <>Stay on <span className="font-semibold">track today</span></> : fmtKey(dayKey, { weekday: 'long', day: 'numeric', month: 'long' })}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {insights && insights.streak > 1 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs"><Flame className="h-3.5 w-3.5 text-amber" />{insights.streak}-day streak</span>
          )}
          <Button variant="secondary" onClick={() => setCustomize((c) => !c)} aria-expanded={customize}><SlidersHorizontal className="h-4 w-4" />Customize</Button>
          <Link to="/app/tasks?new=1"><Button>Add task</Button></Link>
        </div>
      </header>

      {customize && (
        <div className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold">Dashboard widgets</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WIDGETS.map(([k, l]) => (
              <Switch key={k} label={l} checked={show(k)} disabled={saveWidgets.isPending}
                onChange={(v) => saveWidgets.mutate({ ...(prefs.data?.dashboard_widgets ?? {}), [k]: v })} />
            ))}
          </div>
        </div>
      )}

      {/* AI quick input */}
      <form onSubmit={ask} className="card flex items-center gap-2 p-2 pl-4">
        <Sparkles className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={500} aria-label="Ask the assistant"
          placeholder="Ask anything: “What do I have planned for today?”" className="min-w-0 flex-1 bg-transparent py-2 text-sm placeholder:text-muted/70 focus:outline-none" />
        <Button type="submit" size="icon" disabled={!prompt.trim()} aria-label="Send to assistant" className="h-9 w-9"><ArrowUp className="h-4 w-4" /></Button>
      </form>

      {/* Daily goals bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-3">
        <button onClick={() => setDayKey(todayKey)} disabled={isToday} aria-label="Jump to today"
          className="flex h-12 w-12 flex-col items-center justify-center rounded-xl border border-line bg-surface text-center leading-tight disabled:cursor-default">
          <span className="text-base font-semibold">{fmtKey(dayKey, { day: 'numeric' })}</span>
          <span className="text-[10px] uppercase text-muted">{fmtKey(dayKey, { month: 'short' })}</span>
        </button>
        <p className="text-sm"><span className="text-muted">Daily goals </span>
          {loading ? <Skeleton className="inline-block h-4 w-20 align-middle" /> : <span className="font-medium">{doneCount}/{dayTasks.length} completed</span>}
        </p>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="icon" className="h-9 w-9" aria-label="Previous day" onClick={() => setDayKey((d) => addDaysToKey(d, -1))}><ArrowLeft className="h-4 w-4" /></Button>
          <Button variant="secondary" size="icon" className="h-9 w-9" aria-label="Next day" onClick={() => setDayKey((d) => addDaysToKey(d, 1))}><ArrowRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Metric tiles */}
      {(show('focus') || show('completion') || show('rhythm')) && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.6fr]">
          {show('focus') && <FocusTile />}

          {show('completion') && (
            <div className="glow-steel relative flex min-h-[180px] flex-col justify-between overflow-hidden rounded-3xl border border-line p-5">
              <h3 className="text-sm font-medium">Task completion</h3>
              <div>
                {loading ? <Skeleton className="h-10 w-24" /> : pct === null
                  ? <p className="text-sm text-muted">No tasks due on this day.</p>
                  : <p className="font-display text-5xl font-light tabular-nums">{pct}<span className="text-2xl text-muted">%</span></p>}
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>{isToday ? 'Due today' : 'Due this day'}</span>
                  {insights && insights.completionRate7 !== null && <span>7-day rate {insights.completionRate7}%</span>}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-fg/10" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label="Completion">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct ?? 0}%` }} />
                </div>
              </div>
            </div>
          )}

          {show('rhythm') && (
            <div className="relative min-h-[180px] overflow-hidden rounded-3xl border border-line bg-surface p-5 md:col-span-2 xl:col-span-1">
              <div className="flex items-start justify-between">
                <h3 className="text-sm font-medium">Productivity rhythm</h3>
                <span className="rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">{insights ? `${insights.completedLast30} done in 30 days` : '—'}</span>
              </div>
              {insightsLoading ? <Skeleton className="mt-4 h-28" />
                : insightsError ? <ErrorState message="Could not load your activity." onRetry={() => refetch()} />
                : peak === null || peak === undefined ? <p className="mt-10 text-center text-sm text-muted">Complete a few tasks and your most productive hours will appear here.</p>
                : (
                  <div className="mt-2 h-32">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rhythm} margin={{ top: 22, right: 0, left: 0, bottom: 0 }}>
                        <XAxis dataKey="h" tickFormatter={(h: number) => (h % 12 === 0 ? 12 : h % 12) + (h < 12 ? 'a' : 'p')} tick={{ fontSize: 10, fill: 'rgb(var(--muted))' }} axisLine={false} tickLine={false} interval={1} />
                        <Tooltip cursor={{ fill: 'rgb(var(--fg) / 0.05)' }} contentStyle={{ background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 12, fontSize: 12 }}
                          formatter={(v) => [`${v} completed`, '']} labelFormatter={(h) => `${h}:00`} />
                        <ReferenceLine x={peak} stroke="rgb(var(--muted))" strokeDasharray="3 3" label={{ value: `Peak: ${(peak % 12 === 0 ? 12 : peak % 12)} ${peak < 12 ? 'am' : 'pm'}`, position: 'top', fontSize: 11, fill: 'rgb(var(--fg))' }} />
                        <Bar dataKey="v" radius={[6, 6, 6, 6]}>
                          {rhythm.map((d) => <Cell key={d.h} fill={d.h === peak ? 'rgb(var(--amber))' : 'rgb(var(--accent) / 0.45)'} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      {show('timeline') && (loading
        ? <Skeleton className="h-56 rounded-3xl" />
        : tasks.isError || reminders.isError || events.isError
          ? <ErrorState message="Could not load your schedule." onRetry={() => { void tasks.refetch(); void reminders.refetch(); void events.refetch(); }} />
          : <Timeline tasks={dayTasks} reminders={reminders.data ?? []} events={events.data ?? []} tz={tz} dayKey={dayKey} />)}

      {/* Lists */}
      {(show('reminders') || show('notes')) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {show('reminders') && (
            <section className="card p-5" aria-label="Upcoming reminders">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Upcoming reminders</h2><Link to="/app/tasks?tab=reminders" className="text-xs text-accent hover:underline">View all</Link></div>
              {upcoming.isLoading ? <Skeleton className="h-24" /> : upcoming.isError ? <ErrorState onRetry={() => upcoming.refetch()} />
                : !upcoming.data?.length ? <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No upcoming reminders" description="Ask the assistant to remind you, or add one in Tasks." />
                : upcoming.data.slice(0, 5).map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 border-b border-line/60 py-2.5 text-sm last:border-0">
                    <span className="truncate">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted">{localDateKey(r.remind_at, tz) === todayKey ? 'Today' : fmtKey(localDateKey(r.remind_at, tz), { day: 'numeric', month: 'short' })} · {fmtTime(r.remind_at, tz)}</span>
                  </div>
                ))}
            </section>
          )}
          {show('notes') && (
            <section className="card p-5" aria-label="Recent notes">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Recent notes</h2><Link to="/app/notes" className="text-xs text-accent hover:underline">View all</Link></div>
              {notes.isLoading ? <Skeleton className="h-24" /> : notes.isError ? <ErrorState onRetry={() => notes.refetch()} />
                : !notes.data?.length ? <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No notes yet" description="Capture an idea and it will show up here." action={<Link to="/app/notes?new=1"><Button size="sm">New note</Button></Link>} />
                : notes.data.map((n) => (
                  <Link key={n.id} to={`/app/notes?open=${n.id}`} className={cn('block border-b border-line/60 py-2.5 last:border-0 hover:text-accent')}>
                    <p className="truncate text-sm font-medium">{n.title || 'Untitled'}</p>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">{n.content_text || 'Empty note'}</p>
                  </Link>
                ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
