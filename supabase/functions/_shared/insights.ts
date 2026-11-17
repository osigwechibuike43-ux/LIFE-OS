// Productivity analytics computed ONLY from real database rows. No estimates, no placeholders.
import { addDaysToKey, localDateKey, localHour } from './time.ts';

export interface InsightTask {
  id: string;
  status: 'todo' | 'in_progress' | 'done';
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  category_id: string | null;
}
export interface InsightFocus {
  started_at: string;
  duration_seconds: number;
}
export interface InsightPlan {
  plan_date: string;
  status: 'proposed' | 'approved';
}

export interface DayStat {
  date: string;
  completed: number;
  created: number;
  focusMinutes: number;
}

export interface Insights {
  generatedAt: string;
  completedToday: number;
  completedLast7: number;
  completedLast30: number;
  createdLast7: number;
  openCount: number;
  overdueCount: number;
  dueTodayCount: number;
  /** completed / (completed + still-open tasks that were due in the window); null when there is no data */
  completionRate7: number | null;
  days: DayStat[];
  byHour: number[]; // 24 buckets: completions by local hour (last 30 days)
  peakHour: number | null;
  streak: number; // consecutive local days (ending today or yesterday) with >= 1 completion
  focusMinutesToday: number;
  focusMinutesLast7: number;
  planningConsistency: number | null; // share of the last 14 days that had a plan
  plannedDays14: number;
  byCategory: Record<string, number>; // completed in last 30 days per category id ('none' = uncategorised)
}

export function computeInsights(input: {
  tasks: InsightTask[];
  focus: InsightFocus[];
  plans: InsightPlan[];
  now: Date;
  tz: string;
  windowDays?: number;
}): Insights {
  const { tasks, focus, plans, now, tz } = input;
  const windowDays = input.windowDays ?? 30;
  const today = localDateKey(now, tz);

  const keys: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) keys.push(addDaysToKey(today, -i));
  const days = new Map<string, DayStat>(keys.map((k) => [k, { date: k, completed: 0, created: 0, focusMinutes: 0 }]));
  const byHour = new Array<number>(24).fill(0);
  const byCategory: Record<string, number> = {};
  const completionDates = new Set<string>();

  let open = 0;
  let overdue = 0;
  let dueToday = 0;
  const nowMs = now.getTime();

  for (const t of tasks) {
    if (t.status !== 'done') {
      open++;
      if (t.due_at) {
        const dueMs = new Date(t.due_at).getTime();
        if (dueMs < nowMs) overdue++;
        if (localDateKey(t.due_at, tz) === today) dueToday++;
      }
    }
    const created = days.get(localDateKey(t.created_at, tz));
    if (created) created.created++;
    if (t.status === 'done' && t.completed_at) {
      const k = localDateKey(t.completed_at, tz);
      completionDates.add(k);
      const d = days.get(k);
      if (d) {
        d.completed++;
        byHour[localHour(t.completed_at, tz)]++;
        const cat = t.category_id ?? 'none';
        byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      }
    }
  }

  for (const f of focus) {
    const d = days.get(localDateKey(f.started_at, tz));
    if (d) d.focusMinutes += Math.round(f.duration_seconds / 60);
  }

  const list = keys.map((k) => days.get(k)!);
  const last7 = list.slice(-7);
  const completedLast7 = last7.reduce((a, d) => a + d.completed, 0);
  const createdLast7 = last7.reduce((a, d) => a + d.created, 0);

  // Completion rate: of tasks due in the last 7 days, how many are done.
  const sevenAgo = addDaysToKey(today, -6);
  let dueInWindow = 0;
  let doneInWindow = 0;
  for (const t of tasks) {
    if (!t.due_at) continue;
    const k = localDateKey(t.due_at, tz);
    if (k >= sevenAgo && k <= today) {
      dueInWindow++;
      if (t.status === 'done') doneInWindow++;
    }
  }

  // Streak: count back from today (or yesterday if nothing completed yet today).
  let streak = 0;
  let cursor = completionDates.has(today) ? today : addDaysToKey(today, -1);
  while (completionDates.has(cursor)) {
    streak++;
    cursor = addDaysToKey(cursor, -1);
  }

  const peak = Math.max(...byHour);
  const planKeys = new Set(plans.map((p) => p.plan_date));
  let planned = 0;
  for (let i = 0; i < 14; i++) if (planKeys.has(addDaysToKey(today, -i))) planned++;

  return {
    generatedAt: now.toISOString(),
    completedToday: days.get(today)?.completed ?? 0,
    completedLast7,
    completedLast30: list.reduce((a, d) => a + d.completed, 0),
    createdLast7,
    openCount: open,
    overdueCount: overdue,
    dueTodayCount: dueToday,
    completionRate7: dueInWindow === 0 ? null : Math.round((doneInWindow / dueInWindow) * 100),
    days: list,
    byHour,
    peakHour: peak === 0 ? null : byHour.indexOf(peak),
    streak,
    focusMinutesToday: days.get(today)?.focusMinutes ?? 0,
    focusMinutesLast7: last7.reduce((a, d) => a + d.focusMinutes, 0),
    planningConsistency: Math.round((planned / 14) * 100),
    plannedDays14: planned,
    byCategory,
  };
}
