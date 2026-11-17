// Row shapes used by the agent layer. Kept intentionally small; the database is the source of truth.

export type Priority = 'low' | 'medium' | 'high';
export type Recurrence = { freq: 'daily' | 'weekdays' | 'weekly' | 'monthly'; interval?: number; until?: string } | null;

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done';
  priority: Priority;
  due_at: string | null;
  category_id: string | null;
  category_name?: string | null;
  recurrence: Recurrence;
  completed_at: string | null;
  created_at: string;
}

export interface ReminderRow {
  id: string;
  title: string;
  description: string | null;
  remind_at: string;
  priority: Priority;
  recurrence: Recurrence;
  status: 'pending' | 'done' | 'dismissed';
}

export interface EventRow {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
}

export interface NoteRow {
  id: string;
  title: string;
  content_text: string;
  tags: string[];
  updated_at: string;
}

export type MemoryCategory =
  | 'preferences' | 'important_info' | 'goals' | 'work_education' | 'projects' | 'important_dates' | 'user_created';

export interface MemoryRow {
  id: string;
  category: MemoryCategory;
  content: string;
  source: 'user' | 'ai_confirmed';
  created_at: string;
}

export interface PlanItem {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  kind: 'task' | 'reminder' | 'event' | 'focus' | 'break';
  ref_id: string | null;
  done: boolean;
}

export interface PlanRow {
  id: string;
  plan_date: string;
  status: 'proposed' | 'approved';
  summary: string | null;
  items: PlanItem[];
  source: 'manual' | 'ai' | 'automation';
}

export interface PendingActionRow {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'failed';
  expires_at: string;
}

/**
 * All data access the assistant tools need. Every implementation MUST scope each call to the
 * authenticated user. Tools never receive or accept a user id from model output.
 */
export interface ToolStore {
  resolveCategory(kind: 'task' | 'note', name: string): Promise<string | null>;

  insertTask(row: {
    title: string; description?: string | null; due_at?: string | null; priority: Priority;
    category_id?: string | null; recurrence?: Recurrence;
  }): Promise<TaskRow>;
  getTask(id: string): Promise<TaskRow | null>;
  updateTask(id: string, patch: Partial<Pick<TaskRow, 'title' | 'description' | 'due_at' | 'priority' | 'status' | 'category_id'>>): Promise<TaskRow>;
  completeTask(id: string): Promise<TaskRow>;
  searchTasks(f: {
    query?: string; status: 'open' | 'done' | 'all'; categoryId?: string | null;
    dueBefore?: string; dueAfter?: string; limit: number;
  }): Promise<TaskRow[]>;

  insertReminder(row: {
    title: string; description?: string | null; remind_at: string; priority: Priority; recurrence?: Recurrence;
  }): Promise<ReminderRow>;
  searchReminders(f: {
    query?: string; status: 'pending' | 'done' | 'all'; from?: string; to?: string; limit: number;
  }): Promise<ReminderRow[]>;

  insertNote(row: {
    title: string; content: string; content_text: string; tags: string[]; category_id?: string | null;
  }): Promise<NoteRow>;
  searchNotes(f: { query: string; limit: number }): Promise<NoteRow[]>;

  searchMemories(f: { query?: string; category?: MemoryCategory; limit: number }): Promise<MemoryRow[]>;
  insertMemory(row: { content: string; category: MemoryCategory }): Promise<MemoryRow>;

  scheduleForRange(start: Date, end: Date): Promise<{ tasks: TaskRow[]; reminders: ReminderRow[]; events: EventRow[] }>;
  entityExists(table: 'tasks' | 'reminders' | 'calendar_events', id: string): Promise<boolean>;
  getPlan(dateKey: string): Promise<PlanRow | null>;
  upsertPlan(row: { plan_date: string; summary: string | null; items: PlanItem[] }): Promise<PlanRow>;

  loadInsightsData(sinceIso: string, sinceDate: string): Promise<{
    tasks: Array<{ id: string; status: TaskRow['status']; due_at: string | null; completed_at: string | null; created_at: string; category_id: string | null }>;
    focus: Array<{ started_at: string; duration_seconds: number }>;
    plans: Array<{ plan_date: string; status: 'proposed' | 'approved' }>;
  }>;

  recordActivity(entry: { action: string; entity_type?: string; entity_id?: string | null; metadata?: Record<string, unknown> }): Promise<void>;

  createPending(row: { conversation_id: string | null; tool: string; args: Record<string, unknown>; summary: string }): Promise<PendingActionRow>;
  getPending(id: string): Promise<PendingActionRow | null>;
  resolvePending(id: string, status: PendingActionRow['status'], result?: unknown): Promise<void>;
}
