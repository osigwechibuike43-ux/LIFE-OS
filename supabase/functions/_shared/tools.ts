// Assistant tools. Every tool has a validated input schema, enforces permissions, and acts only
// through the ToolStore (which is scoped to the authenticated user). The model can never supply
// a user id, run SQL, or reach any other user's data.
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { computeInsights } from './insights.ts';
import { addDaysToKey, isValidDateKey, localDateKey, localDayRange, zonedTimeToUtc } from './time.ts';
import type { MemoryCategory, PlanItem, ToolStore } from './types.ts';

export interface ToolContext {
  store: ToolStore;
  timezone: string;
  now: () => Date;
  prefs: { memory_enabled: boolean; ai_can_save_memory: boolean };
}

export class ToolError extends Error {}

// ---------------------------------------------------------------------------
// Shared schema pieces
// ---------------------------------------------------------------------------
const NAIVE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** ISO date-time. With an offset it is exact; without one it is read in the user's timezone. */
const dateTime = z
  .string()
  .refine((s) => WITH_OFFSET.test(s) || NAIVE.test(s), 'Use ISO 8601, e.g. 2026-11-18T10:00:00+01:00')
  .refine((s) => !Number.isNaN(Date.parse(WITH_OFFSET.test(s) ? s : `${s}Z`)), 'Invalid date');

export function toInstant(value: string, tz: string): Date {
  if (WITH_OFFSET.test(value)) return new Date(value);
  const [d, t] = value.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return zonedTimeToUtc(y, m, day, h, mi, tz);
}

const priority = z.enum(['low', 'medium', 'high']);
const dateKey = z.string().refine(isValidDateKey, 'Use YYYY-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
const recurrence = z
  .object({
    freq: z.enum(['daily', 'weekdays', 'weekly', 'monthly']),
    interval: z.number().int().min(1).max(365).optional(),
    until: dateTime.optional(),
  })
  .nullable();

const memoryCategory = z.enum([
  'preferences', 'important_info', 'goals', 'work_education', 'projects', 'important_dates', 'user_created',
]);

const limit = (def = 10) => z.number().int().min(1).max(25).default(def);

// Content that must never be written to memory by the assistant (secrets and identifiers).
const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(?:\d[ -]?){13,19}\b/, // card-like numbers
  /\b(password|passcode|passphrase|pin code|cvv|cvc|api[_ -]?key|secret key|private key|access token|bvn|ssn|social security)\b/i,
];
export function looksSensitive(text: string): boolean {
  return SENSITIVE_PATTERNS.some((r) => r.test(text));
}

export function plainToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  /** Consequential tools are never executed directly: the user must approve first. */
  requiresConfirmation: boolean;
  /** Returns a reason string if this tool must not run for the current user settings. */
  permission?: (ctx: ToolContext) => string | null;
  summarize: (args: z.infer<S>, ctx: ToolContext) => Promise<string> | string;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>;
}

function def<S extends z.ZodTypeAny>(t: ToolDef<S>): ToolDef<S> {
  return t;
}

const fmt = (iso: string | null | undefined, tz: string) =>
  iso
    ? new Intl.DateTimeFormat('en-GB', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
    : 'no date';

const createTask = def({
  name: 'create_task',
  description: 'Create a task for the user. Use when they ask to add/track something to do.',
  schema: z.object({
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    due_at: dateTime.optional().describe('Deadline. ISO 8601 with offset, in the user timezone.'),
    priority: priority.default('medium'),
    category: z.string().max(60).optional().describe('Personal, Education, Work, Business, Health & Fitness, Finance or Other'),
    recurrence: recurrence.optional(),
  }),
  requiresConfirmation: false,
  summarize: (a) => `Create task “${a.title}”`,
  async run(ctx, a) {
    const category_id = a.category ? await ctx.store.resolveCategory('task', a.category) : null;
    const task = await ctx.store.insertTask({
      title: a.title,
      description: a.description ?? null,
      due_at: a.due_at ? toInstant(a.due_at, ctx.timezone).toISOString() : null,
      priority: a.priority,
      category_id,
      recurrence: a.recurrence ?? null,
    });
    return { id: task.id, title: task.title, due_at: task.due_at, priority: task.priority, category_matched: Boolean(category_id) };
  },
});

const updateTask = def({
  name: 'update_task',
  description: 'Change an existing task (title, description, deadline, priority, status or category). Requires user confirmation.',
  schema: z
    .object({
      task_id: z.string().uuid(),
      title: z.string().min(1).max(300).optional(),
      description: z.string().max(5000).nullable().optional(),
      due_at: dateTime.nullable().optional(),
      priority: priority.optional(),
      status: z.enum(['todo', 'in_progress']).optional(),
      category: z.string().max(60).optional(),
    })
    .refine((a) => Object.keys(a).some((k) => k !== 'task_id' && a[k as keyof typeof a] !== undefined), 'Nothing to update'),
  requiresConfirmation: true,
  async summarize(a, ctx) {
    const t = await ctx.store.getTask(a.task_id);
    return `Update task “${t?.title ?? 'unknown task'}”`;
  },
  async run(ctx, a) {
    const existing = await ctx.store.getTask(a.task_id);
    if (!existing) throw new ToolError('Task not found');
    const patch: Parameters<ToolStore['updateTask']>[1] = {};
    if (a.title !== undefined) patch.title = a.title;
    if (a.description !== undefined) patch.description = a.description;
    if (a.due_at !== undefined) patch.due_at = a.due_at === null ? null : toInstant(a.due_at, ctx.timezone).toISOString();
    if (a.priority) patch.priority = a.priority;
    if (a.status) patch.status = a.status;
    if (a.category) patch.category_id = await ctx.store.resolveCategory('task', a.category);
    const t = await ctx.store.updateTask(a.task_id, patch);
    return { id: t.id, title: t.title, status: t.status, due_at: t.due_at, priority: t.priority };
  },
});

const completeTask = def({
  name: 'complete_task',
  description: 'Mark a task as completed. Requires user confirmation. Find the id with search_tasks first.',
  schema: z.object({ task_id: z.string().uuid() }),
  requiresConfirmation: true,
  async summarize(a, ctx) {
    const t = await ctx.store.getTask(a.task_id);
    return `Mark “${t?.title ?? 'unknown task'}” as done`;
  },
  async run(ctx, a) {
    const t = await ctx.store.completeTask(a.task_id);
    return { id: t.id, title: t.title, status: t.status };
  },
});

const searchTasks = def({
  name: 'search_tasks',
  description: "Search the user's tasks. Always use this before claiming anything about their tasks.",
  schema: z.object({
    query: z.string().max(100).optional(),
    status: z.enum(['open', 'done', 'all']).default('open'),
    category: z.string().max(60).optional(),
    due_before: dateTime.optional(),
    due_after: dateTime.optional(),
    limit: limit(),
  }),
  requiresConfirmation: false,
  summarize: () => 'Search tasks',
  async run(ctx, a) {
    const categoryId = a.category ? await ctx.store.resolveCategory('task', a.category) : undefined;
    const rows = await ctx.store.searchTasks({
      query: a.query,
      status: a.status,
      categoryId,
      dueBefore: a.due_before ? toInstant(a.due_before, ctx.timezone).toISOString() : undefined,
      dueAfter: a.due_after ? toInstant(a.due_after, ctx.timezone).toISOString() : undefined,
      limit: a.limit,
    });
    return {
      count: rows.length,
      tasks: rows.map((t) => ({
        id: t.id, title: t.title, status: t.status, priority: t.priority,
        due: t.due_at ? fmt(t.due_at, ctx.timezone) : null, due_at: t.due_at, category: t.category_name ?? null,
      })),
    };
  },
});

const createReminder = def({
  name: 'create_reminder',
  description: 'Create a reminder at a specific time. Requires user confirmation. Ask for the time if it is unclear.',
  schema: z.object({
    title: z.string().min(1).max(300),
    remind_at: dateTime.describe('When to notify. ISO 8601 with offset, in the user timezone.'),
    description: z.string().max(2000).optional(),
    priority: priority.default('medium'),
    recurrence: recurrence.optional(),
  }),
  requiresConfirmation: true,
  summarize: (a, ctx) => `Remind you “${a.title}” — ${fmt(toInstant(a.remind_at, ctx.timezone).toISOString(), ctx.timezone)}`,
  async run(ctx, a) {
    const when = toInstant(a.remind_at, ctx.timezone);
    if (when.getTime() < ctx.now().getTime() - 60_000) throw new ToolError('That time is in the past. Ask the user for a future time.');
    const r = await ctx.store.insertReminder({
      title: a.title, description: a.description ?? null, remind_at: when.toISOString(),
      priority: a.priority, recurrence: a.recurrence ?? null,
    });
    return { id: r.id, title: r.title, remind_at: r.remind_at };
  },
});

const searchReminders = def({
  name: 'search_reminders',
  description: "Search the user's reminders.",
  schema: z.object({
    query: z.string().max(100).optional(),
    status: z.enum(['pending', 'done', 'all']).default('pending'),
    from: dateTime.optional(),
    to: dateTime.optional(),
    limit: limit(),
  }),
  requiresConfirmation: false,
  summarize: () => 'Search reminders',
  async run(ctx, a) {
    const rows = await ctx.store.searchReminders({
      query: a.query, status: a.status, limit: a.limit,
      from: a.from ? toInstant(a.from, ctx.timezone).toISOString() : undefined,
      to: a.to ? toInstant(a.to, ctx.timezone).toISOString() : undefined,
    });
    return {
      count: rows.length,
      reminders: rows.map((r) => ({ id: r.id, title: r.title, when: fmt(r.remind_at, ctx.timezone), status: r.status })),
    };
  },
});

const createNote = def({
  name: 'create_note',
  description: 'Create a note with the given content.',
  schema: z.object({
    title: z.string().min(1).max(300),
    content: z.string().min(1).max(20000),
    tags: z.array(z.string().min(1).max(30)).max(10).optional(),
    category: z.string().max(60).optional().describe('Ideas, Journal, Work, Study or Personal'),
  }),
  requiresConfirmation: false,
  summarize: (a) => `Create note “${a.title}”`,
  async run(ctx, a) {
    const category_id = a.category ? await ctx.store.resolveCategory('note', a.category) : null;
    const n = await ctx.store.insertNote({
      title: a.title, content: plainToHtml(a.content), content_text: a.content,
      tags: (a.tags ?? []).map((t) => t.toLowerCase()), category_id,
    });
    return { id: n.id, title: n.title };
  },
});

const searchNotes = def({
  name: 'search_notes',
  description: "Search the user's notes by keyword.",
  schema: z.object({ query: z.string().min(1).max(100), limit: limit(5) }),
  requiresConfirmation: false,
  summarize: () => 'Search notes',
  async run(ctx, a) {
    const rows = await ctx.store.searchNotes({ query: a.query, limit: a.limit });
    return {
      count: rows.length,
      notes: rows.map((n) => ({ id: n.id, title: n.title, excerpt: n.content_text.slice(0, 300), tags: n.tags })),
    };
  },
});

const searchMemories = def({
  name: 'search_memories',
  description: "Search the user's saved memories (preferences, goals, important dates, …). Only works if memory is enabled.",
  schema: z.object({ query: z.string().max(100).optional(), category: memoryCategory.optional(), limit: limit() }),
  requiresConfirmation: false,
  permission: (ctx) => (ctx.prefs.memory_enabled ? null : 'The user has turned memory off, so saved memories cannot be read.'),
  summarize: () => 'Search memories',
  async run(ctx, a) {
    const rows = await ctx.store.searchMemories({ query: a.query, category: a.category as MemoryCategory | undefined, limit: a.limit });
    return { count: rows.length, memories: rows.map((m) => ({ id: m.id, category: m.category, content: m.content })) };
  },
});

const saveMemory = def({
  name: 'save_memory',
  description:
    'Propose saving something the user explicitly asked you to remember. Requires user confirmation. ' +
    'Never infer or guess facts, and never store passwords, card numbers, IDs or other secrets.',
  schema: z.object({ content: z.string().min(1).max(500), category: memoryCategory.default('user_created') }),
  requiresConfirmation: true,
  permission: (ctx) =>
    !ctx.prefs.memory_enabled
      ? 'The user has turned memory off.'
      : !ctx.prefs.ai_can_save_memory
        ? 'The user has not allowed the assistant to save memories.'
        : null,
  summarize: (a) => `Save to memory: “${a.content}”`,
  async run(ctx, a) {
    if (looksSensitive(a.content)) {
      throw new ToolError('This looks like sensitive information (a secret or identifier). Do not store it; tell the user they can add it manually in My Memory if they really want to.');
    }
    const m = await ctx.store.insertMemory({ content: a.content.trim(), category: a.category });
    return { id: m.id, category: m.category };
  },
});

async function scheduleFor(ctx: ToolContext, date: string | undefined) {
  const key = date ?? localDateKey(ctx.now(), ctx.timezone);
  const { start, end } = localDayRange(key, ctx.timezone);
  const [sched, plan] = await Promise.all([ctx.store.scheduleForRange(start, end), ctx.store.getPlan(key)]);
  return { key, sched, plan };
}

const getDailySchedule = def({
  name: 'get_daily_schedule',
  description: "Get the user's real schedule for a day: tasks due, reminders, calendar events and any saved plan. Defaults to today.",
  schema: z.object({ date: dateKey.optional() }),
  requiresConfirmation: false,
  summarize: () => 'Get daily schedule',
  async run(ctx, a) {
    const { key, sched, plan } = await scheduleFor(ctx, a.date);
    const time = (iso: string) => fmt(iso, ctx.timezone);
    return {
      date: key,
      tasks: sched.tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due: t.due_at ? time(t.due_at) : null })),
      reminders: sched.reminders.map((r) => ({ id: r.id, title: r.title, at: time(r.remind_at) })),
      events: sched.events.map((e) => ({ id: e.id, title: e.title, from: time(e.starts_at), to: time(e.ends_at), location: e.location })),
      plan: plan ? { status: plan.status, summary: plan.summary, items: plan.items.length } : null,
    };
  },
});

const planItem = z.object({
  title: z.string().min(1).max(200),
  start: hhmm.optional(),
  end: hhmm.optional(),
  kind: z.enum(['task', 'reminder', 'event', 'focus', 'break']).default('task'),
  ref_id: z.string().uuid().optional(),
});

const generateDailyPlan = def({
  name: 'generate_daily_plan',
  description:
    'Save a PROPOSED daily plan for the user to review and approve in the Planner. Call get_daily_schedule first and build the ' +
    'plan only from real items; reference real ids in ref_id. This never approves the plan.',
  schema: z.object({
    date: dateKey.optional(),
    summary: z.string().max(500).optional(),
    items: z.array(planItem).min(1).max(20),
  }),
  requiresConfirmation: false, // writes a draft only; approval happens in the UI
  summarize: (a) => `Propose a daily plan with ${a.items.length} items`,
  async run(ctx, a) {
    const key = a.date ?? localDateKey(ctx.now(), ctx.timezone);
    const existing = await ctx.store.getPlan(key);
    if (existing?.status === 'approved') throw new ToolError('An approved plan already exists for this date. Ask the user before replacing it.');
    for (const it of a.items) {
      if (it.start && it.end && it.end <= it.start) throw new ToolError(`“${it.title}” ends before it starts.`);
      if (it.ref_id) {
        const table = it.kind === 'reminder' ? 'reminders' : it.kind === 'event' ? 'calendar_events' : 'tasks';
        if (!(await ctx.store.entityExists(table, it.ref_id))) throw new ToolError(`ref_id for “${it.title}” does not exist.`);
      }
    }
    const items: PlanItem[] = a.items.map((it) => ({
      id: crypto.randomUUID(), title: it.title, start: it.start ?? null, end: it.end ?? null,
      kind: it.kind, ref_id: it.ref_id ?? null, done: false,
    }));
    const plan = await ctx.store.upsertPlan({ plan_date: key, summary: a.summary ?? null, items });
    return { plan_date: plan.plan_date, status: plan.status, items: plan.items.length, note: 'Saved as a proposal. The user must review and approve it in the Planner.' };
  },
});

const retrieveInsights = def({
  name: 'retrieve_productivity_insights',
  description: "Get the user's real productivity statistics. Never invent statistics; use only these numbers.",
  schema: z.object({ period: z.enum(['week', 'month']).default('week') }),
  requiresConfirmation: false,
  summarize: () => 'Retrieve productivity insights',
  async run(ctx, a) {
    const now = ctx.now();
    const today = localDateKey(now, ctx.timezone);
    const sinceDate = addDaysToKey(today, -34);
    const data = await ctx.store.loadInsightsData(localDayRange(sinceDate, ctx.timezone).start.toISOString(), sinceDate);
    const i = computeInsights({ ...data, now, tz: ctx.timezone });
    const week = a.period === 'week';
    return {
      period: a.period,
      completed: week ? i.completedLast7 : i.completedLast30,
      created_last_7_days: i.createdLast7,
      open_tasks: i.openCount,
      overdue_tasks: i.overdueCount,
      due_today: i.dueTodayCount,
      completion_rate_last_7_days_percent: i.completionRate7,
      current_streak_days: i.streak,
      focus_minutes_last_7_days: i.focusMinutesLast7,
      most_productive_hour: i.peakHour,
      planning_consistency_last_14_days_percent: i.planningConsistency,
    };
  },
});

export const TOOLS: ToolDef[] = [
  createTask, updateTask, completeTask, searchTasks, createReminder, searchReminders,
  createNote, searchNotes, searchMemories, saveMemory, getDailySchedule, generateDailyPlan, retrieveInsights,
] as unknown as ToolDef[];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

/** OpenAI-compatible function definitions sent to the model. */
export function toolDefinitions() {
  return TOOLS.map((t) => {
    const schema = zodToJsonSchema(t.schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
    delete schema.$schema;
    return { type: 'function' as const, function: { name: t.name, description: t.description, parameters: schema } };
  });
}

export type ToolOutcome =
  | { ok: true; data: unknown; summary: string }
  | { ok: false; error: string; code: 'unknown_tool' | 'invalid_args' | 'forbidden' | 'failed' };

/** Validates and runs a tool. Never throws; errors are returned so the model can recover. */
export async function executeTool(ctx: ToolContext, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { ok: false, error: `Unknown tool “${name}”.`, code: 'unknown_tool' };
  const parsed = tool.schema.safeParse(rawArgs);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return { ok: false, error: `Invalid arguments — ${msg}`, code: 'invalid_args' };
  }
  const denied = tool.permission?.(ctx);
  if (denied) return { ok: false, error: denied, code: 'forbidden' };
  try {
    const summary = await tool.summarize(parsed.data, ctx);
    const data = await tool.run(ctx, parsed.data);
    await ctx.store.recordActivity({ action: `ai.${name}`, metadata: { tool: name } }).catch(() => undefined);
    return { ok: true, data, summary };
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, error: e.message, code: 'failed' };
    console.error(`tool ${name} failed`, (e as Error)?.message);
    return { ok: false, error: 'The operation failed. Nothing was changed.', code: 'failed' };
  }
}
