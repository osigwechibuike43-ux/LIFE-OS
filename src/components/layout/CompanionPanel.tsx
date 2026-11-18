import { Link } from 'react-router-dom';
import { AlarmClock, ArrowUpRight, CalendarPlus, ListChecks, Sparkles, StickyNote } from 'lucide-react';
import { useUserQuery } from '@/hooks/queries';
import { useTimezone } from '@/hooks/queries';
import { localDateKey, localDayRange } from '@/lib/dates';
import { reminderApi, taskApi } from '@/services/data';
import { Skeleton } from '@/components/ui';
import { fmtTime } from '@/lib/dates';

/** Right-hand AI companion. Suggestions are derived from real task/reminder data, not canned text. */
export function CompanionPanel() {
  const tz = useTimezone();
  const today = localDateKey(new Date(), tz);
  const { end } = localDayRange(today, tz);
  const tasks = useUserQuery(['tasks', 'companion', today], () => taskApi.today(end.toISOString()));
  const reminders = useUserQuery(['reminders', 'companion', today], () => reminderApi.range(new Date().toISOString(), end.toISOString()));

  const overdue = (tasks.data ?? []).filter((t) => t.due_at && new Date(t.due_at) < new Date()).length;
  const dueToday = (tasks.data ?? []).length - overdue;
  const suggestions: Array<{ text: string; prompt: string }> = [];
  if (overdue > 0) suggestions.push({ text: `${overdue} overdue ${overdue === 1 ? 'task needs' : 'tasks need'} attention`, prompt: 'Show my overdue tasks and help me decide what to do first.' });
  if (dueToday > 0) suggestions.push({ text: `${dueToday} ${dueToday === 1 ? 'task is' : 'tasks are'} due later today`, prompt: 'Plan my day around what is due today.' });
  if (!tasks.isLoading && !tasks.data?.length) suggestions.push({ text: 'Nothing due today. Plan something meaningful?', prompt: 'Help me organize my week.' });

  const quick = [
    { to: '/app/assistant?prompt=' + encodeURIComponent('What do I have planned for today?'), icon: ListChecks, label: 'Today’s summary' },
    { to: '/app/planner', icon: Sparkles, label: 'Plan my day' },
    { to: '/app/tasks?new=1', icon: AlarmClock, label: 'Add a task' },
    { to: '/app/notes?new=1', icon: StickyNote, label: 'Capture a note' },
    { to: '/app/calendar?new=1', icon: CalendarPlus, label: 'Add an event' },
  ];

  return (
    <aside aria-label="AI companion" className="hidden w-80 shrink-0 border-l border-line bg-surface/60 2xl:block">
      <div className="sticky top-0 flex h-screen flex-col gap-6 overflow-y-auto p-5">
        <div>
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent" /><h2 className="text-sm font-semibold">Companion</h2></div>
          <p className="mt-1 text-xs text-muted">Suggestions based on your actual tasks and reminders.</p>
        </div>

        <section aria-label="Suggestions" className="space-y-2">
          {tasks.isLoading ? <Skeleton className="h-16" /> : suggestions.map((s) => (
            <Link key={s.text} to={`/app/assistant?prompt=${encodeURIComponent(s.prompt)}`} className="group block rounded-xl border border-line bg-surface p-3.5 transition-colors hover:border-accent/50">
              <p className="text-sm">{s.text}</p>
              <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent">Ask the assistant <ArrowUpRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span>
            </Link>
          ))}
        </section>

        <section aria-label="Upcoming reminders">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Reminders left today</h3>
          {reminders.isLoading ? <Skeleton className="h-10" /> : (reminders.data ?? []).filter((r) => r.status === 'pending').length === 0
            ? <p className="text-sm text-muted">No more reminders today.</p>
            : (reminders.data ?? []).filter((r) => r.status === 'pending').slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="truncate">{r.title}</span><span className="shrink-0 text-xs text-muted">{fmtTime(r.remind_at, tz)}</span>
              </div>
            ))}
        </section>

        <section aria-label="Quick actions">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Quick actions</h3>
          <div className="space-y-1">
            {quick.map((q) => (
              <Link key={q.label} to={q.to} className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg">
                <q.icon className="h-4 w-4" />{q.label}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
