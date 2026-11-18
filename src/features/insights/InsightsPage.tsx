import { useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, Flame } from 'lucide-react';
import { EmptyState, ErrorState, PageHeader, Skeleton, Tabs } from '@/components/ui';
import { useInsights } from '@/hooks/useInsights';
import { useTaskCategories } from '@/hooks/queries';
import { fmtKey } from '@/lib/dates';

type Range = 7 | 30;
const axis = { fontSize: 11, fill: 'rgb(var(--muted))' };
const tip = { contentStyle: { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 12, fontSize: 12 }, cursor: { fill: 'rgb(var(--fg) / 0.05)' } };

export default function InsightsPage() {
  const { insights: i, isLoading, isError, refetch } = useInsights();
  const cats = useTaskCategories();
  const [range, setRange] = useState<Range>(7);

  if (isError) return <ErrorState message="Could not load your insights." onRetry={() => refetch()} />;
  if (isLoading || !i) return <div><PageHeader title="Insights" /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, k) => <Skeleton key={k} className="h-28" />)}</div><Skeleton className="mt-4 h-72" /></div>;

  const hasData = i.completedLast30 > 0 || i.openCount > 0 || i.focusMinutesLast7 > 0;
  const days = i.days.slice(-range).map((d) => ({ ...d, label: fmtKey(d.date, range === 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }) }));
  const catData = Object.entries(i.byCategory).map(([id, n]) => ({ name: id === 'none' ? 'No category' : cats.data?.find((c) => c.id === id)?.name ?? 'Other', color: cats.data?.find((c) => c.id === id)?.color ?? '#94A3B8', n })).sort((a, b) => b.n - a.n);
  const hours = i.byHour.map((v, h) => ({ h, v })).filter((d) => d.h >= 5 && d.h <= 23);

  return (
    <div>
      <PageHeader title="Insights" description="Every number here is calculated from your own records."
        actions={<Tabs<'7' | '30'> value={String(range) as '7' | '30'} onChange={(v) => setRange(Number(v) as Range)} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />} />

      {!hasData ? <div className="card"><EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No activity to analyse yet" description="Create and complete a few tasks, and your trends will appear here. Nothing is estimated in the meantime." /></div> : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Completed today" value={i.completedToday} />
            <Stat label={`Completed · ${range} days`} value={range === 7 ? i.completedLast7 : i.completedLast30} />
            <Stat label="Open tasks" value={i.openCount} sub={i.overdueCount ? `${i.overdueCount} overdue` : 'None overdue'} tone={i.overdueCount ? 'warn' : undefined} />
            <Stat label="Completion rate (7 days)" value={i.completionRate7 === null ? '—' : `${i.completionRate7}%`} sub={i.completionRate7 === null ? 'No tasks were due' : 'Of tasks due that were done'} />
            <Stat label="Current streak" value={<span className="inline-flex items-center gap-1.5">{i.streak}<Flame className="h-5 w-5 text-amber" /></span>} sub={i.streak === 1 ? 'day' : 'days'} />
            <Stat label="Focus time · 7 days" value={`${Math.floor(i.focusMinutesLast7 / 60)}h ${i.focusMinutesLast7 % 60}m`} />
            <Stat label="Planning consistency" value={`${i.planningConsistency}%`} sub={`${i.plannedDays14} of last 14 days planned`} />
            <Stat label="Most productive hour" value={i.peakHour === null ? '—' : `${i.peakHour}:00`} sub="By completions, last 30 days" />
          </div>

          <ChartCard title="Tasks completed per day">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={days} margin={{ left: -20, right: 8, top: 8 }}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="rgb(var(--accent))" stopOpacity={0.35} /><stop offset="1" stopColor="rgb(var(--accent))" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="rgb(var(--line))" /><XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} interval={range === 30 ? 4 : 0} /><YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                <Tooltip {...tip} formatter={(v) => [v, 'Completed']} />
                <Area type="monotone" dataKey="completed" stroke="rgb(var(--accent))" strokeWidth={2} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid gap-5 lg:grid-cols-2">
            <ChartCard title="Created vs completed">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={days} margin={{ left: -20, right: 8 }}><CartesianGrid vertical={false} stroke="rgb(var(--line))" /><XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} interval={range === 30 ? 4 : 0} /><YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                  <Tooltip {...tip} /><Bar dataKey="created" name="Created" fill="rgb(var(--muted) / 0.45)" radius={[4, 4, 0, 0]} /><Bar dataKey="completed" name="Completed" fill="rgb(var(--accent))" radius={[4, 4, 0, 0]} /></BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Focus minutes per day">
              {days.every((d) => d.focusMinutes === 0) ? <p className="py-16 text-center text-sm text-muted">No focus sessions recorded. Start one from the dashboard.</p> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={days} margin={{ left: -20, right: 8 }}><CartesianGrid vertical={false} stroke="rgb(var(--line))" /><XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} interval={range === 30 ? 4 : 0} /><YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                    <Tooltip {...tip} formatter={(v) => [`${v} min`, 'Focus']} /><Bar dataKey="focusMinutes" fill="rgb(var(--amber))" radius={[4, 4, 0, 0]} /></BarChart>
                </ResponsiveContainer>)}
            </ChartCard>
            <ChartCard title="When you complete tasks (last 30 days)">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={hours} margin={{ left: -20, right: 8 }}><XAxis dataKey="h" tickFormatter={(h: number) => `${h}`} tick={axis} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={axis} axisLine={false} tickLine={false} />
                  <Tooltip {...tip} labelFormatter={(h) => `${h}:00`} formatter={(v) => [v, 'Completed']} /><Bar dataKey="v" radius={[4, 4, 0, 0]}>{hours.map((d) => <Cell key={d.h} fill={d.h === i.peakHour ? 'rgb(var(--amber))' : 'rgb(var(--accent) / 0.5)'} />)}</Bar></BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Completed by category (30 days)">
              {catData.length === 0 ? <p className="py-16 text-center text-sm text-muted">No completed tasks yet.</p> : (
                <ul className="space-y-3 pt-2">{catData.map((c) => (
                  <li key={c.name}><div className="mb-1 flex justify-between text-sm"><span>{c.name}</span><span className="tabular-nums text-muted">{c.n}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${(c.n / catData[0].n) * 100}%`, background: c.color }} /></div></li>))}</ul>)}
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'warn' }) {
  return (
    <div className="card p-4"><p className="text-xs text-muted">{label}</p><p className="mt-2 font-display text-3xl font-light tabular-nums">{value}</p>{sub && <p className={`mt-1 text-xs ${tone === 'warn' ? 'text-warning' : 'text-muted'}`}>{sub}</p>}</div>
  );
}
function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card p-5"><h2 className="mb-4 text-sm font-semibold">{title}</h2>{children}</section>;
}
