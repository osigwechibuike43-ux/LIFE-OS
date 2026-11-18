import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, MinusCircle, Pencil, Plus, Trash2, Workflow } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { useAppMutation, useEntitlements, useTimezone, useUserQuery } from '@/hooks/queries';
import { fmtDateTime } from '@/lib/dates';
import { fieldErrors, automationFormSchema } from '@/lib/validation';
import { automationApi, type AutomationInput } from '@/services/data';
import type { ActionType, AutomationRule, TriggerType } from '@/types/db';

const ACTIONS: Record<ActionType, { label: string; hint: string; triggers: TriggerType[] }> = {
  notify: { label: 'Send me a reminder notification', hint: 'An in-app notification with your own message.', triggers: ['daily', 'weekly'] },
  daily_plan: { label: 'Prepare my daily plan', hint: 'Drafts a proposed plan from tasks due today. You still approve it.', triggers: ['daily'] },
  weekly_summary: { label: 'Send my weekly productivity summary', hint: 'Real counts from the last 7 days.', triggers: ['weekly'] },
  deadline_alert: { label: 'Warn me before deadlines', hint: 'Alerts once per task when its deadline is within the chosen days.', triggers: ['before_deadline'] },
};
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TEMPLATES: Array<{ name: string; input: AutomationInput }> = [
  { name: 'Morning task review', input: { name: 'Morning task review', trigger_type: 'daily', trigger_config: { time: '08:00' }, conditions: { only_if_open_tasks: true }, action_type: 'notify', action_config: { title: 'Review your tasks', body: 'Take two minutes to look over what matters today.' }, is_active: true } },
  { name: 'Daily plan every morning', input: { name: 'Prepare my daily plan', trigger_type: 'daily', trigger_config: { time: '07:30' }, conditions: { weekdays_only: true }, action_type: 'daily_plan', action_config: {}, is_active: true } },
  { name: 'Weekly summary', input: { name: 'Weekly productivity summary', trigger_type: 'weekly', trigger_config: { time: '18:00', weekday: 5 }, conditions: {}, action_type: 'weekly_summary', action_config: {}, is_active: true } },
  { name: 'Deadline warning (3 days)', input: { name: 'Deadline warning', trigger_type: 'before_deadline', trigger_config: { time: '09:00', days_before: 3 }, conditions: {}, action_type: 'deadline_alert', action_config: {}, is_active: true } },
];

const describeTrigger = (r: AutomationRule) =>
  r.trigger_type === 'daily' ? `Every day at ${r.trigger_config.time ?? '08:00'}`
    : r.trigger_type === 'weekly' ? `Every ${WEEKDAYS[(r.trigger_config.weekday ?? 1) - 1]} at ${r.trigger_config.time ?? '08:00'}`
      : `Daily at ${r.trigger_config.time ?? '08:00'}, tasks due within ${r.trigger_config.days_before ?? 3} days`;

export default function AutomationsPage() {
  const tz = useTimezone();
  const ent = useEntitlements();
  const rules = useUserQuery(['automations'], automationApi.list);
  const runs = useUserQuery(['automation-runs'], automationApi.runs, { refetchInterval: 60_000 });
  const [modal, setModal] = useState<{ open: boolean; rule: AutomationRule | null; preset?: AutomationInput }>({ open: false, rule: null });
  const [toDelete, setToDelete] = useState<AutomationRule | null>(null);
  const toggle = useAppMutation((r: AutomationRule) => automationApi.update(r.id, { is_active: !r.is_active }), { invalidate: ['automations'] });
  const remove = useAppMutation(automationApi.remove, { invalidate: ['automations', 'automation-runs'], success: 'Automation deleted', onSuccess: () => setToDelete(null) });
  const create = useAppMutation(automationApi.create, { invalidate: ['automations'], success: 'Automation created' });
  const ruleName = new Map((rules.data ?? []).map((r) => [r.id, r.name]));
  const limit = ent.data?.limits?.automations;

  return (
    <div>
      <PageHeader title="Automations" description="Trigger → conditions → action, with a full run history. Automations only create notifications and draft plans; they never act outside LIFE OS."
        actions={<Button onClick={() => setModal({ open: true, rule: null })}><Plus className="h-4 w-4" />New automation</Button>} />

      {limit != null && <p className="mb-4 text-xs text-muted">{rules.data?.length ?? 0} of {limit} automations used on your plan.</p>}

      {rules.isLoading ? <Skeleton className="h-40" /> : rules.isError ? <ErrorState message="Could not load automations." onRetry={() => rules.refetch()} />
        : !rules.data?.length ? (
          <div className="card p-6">
            <EmptyState icon={<Workflow className="h-6 w-6" />} title="Automate the routine" description="Start from a template or build your own." />
            <div className="mx-auto grid max-w-2xl gap-2 sm:grid-cols-2">
              {TEMPLATES.map((t) => <button key={t.name} disabled={create.isPending} onClick={() => create.mutate(t.input)} className="rounded-xl border border-line px-4 py-3 text-left text-sm transition-colors hover:border-accent/50 hover:bg-surface-2"><span className="font-medium">{t.name}</span><span className="mt-0.5 block text-xs text-muted">Click to add</span></button>)}
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {rules.data.map((r) => (
              <li key={r.id} className="card flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{r.name}</h3>{!r.is_active && <Badge>Paused</Badge>}</div>
                  <p className="mt-1 text-xs text-muted">{describeTrigger(r)} → {ACTIONS[r.action_type].label.toLowerCase()}</p>
                  <p className="mt-1 text-xs text-muted">{r.is_active && r.next_run_at ? `Next run ${fmtDateTime(r.next_run_at, tz)}` : 'Not scheduled'}{r.last_run_at ? ` · Last run ${fmtDateTime(r.last_run_at, tz)}` : ' · Has not run yet'}</p>
                </div>
                <Switch checked={r.is_active} onChange={() => toggle.mutate(r)} label={r.is_active ? 'On' : 'Off'} disabled={toggle.isPending} />
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${r.name}`} onClick={() => setModal({ open: true, rule: r })}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete ${r.name}`} onClick={() => setToDelete(r)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}

      <section className="mt-8" aria-label="Execution history">
        <h2 className="mb-3 text-base font-semibold">Execution history</h2>
        <div className="card divide-y divide-line/70 overflow-hidden">
          {runs.isLoading ? <div className="p-4"><Skeleton className="h-12" /></div> : runs.isError ? <ErrorState message="Could not load history." onRetry={() => runs.refetch()} />
            : !runs.data?.length ? <p className="p-6 text-center text-sm text-muted">Runs will be listed here once an automation fires.</p>
            : runs.data.map((r) => (
              <div key={r.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                {r.status === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : r.status === 'skipped' ? <MinusCircle className="mt-0.5 h-4 w-4 text-muted" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" />}
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{ruleName.get(r.rule_id) ?? 'Deleted automation'}</p>
                  <p className="text-xs text-muted">{r.status === 'failed' ? r.error : r.status === 'skipped' ? `Skipped: ${String((r.result as { reason?: string; skipped?: string } | null)?.reason ?? (r.result as { skipped?: string } | null)?.skipped ?? 'condition not met')}` : 'Completed'}</p></div>
                <span className="shrink-0 text-xs text-muted">{fmtDateTime(r.started_at, tz)}</span>
              </div>
            ))}
        </div>
      </section>

      <AutomationModal open={modal.open} rule={modal.rule} onClose={() => setModal({ open: false, rule: null })} />
      <ConfirmDialog open={Boolean(toDelete)} title="Delete automation?" message={`“${toDelete?.name}” and its run history will be deleted.`} loading={remove.isPending} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
    </div>
  );
}

function AutomationModal({ open, rule, onClose }: { open: boolean; rule: AutomationRule | null; onClose: () => void }) {
  const blank = { name: '', trigger_type: 'daily' as TriggerType, time: '08:00', weekday: 1, days_before: 3, action_type: 'notify' as ActionType, title: '', body: '', weekdays_only: false, only_if_open_tasks: false };
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setF(rule ? { name: rule.name, trigger_type: rule.trigger_type, time: rule.trigger_config.time ?? '08:00', weekday: rule.trigger_config.weekday ?? 1, days_before: rule.trigger_config.days_before ?? 3,
      action_type: rule.action_type, title: rule.action_config.title ?? '', body: rule.action_config.body ?? '', weekdays_only: !!rule.conditions.weekdays_only, only_if_open_tasks: !!rule.conditions.only_if_open_tasks } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule]);

  const save = useAppMutation((v: AutomationInput) => (rule ? automationApi.update(rule.id, v) : automationApi.create(v)), { invalidate: ['automations'], success: rule ? 'Automation updated' : 'Automation created', onSuccess: onClose });

  // Keep trigger and action compatible.
  const setTrigger = (t: TriggerType) => setF((s) => ({ ...s, trigger_type: t, action_type: ACTIONS[s.action_type].triggers.includes(t) ? s.action_type : (Object.entries(ACTIONS).find(([, a]) => a.triggers.includes(t))![0] as ActionType) }));

  function submit() {
    const parsed = automationFormSchema.safeParse(f);
    if (!parsed.success) return setErrors(fieldErrors(parsed));
    const v = parsed.data;
    save.mutate({
      name: v.name, trigger_type: v.trigger_type, is_active: rule?.is_active ?? true,
      trigger_config: { time: v.time, ...(v.trigger_type === 'weekly' ? { weekday: v.weekday } : {}), ...(v.trigger_type === 'before_deadline' ? { days_before: v.days_before } : {}) },
      conditions: { ...(v.weekdays_only ? { weekdays_only: true } : {}), ...(v.only_if_open_tasks ? { only_if_open_tasks: true } : {}) },
      action_type: v.action_type, action_config: v.action_type === 'notify' ? { title: v.title?.trim() || v.name, body: v.body?.trim() || undefined } : {},
    });
  }
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((s) => ({ ...s, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));
  const actions = (Object.entries(ACTIONS) as Array<[ActionType, (typeof ACTIONS)[ActionType]]>).filter(([, a]) => a.triggers.includes(f.trigger_type));

  return (
    <Modal open={open} onClose={onClose} title={rule ? 'Edit automation' : 'New automation'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={save.isPending}>Save</Button></>}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
        <Input label="Name" value={f.name} onChange={set('name')} error={errors.name} maxLength={120} />
        <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted">When</p>
        <Select label="Trigger" value={f.trigger_type} onChange={(e) => setTrigger(e.target.value as TriggerType)}>
          <option value="daily">Every day</option><option value="weekly">Every week</option><option value="before_deadline">Before a deadline</option>
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Time" type="time" value={f.time} onChange={set('time')} error={errors.time} />
          {f.trigger_type === 'weekly' && <Select label="Day" value={f.weekday} onChange={(e) => setF((s) => ({ ...s, weekday: Number(e.target.value) }))}>{WEEKDAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</Select>}
          {f.trigger_type === 'before_deadline' && <Input label="Days before" type="number" min={1} max={30} value={f.days_before} onChange={set('days_before')} error={errors.days_before} />}
        </div>
        <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted">Only if</p>
        <Switch label="Weekdays only" checked={f.weekdays_only} onChange={(v) => setF((s) => ({ ...s, weekdays_only: v }))} />
        <Switch label="I have open tasks" checked={f.only_if_open_tasks} onChange={(v) => setF((s) => ({ ...s, only_if_open_tasks: v }))} />
        <p className="pt-1 text-xs font-semibold uppercase tracking-wider text-muted">Then</p>
        <Select label="Action" value={f.action_type} onChange={set('action_type')} hint={ACTIONS[f.action_type].hint}>{actions.map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}</Select>
        {f.action_type === 'notify' && <><Input label="Notification title" value={f.title} onChange={set('title')} maxLength={120} placeholder={f.name || 'Title'} /><Textarea label="Message" value={f.body} onChange={set('body')} maxLength={500} /></>}
      </form>
    </Modal>
  );
}
