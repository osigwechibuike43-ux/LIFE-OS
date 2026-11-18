// Data access layer. UI components never call Supabase directly; they use these functions via hooks.
// Row Level Security is the real guard, and every write also sets user_id from the session.
import { supabase } from '@/lib/supabase';
import { escapeLike } from '@/lib/utils';
import type {
  AppNotification, AutomationRule, AutomationRun, CalendarEvent, Category, Conversation, DailyPlan, DocumentRow,
  FocusSession, Memory, Message, Note, PendingAction, Profile, Recurrence, Reminder, Task, UserPreferences,
} from '@/types/db';
import { currentUserId, friendlyDbError, PAGE_SIZE, unwrap } from './api';

const DOCS_BUCKET = 'lifeos-documents';

// ---- profile & preferences ------------------------------------------------------------
export const profileApi = {
  /** Returns the profile, creating it (idempotently, server-side) the first time this account opens LIFE OS. */
  get: async (): Promise<Profile> => {
    const existing = await supabase.from('profiles').select('*').maybeSingle();
    if (existing.error) throw new Error(friendlyDbError(existing.error));
    if (existing.data) return existing.data as Profile;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const created = await supabase.rpc('ensure_profile', { p_timezone: tz });
    if (created.error) throw new Error(friendlyDbError(created.error));
    return created.data as Profile;
  },
  update: async (patch: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'primary_use_case' | 'interests' | 'timezone' | 'onboarding_completed'>>) => {
    const id = await currentUserId();
    return unwrap<Profile>(supabase.from('profiles').update(patch).eq('id', id).select('*').single());
  },
  entitlements: async () => unwrap<{ plan_id: string; plan_name: string; limits: Record<string, number> }>(supabase.rpc('get_entitlements')),
};

export const prefsApi = {
  get: async (): Promise<UserPreferences> => unwrap(supabase.from('user_preferences').select('*').single()),
  update: async (patch: Partial<Omit<UserPreferences, 'user_id'>>) => {
    const id = await currentUserId();
    return unwrap<UserPreferences>(supabase.from('user_preferences').update(patch).eq('user_id', id).select('*').single());
  },
  getProvider: async () => unwrap<{ provider: string; model: string | null }>(supabase.from('ai_provider_settings').select('provider,model').single()),
  setProvider: async (provider: string, model: string | null) => {
    const id = await currentUserId();
    return unwrap(supabase.from('ai_provider_settings').update({ provider, model }).eq('user_id', id));
  },
};

// ---- categories -------------------------------------------------------------------------
export const categoryApi = {
  tasks: async (): Promise<Category[]> => unwrap(supabase.from('task_categories').select('*').order('sort_order')),
  notes: async (): Promise<Category[]> => unwrap(supabase.from('note_categories').select('*').order('sort_order')),
};

// ---- tasks ------------------------------------------------------------------------------
export interface TaskFilter {
  status?: 'open' | 'done' | 'all';
  categoryId?: string | null;
  priority?: string | null;
  search?: string;
  page?: number;
}
export type TaskInput = {
  title: string; description?: string | null; priority: Task['priority']; category_id: string | null;
  due_at: string | null; recurrence: Recurrence;
};

export const taskApi = {
  list: async (f: TaskFilter = {}): Promise<{ rows: Task[]; hasMore: boolean }> => {
    let q = supabase.from('tasks').select('*');
    if (f.status === 'open' || !f.status) q = q.neq('status', 'done');
    if (f.status === 'done') q = q.eq('status', 'done');
    if (f.categoryId) q = q.eq('category_id', f.categoryId);
    if (f.priority) q = q.eq('priority', f.priority);
    if (f.search?.trim()) q = q.ilike('title', `%${escapeLike(f.search.trim())}%`);
    const from = (f.page ?? 0) * PAGE_SIZE;
    const rows = await unwrap<Task[]>(
      q.order('due_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).range(from, from + PAGE_SIZE),
    );
    return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
  },
  range: async (startIso: string, endIso: string): Promise<Task[]> =>
    unwrap(supabase.from('tasks').select('*').gte('due_at', startIso).lt('due_at', endIso).order('due_at')),
  today: async (endIso: string): Promise<Task[]> =>
    unwrap(supabase.from('tasks').select('*').neq('status', 'done').lt('due_at', endIso).order('due_at').limit(50)),
  create: async (t: TaskInput) => {
    const user_id = await currentUserId();
    return unwrap<Task>(supabase.from('tasks').insert({ ...t, user_id }).select('*').single());
  },
  update: async (id: string, t: Partial<TaskInput> & { status?: Task['status'] }) =>
    unwrap<Task>(supabase.from('tasks').update(t).eq('id', id).select('*').single()),
  complete: async (id: string) => unwrap<Task>(supabase.rpc('complete_task', { p_task_id: id })),
  reopen: async (id: string) => unwrap<Task>(supabase.from('tasks').update({ status: 'todo', completed_at: null }).eq('id', id).select('*').single()),
  remove: async (id: string) => unwrap(supabase.from('tasks').delete().eq('id', id)),
};

// ---- reminders --------------------------------------------------------------------------
export type ReminderInput = { title: string; description?: string | null; remind_at: string; priority: Reminder['priority']; recurrence: Recurrence };
export const reminderApi = {
  list: async (status: 'pending' | 'done' = 'pending'): Promise<Reminder[]> =>
    unwrap(supabase.from('reminders').select('*').eq('status', status).order('remind_at', { ascending: status === 'pending' }).limit(100)),
  range: async (startIso: string, endIso: string): Promise<Reminder[]> =>
    unwrap(supabase.from('reminders').select('*').gte('remind_at', startIso).lt('remind_at', endIso).order('remind_at')),
  create: async (r: ReminderInput) => {
    const user_id = await currentUserId();
    return unwrap<Reminder>(supabase.from('reminders').insert({ ...r, user_id }).select('*').single());
  },
  update: async (id: string, r: Partial<ReminderInput>) =>
    unwrap<Reminder>(supabase.from('reminders').update({ ...r, notified_at: null }).eq('id', id).select('*').single()),
  complete: async (id: string) => unwrap<Reminder>(supabase.rpc('complete_reminder', { p_reminder_id: id })),
  remove: async (id: string) => unwrap(supabase.from('reminders').delete().eq('id', id)),
};

// ---- calendar events --------------------------------------------------------------------
export type EventInput = Omit<CalendarEvent, 'id'>;
export const eventApi = {
  range: async (startIso: string, endIso: string): Promise<CalendarEvent[]> =>
    unwrap(supabase.from('calendar_events').select('*').lt('starts_at', endIso).gte('ends_at', startIso).order('starts_at')),
  create: async (e: EventInput) => {
    const user_id = await currentUserId();
    return unwrap<CalendarEvent>(supabase.from('calendar_events').insert({ ...e, user_id }).select('*').single());
  },
  update: async (id: string, e: Partial<EventInput>) => unwrap<CalendarEvent>(supabase.from('calendar_events').update(e).eq('id', id).select('*').single()),
  remove: async (id: string) => unwrap(supabase.from('calendar_events').delete().eq('id', id)),
};

// ---- notes ------------------------------------------------------------------------------
export interface NoteFilter { search?: string; categoryId?: string | null; favorites?: boolean; tag?: string | null; page?: number }
export type NoteInput = { title: string; content: string; content_text: string; tags: string[]; category_id: string | null; is_favorite?: boolean };
export const noteApi = {
  list: async (f: NoteFilter = {}): Promise<{ rows: Note[]; hasMore: boolean }> => {
    let q = supabase.from('notes').select('*');
    if (f.search?.trim()) {
      const like = `%${escapeLike(f.search.trim())}%`;
      q = q.or(`title.ilike.${like},content_text.ilike.${like}`);
    }
    if (f.categoryId) q = q.eq('category_id', f.categoryId);
    if (f.favorites) q = q.eq('is_favorite', true);
    if (f.tag) q = q.contains('tags', [f.tag]);
    const from = (f.page ?? 0) * PAGE_SIZE;
    const rows = await unwrap<Note[]>(q.order('is_favorite', { ascending: false }).order('updated_at', { ascending: false }).range(from, from + PAGE_SIZE));
    return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
  },
  recent: async (n = 4): Promise<Note[]> => unwrap(supabase.from('notes').select('*').order('updated_at', { ascending: false }).limit(n)),
  create: async (n: NoteInput) => {
    const user_id = await currentUserId();
    return unwrap<Note>(supabase.from('notes').insert({ ...n, user_id }).select('*').single());
  },
  update: async (id: string, n: Partial<NoteInput>) => unwrap<Note>(supabase.from('notes').update(n).eq('id', id).select('*').single()),
  remove: async (id: string) => unwrap(supabase.from('notes').delete().eq('id', id)),
};

// ---- memories ---------------------------------------------------------------------------
export const memoryApi = {
  list: async (f: { search?: string; category?: string | null } = {}): Promise<Memory[]> => {
    let q = supabase.from('memories').select('*');
    if (f.category) q = q.eq('category', f.category);
    if (f.search?.trim()) q = q.ilike('content', `%${escapeLike(f.search.trim())}%`);
    return unwrap(q.order('created_at', { ascending: false }).limit(500));
  },
  create: async (m: { content: string; category: Memory['category'] }) => {
    const user_id = await currentUserId();
    return unwrap<Memory>(supabase.from('memories').insert({ ...m, user_id, source: 'user' }).select('*').single());
  },
  update: async (id: string, m: { content: string; category: Memory['category'] }) =>
    unwrap<Memory>(supabase.from('memories').update(m).eq('id', id).select('*').single()),
  remove: async (id: string) => unwrap(supabase.from('memories').delete().eq('id', id)),
  removeAll: async () => {
    const id = await currentUserId();
    return unwrap(supabase.from('memories').delete().eq('user_id', id));
  },
};

// ---- documents (private storage) --------------------------------------------------------
export const documentApi = {
  list: async (f: { search?: string; category?: string | null } = {}): Promise<DocumentRow[]> => {
    let q = supabase.from('documents').select('*');
    if (f.category) q = q.eq('category', f.category);
    if (f.search?.trim()) q = q.ilike('name', `%${escapeLike(f.search.trim())}%`);
    return unwrap(q.order('created_at', { ascending: false }).limit(200));
  },
  upload: async (file: File, category: string, storagePath: string): Promise<DocumentRow> => {
    const user_id = await currentUserId();
    const up = await supabase.storage.from(DOCS_BUCKET).upload(`${user_id}/${storagePath}`, file, { contentType: file.type, upsert: false });
    if (up.error) throw new Error(up.error.message);
    const { data, error } = await supabase.from('documents')
      .insert({ user_id, name: file.name.slice(0, 255), category, storage_path: `${user_id}/${storagePath}`, mime_type: file.type, size_bytes: file.size })
      .select('*').single();
    if (error) {
      await supabase.storage.from(DOCS_BUCKET).remove([`${user_id}/${storagePath}`]); // no orphaned files
      throw new Error(error.message);
    }
    return data as DocumentRow;
  },
  /** Short-lived signed URL; documents are never public. */
  signedUrl: async (path: string, download?: string | boolean) => {
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 120, download ? { download } : undefined);
    if (error || !data) throw new Error(error?.message ?? 'Could not open the file');
    return data.signedUrl;
  },
  update: async (id: string, patch: { name?: string; category?: string }) => unwrap<DocumentRow>(supabase.from('documents').update(patch).eq('id', id).select('*').single()),
  remove: async (doc: DocumentRow) => {
    const rm = await supabase.storage.from(DOCS_BUCKET).remove([doc.storage_path]);
    if (rm.error) throw new Error(rm.error.message);
    return unwrap(supabase.from('documents').delete().eq('id', doc.id));
  },
};

// ---- conversations & AI -------------------------------------------------------------------
export const conversationApi = {
  list: async (): Promise<Conversation[]> => unwrap(supabase.from('conversations').select('*').order('updated_at', { ascending: false }).limit(100)),
  messages: async (id: string): Promise<Message[]> =>
    unwrap(supabase.from('messages').select('*').eq('conversation_id', id).in('role', ['user', 'assistant']).order('created_at').limit(500)),
  rename: async (id: string, title: string) => unwrap(supabase.from('conversations').update({ title: title.slice(0, 200) }).eq('id', id)),
  remove: async (id: string) => unwrap(supabase.from('conversations').delete().eq('id', id)),
  pending: async (ids: string[]): Promise<PendingAction[]> =>
    ids.length ? unwrap(supabase.from('ai_pending_actions').select('id,tool,summary,status,expires_at').in('id', ids)) : [],
};

// ---- daily plans --------------------------------------------------------------------------
export const planApi = {
  get: async (dateKey: string): Promise<DailyPlan | null> => unwrap(supabase.from('daily_plans').select('*').eq('plan_date', dateKey).maybeSingle()),
  save: async (p: { plan_date: string; summary: string | null; items: DailyPlan['items']; status: DailyPlan['status']; source?: DailyPlan['source'] }) => {
    const user_id = await currentUserId();
    return unwrap<DailyPlan>(supabase.from('daily_plans').upsert({ ...p, user_id }, { onConflict: 'user_id,plan_date' }).select('*').single());
  },
  remove: async (id: string) => unwrap(supabase.from('daily_plans').delete().eq('id', id)),
  since: async (dateKey: string): Promise<Array<Pick<DailyPlan, 'plan_date' | 'status'>>> =>
    unwrap(supabase.from('daily_plans').select('plan_date,status').gte('plan_date', dateKey)),
};

// ---- automations ---------------------------------------------------------------------------
export type AutomationInput = Pick<AutomationRule, 'name' | 'trigger_type' | 'trigger_config' | 'conditions' | 'action_type' | 'action_config' | 'is_active'>;
export const automationApi = {
  list: async (): Promise<AutomationRule[]> => unwrap(supabase.from('automation_rules').select('*').order('created_at', { ascending: false })),
  create: async (a: AutomationInput) => {
    const user_id = await currentUserId();
    return unwrap<AutomationRule>(supabase.from('automation_rules').insert({ ...a, user_id }).select('*').single());
  },
  update: async (id: string, a: Partial<AutomationInput>) => unwrap<AutomationRule>(supabase.from('automation_rules').update(a).eq('id', id).select('*').single()),
  remove: async (id: string) => unwrap(supabase.from('automation_rules').delete().eq('id', id)),
  runs: async (): Promise<AutomationRun[]> => unwrap(supabase.from('automation_runs').select('*').order('started_at', { ascending: false }).limit(50)),
};

// ---- notifications --------------------------------------------------------------------------
export const notificationApi = {
  list: async (): Promise<AppNotification[]> => unwrap(supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)),
  unreadCount: async (): Promise<number> => {
    const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
    if (error) throw new Error(error.message);
    return count ?? 0;
  },
  markRead: async (id: string) => unwrap(supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)),
  markAllRead: async () => unwrap(supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)),
  remove: async (id: string) => unwrap(supabase.from('notifications').delete().eq('id', id)),
  clear: async () => {
    const id = await currentUserId();
    return unwrap(supabase.from('notifications').delete().eq('user_id', id));
  },
};

// ---- focus sessions & insights data ----------------------------------------------------------
export const focusApi = {
  start: async (task_id: string | null = null) => {
    const user_id = await currentUserId();
    return unwrap<FocusSession>(supabase.from('focus_sessions').insert({ user_id, task_id }).select('*').single());
  },
  stop: async (id: string, startedAtIso: string) => {
    const seconds = Math.max(0, Math.min(86400, Math.round((Date.now() - new Date(startedAtIso).getTime()) / 1000)));
    return unwrap<FocusSession>(supabase.from('focus_sessions').update({ ended_at: new Date().toISOString(), duration_seconds: seconds }).eq('id', id).select('*').single());
  },
  since: async (iso: string): Promise<FocusSession[]> => unwrap(supabase.from('focus_sessions').select('*').gte('started_at', iso).order('started_at').limit(5000)),
  open: async (): Promise<FocusSession | null> => unwrap(supabase.from('focus_sessions').select('*').is('ended_at', null).order('started_at', { ascending: false }).limit(1).maybeSingle()),
};

export const insightsApi = {
  load: async (sinceIso: string, sinceDate: string) => {
    const cols = 'id,status,due_at,completed_at,created_at,category_id';
    const [open, done, focus, plans] = await Promise.all([
      unwrap<Task[]>(supabase.from('tasks').select(cols).neq('status', 'done').limit(3000)),
      unwrap<Task[]>(supabase.from('tasks').select(cols).eq('status', 'done').gte('completed_at', sinceIso).limit(5000)),
      focusApi.since(sinceIso),
      planApi.since(sinceDate),
    ]);
    return { tasks: [...open, ...done], focus, plans };
  },
};

// ---- activity & export -----------------------------------------------------------------------
export const exportApi = {
  /** Gathers every personal record the user owns (documents are listed as metadata; files can be downloaded individually). */
  all: async () => {
    const tables = ['profiles', 'user_preferences', 'tasks', 'reminders', 'calendar_events', 'notes', 'memories', 'conversations', 'messages',
      'daily_plans', 'automation_rules', 'automation_runs', 'notifications', 'documents', 'focus_sessions', 'activity_logs'] as const;
    const out: Record<string, unknown> = { exported_at: new Date().toISOString(), format_version: 1 };
    for (const t of tables) out[t] = await unwrap(supabase.from(t).select('*').limit(50000));
    return out;
  },
  memories: async () => ({ exported_at: new Date().toISOString(), memories: await memoryApi.list() }),
};

export const activityApi = {
  log: async (action: string, entity_type?: string, entity_id?: string) => {
    const user_id = await currentUserId();
    await supabase.from('activity_logs').insert({ user_id, action, entity_type, entity_id });
  },
};
