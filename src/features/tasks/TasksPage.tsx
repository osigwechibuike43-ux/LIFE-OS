import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Bell, Check, CheckSquare, Pencil, Plus, Repeat, Search, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, PriorityDot, Select, Skeleton, Tabs } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppMutation, useTaskCategories, useTimezone, useUserQuery } from '@/hooks/queries';
import { fmtDateTime, relativeDue } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { reminderApi, taskApi, type TaskFilter } from '@/services/data';
import type { Reminder, Task } from '@/types/db';
import { ReminderFormModal, TaskFormModal } from './TaskForms';

type Tab = 'tasks' | 'reminders';

export default function TasksPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') === 'reminders' ? 'reminders' : 'tasks') as Tab;
  const [taskModal, setTaskModal] = useState<{ open: boolean; task: Task | null }>({ open: false, task: null });
  const [remModal, setRemModal] = useState<{ open: boolean; reminder: Reminder | null }>({ open: false, reminder: null });

  useEffect(() => {
    if (params.get('new') === '1') {
      (tab === 'tasks' ? setTaskModal : setRemModal)({ open: true, ...(tab === 'tasks' ? { task: null } : { reminder: null }) } as never);
      const p = new URLSearchParams(params); p.delete('new'); setParams(p, { replace: true });
    }
  }, [params, setParams, tab]);

  return (
    <div>
      <PageHeader title="Tasks & reminders" description="Everything you need to do, and when to be nudged."
        actions={<>
          <Tabs<Tab> value={tab} onChange={(v) => setParams(v === 'tasks' ? {} : { tab: v })} options={[{ value: 'tasks', label: 'Tasks' }, { value: 'reminders', label: 'Reminders' }]} />
          {tab === 'tasks'
            ? <Button onClick={() => setTaskModal({ open: true, task: null })}><Plus className="h-4 w-4" />New task</Button>
            : <Button onClick={() => setRemModal({ open: true, reminder: null })}><Plus className="h-4 w-4" />New reminder</Button>}
        </>} />
      {tab === 'tasks' ? <TaskList onEdit={(t) => setTaskModal({ open: true, task: t })} onNew={() => setTaskModal({ open: true, task: null })} />
        : <ReminderList onEdit={(r) => setRemModal({ open: true, reminder: r })} onNew={() => setRemModal({ open: true, reminder: null })} />}
      <TaskFormModal open={taskModal.open} task={taskModal.task} onClose={() => setTaskModal({ open: false, task: null })} />
      <ReminderFormModal open={remModal.open} reminder={remModal.reminder} onClose={() => setRemModal({ open: false, reminder: null })} />
    </div>
  );
}

function TaskList({ onEdit, onNew }: { onEdit: (t: Task) => void; onNew: () => void }) {
  const tz = useTimezone();
  const { user } = useAuth();
  const cats = useTaskCategories();
  const [filter, setFilter] = useState<Omit<TaskFilter, 'page'>>({ status: 'open', categoryId: null, priority: null, search: '' });
  const [search, setSearch] = useState('');
  const [toDelete, setToDelete] = useState<Task | null>(null);

  useEffect(() => { const t = setTimeout(() => setFilter((f) => ({ ...f, search })), 300); return () => clearTimeout(t); }, [search]);

  const q = useInfiniteQuery({
    queryKey: [user?.id, 'tasks', 'list', filter], enabled: Boolean(user), initialPageParam: 0,
    queryFn: ({ pageParam }) => taskApi.list({ ...filter, page: pageParam }),
    getNextPageParam: (last, all) => (last.hasMore ? all.length : undefined),
  });
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const catMap = new Map((cats.data ?? []).map((c) => [c.id, c]));

  const inv = { invalidate: ['tasks', 'insights'] };
  const complete = useAppMutation(taskApi.complete, inv);
  const reopen = useAppMutation(taskApi.reopen, inv);
  const remove = useAppMutation(taskApi.remove, { ...inv, success: 'Task deleted', onSuccess: () => setToDelete(null) });

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks" aria-label="Search tasks" className="field pl-10" maxLength={100} />
        </div>
        <Select aria-label="Status" className="w-auto" value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value as TaskFilter['status'] }))}>
          <option value="open">Open</option><option value="done">Completed</option><option value="all">All</option>
        </Select>
        <Select aria-label="Category" className="w-auto" value={filter.categoryId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, categoryId: e.target.value || null }))}>
          <option value="">All categories</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label="Priority" className="w-auto" value={filter.priority ?? ''} onChange={(e) => setFilter((f) => ({ ...f, priority: e.target.value || null }))}>
          <option value="">Any priority</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </Select>
      </div>

      <div className="card divide-y divide-line/70 overflow-hidden">
        {q.isLoading ? Array.from({ length: 5 }, (_, i) => <div key={i} className="p-4"><Skeleton className="h-10" /></div>)
          : q.isError ? <ErrorState message="Could not load tasks." onRetry={() => q.refetch()} />
          : rows.length === 0 ? (
            <EmptyState icon={<CheckSquare className="h-6 w-6" />}
              title={filter.search || filter.categoryId || filter.priority ? 'No tasks match your filters' : filter.status === 'done' ? 'Nothing completed yet' : 'You have no open tasks'}
              description={filter.search || filter.categoryId || filter.priority ? 'Try clearing a filter.' : 'Add your first task, or ask the assistant to create one from a sentence.'}
              action={filter.status === 'open' && !filter.search ? <Button onClick={onNew}><Plus className="h-4 w-4" />New task</Button> : undefined} />
          ) : rows.map((t) => {
            const due = t.due_at && t.status !== 'done' ? relativeDue(t.due_at, tz) : null;
            const cat = t.category_id ? catMap.get(t.category_id) : null;
            const done = t.status === 'done';
            return (
              <div key={t.id} className="group flex items-start gap-3 px-4 py-3.5">
                <button onClick={() => (done ? reopen.mutate(t.id) : complete.mutate(t.id))} aria-label={done ? `Reopen ${t.title}` : `Complete ${t.title}`}
                  className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors', done ? 'border-accent bg-accent text-accent-fg' : 'border-muted/50 hover:border-accent')}>
                  {done && <Check className="h-3 w-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium', done && 'text-muted line-through')}>{t.title}</p>
                  {t.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{t.description}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5"><PriorityDot priority={t.priority} />{t.priority}</span>
                    {due && <Badge tone={due.overdue ? 'danger' : 'neutral'}>{due.overdue ? 'Overdue · ' : ''}{due.label}</Badge>}
                    {done && t.completed_at && <span>Done {fmtDateTime(t.completed_at, tz)}</span>}
                    {cat && <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />{cat.name}</span>}
                    {t.recurrence && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" />{t.recurrence.freq}</span>}
                    {t.source === 'ai' && <Badge tone="accent">AI</Badge>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${t.title}`} onClick={() => onEdit(t)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete ${t.title}`} onClick={() => setToDelete(t)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            );
          })}
      </div>
      {q.hasNextPage && <div className="mt-4 flex justify-center"><Button variant="secondary" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>Load more</Button></div>}

      <ConfirmDialog open={Boolean(toDelete)} title="Delete task?" message={`“${toDelete?.title}” will be permanently deleted.`} loading={remove.isPending}
        onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
    </>
  );
}

function ReminderList({ onEdit, onNew }: { onEdit: (r: Reminder) => void; onNew: () => void }) {
  const tz = useTimezone();
  const [status, setStatus] = useState<'pending' | 'done'>('pending');
  const [toDelete, setToDelete] = useState<Reminder | null>(null);
  const q = useUserQuery(['reminders', 'list', status], () => reminderApi.list(status));
  const complete = useAppMutation(reminderApi.complete, { invalidate: ['reminders'] });
  const remove = useAppMutation(reminderApi.remove, { invalidate: ['reminders'], success: 'Reminder deleted', onSuccess: () => setToDelete(null) });

  return (
    <>
      <div className="mb-4"><Tabs value={status} onChange={setStatus} options={[{ value: 'pending', label: 'Upcoming' }, { value: 'done', label: 'Completed' }]} /></div>
      <div className="card divide-y divide-line/70 overflow-hidden">
        {q.isLoading ? Array.from({ length: 4 }, (_, i) => <div key={i} className="p-4"><Skeleton className="h-10" /></div>)
          : q.isError ? <ErrorState message="Could not load reminders." onRetry={() => q.refetch()} />
          : !q.data?.length ? <EmptyState icon={<Bell className="h-6 w-6" />} title={status === 'pending' ? 'No upcoming reminders' : 'No completed reminders'}
              description="Reminders notify you in the app at the time you choose." action={status === 'pending' ? <Button onClick={onNew}><Plus className="h-4 w-4" />New reminder</Button> : undefined} />
          : q.data.map((r) => {
            const overdue = r.status === 'pending' && new Date(r.remind_at) < new Date();
            return (
              <div key={r.id} className="group flex items-start gap-3 px-4 py-3.5">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{r.title}</p>
                  {r.description && <p className="mt-0.5 line-clamp-1 text-xs text-muted">{r.description}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge tone={overdue ? 'warning' : 'neutral'}>{fmtDateTime(r.remind_at, tz)}</Badge>
                    {overdue && <span>{r.notified_at ? 'Notified' : 'Due'}</span>}
                    <span className="inline-flex items-center gap-1.5"><PriorityDot priority={r.priority} />{r.priority}</span>
                    {r.recurrence && <span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" />{r.recurrence.freq}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {r.status === 'pending' && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Mark ${r.title} done`} onClick={() => complete.mutate(r.id)}><Check className="h-4 w-4" /></Button>}
                  {r.status === 'pending' && <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${r.title}`} onClick={() => onEdit(r)}><Pencil className="h-4 w-4" /></Button>}
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete ${r.title}`} onClick={() => setToDelete(r)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            );
          })}
      </div>
      <ConfirmDialog open={Boolean(toDelete)} title="Delete reminder?" message={`“${toDelete?.title}” will be permanently deleted.`} loading={remove.isPending}
        onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
    </>
  );
}
