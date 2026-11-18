import { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Textarea } from '@/components/ui';
import { useAppMutation, useTaskCategories, useTimezone } from '@/hooks/queries';
import { fromIso, localDateKey, toIso } from '@/lib/dates';
import { fieldErrors, reminderFormSchema, taskFormSchema } from '@/lib/validation';
import { reminderApi, taskApi } from '@/services/data';
import type { Recurrence, Reminder, Task } from '@/types/db';

const RECURRENCE = [['none', 'Does not repeat'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly'], ['monthly', 'Monthly']] as const;
const toRec = (v: string): Recurrence => (v === 'none' ? null : { freq: v as 'daily' | 'weekdays' | 'weekly' | 'monthly', interval: 1 });

export function TaskFormModal({ open, onClose, task }: { open: boolean; onClose: () => void; task?: Task | null }) {
  const tz = useTimezone();
  const cats = useTaskCategories();
  const empty = { title: '', description: '', priority: 'medium' as Task['priority'], category_id: '' as string, date: '', time: '', recurrence: 'none' as string };
  const [f, setF] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (task) {
      const d = task.due_at ? fromIso(task.due_at, tz) : { date: '', time: '' };
      setF({ title: task.title, description: task.description ?? '', priority: task.priority, category_id: task.category_id ?? '', date: d.date, time: d.time, recurrence: task.recurrence?.freq ?? 'none' });
    } else setF({ ...empty, date: '', time: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task]);

  const save = useAppMutation(
    (v: Parameters<typeof taskApi.create>[0]) => (task ? taskApi.update(task.id, v) : taskApi.create(v)),
    { invalidate: ['tasks', 'insights'], success: task ? 'Task updated' : 'Task created', onSuccess: onClose },
  );

  function submit() {
    const parsed = taskFormSchema.safeParse({ ...f, category_id: f.category_id || null });
    if (!parsed.success) return setErrors(fieldErrors(parsed));
    if (parsed.data.recurrence !== 'none' && !parsed.data.date) return setErrors({ date: 'Repeating tasks need a due date' });
    setErrors({});
    const due_at = parsed.data.date ? toIso(parsed.data.date, parsed.data.time || '09:00', tz) : null;
    save.mutate({
      title: parsed.data.title, description: parsed.data.description?.trim() || null, priority: parsed.data.priority,
      category_id: parsed.data.category_id, due_at, recurrence: toRec(parsed.data.recurrence),
    });
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} title={task ? 'Edit task' : 'New task'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={save.isPending}>{task ? 'Save changes' : 'Create task'}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="Title" value={f.title} onChange={set('title')} error={errors.title} maxLength={300} placeholder="What needs to be done?" />
        <Textarea label="Description" value={f.description} onChange={set('description')} error={errors.description} maxLength={5000} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Priority" value={f.priority} onChange={set('priority')}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select>
          <Select label="Category" value={f.category_id} onChange={set('category_id')}>
            <option value="">No category</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Due date" type="date" value={f.date} onChange={set('date')} error={errors.date} min={localDateKey(new Date(), tz)} />
          <Input label="Time" type="time" value={f.time} onChange={set('time')} error={errors.time} disabled={!f.date} />
        </div>
        <Select label="Repeat" value={f.recurrence} onChange={set('recurrence')}>{RECURRENCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </form>
    </Modal>
  );
}

export function ReminderFormModal({ open, onClose, reminder }: { open: boolean; onClose: () => void; reminder?: Reminder | null }) {
  const tz = useTimezone();
  const [f, setF] = useState({ title: '', description: '', priority: 'medium' as Reminder['priority'], date: '', time: '', recurrence: 'none' as string });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    if (reminder) { const d = fromIso(reminder.remind_at, tz); setF({ title: reminder.title, description: reminder.description ?? '', priority: reminder.priority, date: d.date, time: d.time, recurrence: reminder.recurrence?.freq ?? 'none' }); }
    else setF({ title: '', description: '', priority: 'medium', date: localDateKey(new Date(), tz), time: '', recurrence: 'none' });
  }, [open, reminder, tz]);

  const save = useAppMutation(
    (v: Parameters<typeof reminderApi.create>[0]) => (reminder ? reminderApi.update(reminder.id, v) : reminderApi.create(v)),
    { invalidate: ['reminders'], success: reminder ? 'Reminder updated' : 'Reminder scheduled', onSuccess: onClose },
  );

  function submit() {
    const parsed = reminderFormSchema.safeParse(f);
    if (!parsed.success) return setErrors(fieldErrors(parsed));
    const remind_at = toIso(parsed.data.date, parsed.data.time, tz);
    if (new Date(remind_at).getTime() < Date.now() - 60_000) return setErrors({ time: 'Choose a time in the future' });
    setErrors({});
    save.mutate({ title: parsed.data.title, description: parsed.data.description?.trim() || null, priority: parsed.data.priority, remind_at, recurrence: toRec(parsed.data.recurrence) });
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <Modal open={open} onClose={onClose} title={reminder ? 'Edit reminder' : 'New reminder'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={save.isPending}>{reminder ? 'Save changes' : 'Schedule reminder'}</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="Title" value={f.title} onChange={set('title')} error={errors.title} maxLength={300} />
        <Textarea label="Description" value={f.description} onChange={set('description')} maxLength={2000} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={f.date} onChange={set('date')} error={errors.date} />
          <Input label="Time" type="time" value={f.time} onChange={set('time')} error={errors.time} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Priority" value={f.priority} onChange={set('priority')}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select>
          <Select label="Repeat" value={f.recurrence} onChange={set('recurrence')}>{RECURRENCE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </div>
      </form>
    </Modal>
  );
}
