export type Priority = 'low' | 'medium' | 'high';
export type Recurrence = { freq: 'daily' | 'weekdays' | 'weekly' | 'monthly'; interval?: number; until?: string } | null;

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  primary_use_case: string | null;
  interests: string[];
  timezone: string;
  onboarding_completed: boolean;
  plan_id: 'free' | 'pro' | 'premium' | 'business';
}

export interface UserPreferences {
  user_id: string;
  theme: 'light' | 'dark' | 'system';
  notifications_in_app: boolean;
  notifications_push: boolean;
  notifications_email: boolean;
  memory_enabled: boolean;
  ai_can_save_memory: boolean;
  ai_enabled: boolean;
  week_starts_on: number;
  dashboard_widgets: Record<string, boolean>;
}

export interface Category { id: string; name: string; color: string; is_default: boolean; sort_order: number }

export interface Task {
  id: string;
  category_id: string | null;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done';
  priority: Priority;
  due_at: string | null;
  recurrence: Recurrence;
  completed_at: string | null;
  source: 'manual' | 'ai' | 'automation';
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  task_id: string | null;
  title: string;
  description: string | null;
  remind_at: string;
  priority: Priority;
  recurrence: Recurrence;
  status: 'pending' | 'done' | 'dismissed';
  notified_at: string | null;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  color: string;
}

export interface Note {
  id: string;
  category_id: string | null;
  title: string;
  content: string;
  content_text: string;
  tags: string[];
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: string;
  name: string;
  category: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export const MEMORY_CATEGORIES = [
  ['preferences', 'Personal preferences'],
  ['important_info', 'Important information'],
  ['goals', 'Personal goals'],
  ['work_education', 'Work & education'],
  ['projects', 'Projects'],
  ['important_dates', 'Important dates'],
  ['user_created', 'My memories'],
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number][0];

export interface Memory {
  id: string;
  category: MemoryCategory;
  content: string;
  source: 'user' | 'ai_confirmed';
  created_at: string;
  updated_at: string;
}

export interface Conversation { id: string; title: string; created_at: string; updated_at: string }
export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  metadata: { tools?: Array<{ name: string; ok: boolean; summary: string }>; pending_action_ids?: string[] };
  created_at: string;
}

export interface PendingAction {
  id: string;
  tool: string;
  summary: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'failed';
  expires_at: string;
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
export interface DailyPlan {
  id: string;
  plan_date: string;
  status: 'proposed' | 'approved';
  summary: string | null;
  items: PlanItem[];
  source: 'manual' | 'ai' | 'automation';
}

export type TriggerType = 'daily' | 'weekly' | 'before_deadline';
export type ActionType = 'notify' | 'weekly_summary' | 'daily_plan' | 'deadline_alert';
export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  trigger_type: TriggerType;
  trigger_config: { time?: string; weekday?: number; days_before?: number };
  conditions: { weekdays_only?: boolean; only_if_open_tasks?: boolean };
  action_type: ActionType;
  action_config: { title?: string; body?: string; priority?: string };
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}
export interface AutomationRun {
  id: string;
  rule_id: string;
  status: 'success' | 'skipped' | 'failed';
  started_at: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface AppNotification {
  id: string;
  type: 'reminder' | 'automation' | 'system' | 'deadline';
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface FocusSession { id: string; started_at: string; ended_at: string | null; duration_seconds: number; task_id: string | null }
