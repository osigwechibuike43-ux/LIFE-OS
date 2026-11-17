import type {
  MemoryRow, NoteRow, PendingActionRow, PlanRow, ReminderRow, TaskRow, ToolStore,
} from '../../supabase/functions/_shared/types';

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** In-memory ToolStore used to test tool logic without a database. Records what was written. */
export function createMemoryStore() {
  const s = {
    tasks: [] as TaskRow[],
    reminders: [] as ReminderRow[],
    notes: [] as NoteRow[],
    memories: [] as MemoryRow[],
    plans: [] as PlanRow[],
    pending: [] as PendingActionRow[],
    activity: [] as string[],
    categories: { Work: 'cat-work', Personal: 'cat-personal' } as Record<string, string>,
    inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  };

  const store: ToolStore = {
    async resolveCategory(_k, name) {
      const hit = Object.keys(s.categories).find((c) => c.toLowerCase() === name.toLowerCase());
      return hit ? s.categories[hit] : null;
    },
    async insertTask(row) {
      s.inserts.push({ table: 'tasks', row });
      const t: TaskRow = {
        id: uid(), title: row.title, description: row.description ?? null, status: 'todo', priority: row.priority,
        due_at: row.due_at ?? null, category_id: row.category_id ?? null, recurrence: row.recurrence ?? null,
        completed_at: null, created_at: new Date().toISOString(),
      };
      s.tasks.push(t);
      return t;
    },
    async getTask(id) {
      return s.tasks.find((t) => t.id === id) ?? null;
    },
    async updateTask(id, patch) {
      const t = s.tasks.find((x) => x.id === id);
      if (!t) throw new Error('Task not found');
      Object.assign(t, patch);
      return t;
    },
    async completeTask(id) {
      const t = s.tasks.find((x) => x.id === id);
      if (!t) throw new Error('Task not found');
      t.status = 'done';
      return t;
    },
    async searchTasks(f) {
      return s.tasks.filter((t) => (f.status === 'all' || (f.status === 'open' ? t.status !== 'done' : t.status === 'done'))
        && (!f.query || t.title.toLowerCase().includes(f.query.toLowerCase()))).slice(0, f.limit);
    },
    async insertReminder(row) {
      s.inserts.push({ table: 'reminders', row });
      const r: ReminderRow = { id: uid(), title: row.title, description: row.description ?? null, remind_at: row.remind_at, priority: row.priority, recurrence: row.recurrence ?? null, status: 'pending' };
      s.reminders.push(r);
      return r;
    },
    async searchReminders(f) {
      return s.reminders.filter((r) => f.status === 'all' || r.status === f.status).slice(0, f.limit);
    },
    async insertNote(row) {
      s.inserts.push({ table: 'notes', row });
      const note: NoteRow = { id: uid(), title: row.title, content_text: row.content_text, tags: row.tags, updated_at: new Date().toISOString() };
      s.notes.push(note);
      return note;
    },
    async searchNotes(f) {
      return s.notes.filter((x) => (x.title + x.content_text).toLowerCase().includes(f.query.toLowerCase())).slice(0, f.limit);
    },
    async searchMemories(f) {
      return s.memories.filter((m) => !f.query || m.content.toLowerCase().includes(f.query.toLowerCase())).slice(0, f.limit);
    },
    async insertMemory(row) {
      s.inserts.push({ table: 'memories', row });
      const m: MemoryRow = { id: uid(), category: row.category, content: row.content, source: 'ai_confirmed', created_at: new Date().toISOString() };
      s.memories.push(m);
      return m;
    },
    async scheduleForRange(start, end) {
      const inRange = (iso: string | null) => !!iso && new Date(iso) >= start && new Date(iso) < end;
      return {
        tasks: s.tasks.filter((t) => inRange(t.due_at)),
        reminders: s.reminders.filter((r) => inRange(r.remind_at)),
        events: [],
      };
    },
    async entityExists(table, id) {
      const list = table === 'tasks' ? s.tasks : table === 'reminders' ? s.reminders : [];
      return list.some((x) => x.id === id);
    },
    async getPlan(date) {
      return s.plans.find((p) => p.plan_date === date) ?? null;
    },
    async upsertPlan(row) {
      s.inserts.push({ table: 'daily_plans', row });
      const existing = s.plans.find((p) => p.plan_date === row.plan_date);
      const plan: PlanRow = { id: existing?.id ?? uid(), status: 'proposed', source: 'ai', ...row };
      s.plans = [...s.plans.filter((p) => p.plan_date !== row.plan_date), plan];
      return plan;
    },
    async loadInsightsData() {
      return {
        tasks: s.tasks.map((t) => ({ id: t.id, status: t.status, due_at: t.due_at, completed_at: t.completed_at, created_at: t.created_at, category_id: t.category_id })),
        focus: [], plans: [],
      };
    },
    async recordActivity(e) {
      s.activity.push(e.action);
    },
    async createPending(row) {
      const p: PendingActionRow = { id: uid(), tool: row.tool, args: row.args, summary: row.summary, status: 'pending', expires_at: new Date(Date.now() + 3600_000).toISOString() };
      s.pending.push(p);
      return p;
    },
    async getPending(id) {
      return s.pending.find((p) => p.id === id) ?? null;
    },
    async resolvePending(id, status) {
      const p = s.pending.find((x) => x.id === id);
      if (p) p.status = status;
    },
  };
  return { store, state: s };
}
