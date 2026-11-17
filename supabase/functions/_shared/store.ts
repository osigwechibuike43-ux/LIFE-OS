// ToolStore backed by Supabase. The client passed in MUST be created with the caller's own JWT so
// Row Level Security applies; every query is additionally filtered by user_id (defence in depth).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingActionRow, PlanRow, TaskRow, ToolStore } from './types.ts';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const fail = (op: string, error: { message: string } | null): never => {
  console.error(`store.${op} failed`, error?.message);
  throw new Error(`Database operation failed (${op})`);
};

const TASK_COLS = 'id,title,description,status,priority,due_at,category_id,recurrence,completed_at,created_at,task_categories(name)';

// deno-lint-ignore no-explicit-any
const mapTask = (r: any): TaskRow => {
  const { task_categories, ...rest } = r;
  return { ...rest, category_name: task_categories?.name ?? null } as TaskRow;
};

export function createSupabaseStore(db: SupabaseClient, userId: string): ToolStore {
  return {
    async resolveCategory(kind, name) {
      const table = kind === 'task' ? 'task_categories' : 'note_categories';
      const { data, error } = await db.from(table).select('id').eq('user_id', userId).ilike('name', escapeLike(name.trim())).limit(1);
      if (error) fail('resolveCategory', error);
      return data?.[0]?.id ?? null;
    },

    async insertTask(row) {
      const { data, error } = await db.from('tasks').insert({ ...row, user_id: userId, source: 'ai' }).select(TASK_COLS).single();
      if (error) fail('insertTask', error);
      return mapTask(data);
    },
    async getTask(id) {
      const { data, error } = await db.from('tasks').select(TASK_COLS).eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) fail('getTask', error);
      return data ? mapTask(data) : null;
    },
    async updateTask(id, patch) {
      const { data, error } = await db.from('tasks').update(patch).eq('id', id).eq('user_id', userId).select(TASK_COLS).single();
      if (error) fail('updateTask', error);
      return mapTask(data);
    },
    async completeTask(id) {
      const { data, error } = await db.rpc('complete_task', { p_task_id: id });
      if (error) {
        if (error.message?.toLowerCase().includes('not found')) throw new Error('Task not found');
        fail('completeTask', error);
      }
      return data as TaskRow;
    },
    async searchTasks(f) {
      let q = db.from('tasks').select(TASK_COLS).eq('user_id', userId);
      if (f.status === 'open') q = q.neq('status', 'done');
      if (f.status === 'done') q = q.eq('status', 'done');
      if (f.query) q = q.ilike('title', `%${escapeLike(f.query)}%`);
      if (f.categoryId) q = q.eq('category_id', f.categoryId);
      if (f.dueBefore) q = q.lte('due_at', f.dueBefore);
      if (f.dueAfter) q = q.gte('due_at', f.dueAfter);
      const { data, error } = await q.order('due_at', { ascending: true, nullsFirst: false }).limit(f.limit);
      if (error) fail('searchTasks', error);
      return (data ?? []).map(mapTask);
    },

    async insertReminder(row) {
      const { data, error } = await db.from('reminders').insert({ ...row, user_id: userId, source: 'ai' })
        .select('id,title,description,remind_at,priority,recurrence,status').single();
      if (error) fail('insertReminder', error);
      return data;
    },
    async searchReminders(f) {
      let q = db.from('reminders').select('id,title,description,remind_at,priority,recurrence,status').eq('user_id', userId);
      if (f.status !== 'all') q = q.eq('status', f.status);
      if (f.query) q = q.ilike('title', `%${escapeLike(f.query)}%`);
      if (f.from) q = q.gte('remind_at', f.from);
      if (f.to) q = q.lte('remind_at', f.to);
      const { data, error } = await q.order('remind_at', { ascending: true }).limit(f.limit);
      if (error) fail('searchReminders', error);
      return data ?? [];
    },

    async insertNote(row) {
      const { data, error } = await db.from('notes').insert({ ...row, user_id: userId, source: 'ai' })
        .select('id,title,content_text,tags,updated_at').single();
      if (error) fail('insertNote', error);
      return data;
    },
    async searchNotes(f) {
      const like = `%${escapeLike(f.query).replace(/[,()]/g, ' ')}%`;
      const { data, error } = await db.from('notes').select('id,title,content_text,tags,updated_at').eq('user_id', userId)
        .or(`title.ilike.${like},content_text.ilike.${like}`).order('updated_at', { ascending: false }).limit(f.limit);
      if (error) fail('searchNotes', error);
      return data ?? [];
    },

    async searchMemories(f) {
      let q = db.from('memories').select('id,category,content,source,created_at').eq('user_id', userId);
      if (f.category) q = q.eq('category', f.category);
      if (f.query) q = q.ilike('content', `%${escapeLike(f.query)}%`);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(f.limit);
      if (error) fail('searchMemories', error);
      return data ?? [];
    },
    async insertMemory(row) {
      const { data, error } = await db.from('memories').insert({ ...row, user_id: userId, source: 'ai_confirmed' })
        .select('id,category,content,source,created_at').single();
      if (error) fail('insertMemory', error);
      return data;
    },

    async scheduleForRange(start, end) {
      const [tasks, reminders, events] = await Promise.all([
        db.from('tasks').select(TASK_COLS).eq('user_id', userId).gte('due_at', start.toISOString()).lt('due_at', end.toISOString()).order('due_at'),
        db.from('reminders').select('id,title,description,remind_at,priority,recurrence,status').eq('user_id', userId)
          .eq('status', 'pending').gte('remind_at', start.toISOString()).lt('remind_at', end.toISOString()).order('remind_at'),
        db.from('calendar_events').select('id,title,starts_at,ends_at,all_day,location').eq('user_id', userId)
          .lt('starts_at', end.toISOString()).gte('ends_at', start.toISOString()).order('starts_at'),
      ]);
      if (tasks.error) fail('schedule.tasks', tasks.error);
      if (reminders.error) fail('schedule.reminders', reminders.error);
      if (events.error) fail('schedule.events', events.error);
      return { tasks: (tasks.data ?? []).map(mapTask), reminders: reminders.data ?? [], events: events.data ?? [] };
    },
    async entityExists(table, id) {
      const { data, error } = await db.from(table).select('id').eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) fail('entityExists', error);
      return Boolean(data);
    },
    async getPlan(dateKey) {
      const { data, error } = await db.from('daily_plans').select('id,plan_date,status,summary,items,source')
        .eq('user_id', userId).eq('plan_date', dateKey).maybeSingle();
      if (error) fail('getPlan', error);
      return (data as PlanRow | null) ?? null;
    },
    async upsertPlan(row) {
      const { data, error } = await db.from('daily_plans')
        .upsert({ ...row, user_id: userId, status: 'proposed', source: 'ai' }, { onConflict: 'user_id,plan_date' })
        .select('id,plan_date,status,summary,items,source').single();
      if (error) fail('upsertPlan', error);
      return data as PlanRow;
    },

    async loadInsightsData(sinceIso, sinceDate) {
      const [open, done, focus, plans] = await Promise.all([
        db.from('tasks').select('id,status,due_at,completed_at,created_at,category_id').eq('user_id', userId).neq('status', 'done').limit(3000),
        db.from('tasks').select('id,status,due_at,completed_at,created_at,category_id').eq('user_id', userId).eq('status', 'done').gte('completed_at', sinceIso).limit(5000),
        db.from('focus_sessions').select('started_at,duration_seconds').eq('user_id', userId).gte('started_at', sinceIso).limit(5000),
        db.from('daily_plans').select('plan_date,status').eq('user_id', userId).gte('plan_date', sinceDate).limit(100),
      ]);
      for (const [k, r] of Object.entries({ open, done, focus, plans })) if (r.error) fail(`insights.${k}`, r.error);
      return {
        tasks: [...(open.data ?? []), ...(done.data ?? [])] as never,
        focus: focus.data ?? [],
        plans: (plans.data ?? []) as never,
      };
    },

    async recordActivity(e) {
      const { error } = await db.from('activity_logs').insert({
        user_id: userId, action: e.action, entity_type: e.entity_type ?? null, entity_id: e.entity_id ?? null,
        source: 'ai', metadata: e.metadata ?? {},
      });
      if (error) fail('recordActivity', error);
    },

    async createPending(row) {
      const { data, error } = await db.from('ai_pending_actions').insert({ ...row, user_id: userId })
        .select('id,tool,args,summary,status,expires_at').single();
      if (error) fail('createPending', error);
      return data as PendingActionRow;
    },
    async getPending(id) {
      const { data, error } = await db.from('ai_pending_actions').select('id,tool,args,summary,status,expires_at')
        .eq('id', id).eq('user_id', userId).maybeSingle();
      if (error) fail('getPending', error);
      return (data as PendingActionRow | null) ?? null;
    },
    async resolvePending(id, status, result) {
      const { error } = await db.from('ai_pending_actions')
        .update({ status, result: result ?? null, resolved_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId);
      if (error) fail('resolvePending', error);
    },
  };
}
