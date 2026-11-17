// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  addDaysToKey, formatLocalIso, isValidDateKey, localDateKey, localDayRange, zonedTimeToUtc,
} from '../../supabase/functions/_shared/time';
import { computeInsights } from '../../supabase/functions/_shared/insights';

describe('time helpers', () => {
  it('formats a local ISO string with the correct offset (Lagos = +01:00)', () => {
    expect(formatLocalIso(new Date('2026-11-17T11:19:00Z'), 'Africa/Lagos')).toBe('2026-11-17T12:19:00+01:00');
  });

  it('finds the local day boundaries, DST aware', () => {
    const { start, end } = localDayRange('2026-03-08', 'America/New_York'); // spring-forward day: 23h long
    expect(end.getTime() - start.getTime()).toBe(23 * 3600 * 1000);
    const lagos = localDayRange('2026-11-17', 'Africa/Lagos');
    expect(lagos.start.toISOString()).toBe('2026-11-16T23:00:00.000Z');
  });

  it('assigns instants to the right local date', () => {
    expect(localDateKey('2026-11-17T23:30:00Z', 'Africa/Lagos')).toBe('2026-11-18');
    expect(localDateKey('2026-11-17T23:30:00Z', 'UTC')).toBe('2026-11-17');
  });

  it('converts wall-clock times to UTC', () => {
    expect(zonedTimeToUtc(2026, 11, 18, 10, 0, 'Africa/Lagos').toISOString()).toBe('2026-11-18T09:00:00.000Z');
  });

  it('does date arithmetic and validation', () => {
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-02-28')).toBe(true);
  });
});

describe('computeInsights', () => {
  const tz = 'Africa/Lagos';
  const now = new Date('2026-11-17T12:00:00Z');
  const mk = (over: Partial<Parameters<typeof computeInsights>[0]['tasks'][number]>) => ({
    id: Math.random().toString(36).slice(2), status: 'todo' as const, due_at: null, completed_at: null,
    created_at: '2026-11-10T09:00:00Z', category_id: null, ...over,
  });

  it('returns honest nulls/zeros with no data (never invented numbers)', () => {
    const r = computeInsights({ tasks: [], focus: [], plans: [], now, tz });
    expect(r.completionRate7).toBeNull();
    expect(r.peakHour).toBeNull();
    expect(r.streak).toBe(0);
    expect(r.completedLast30).toBe(0);
    expect(r.days).toHaveLength(30);
  });

  it('counts completions, open, overdue and rate from real rows', () => {
    const tasks = [
      mk({ status: 'done', completed_at: '2026-11-17T08:30:00Z', due_at: '2026-11-17T10:00:00Z' }),
      mk({ status: 'done', completed_at: '2026-11-16T14:00:00Z', due_at: '2026-11-16T15:00:00Z' }),
      mk({ status: 'todo', due_at: '2026-11-15T10:00:00Z' }), // overdue, due in window
      mk({ status: 'todo', due_at: '2026-11-20T10:00:00Z' }), // open, future
    ];
    const r = computeInsights({ tasks, focus: [], plans: [], now, tz });
    expect(r.completedToday).toBe(1);
    expect(r.completedLast7).toBe(2);
    expect(r.openCount).toBe(2);
    expect(r.overdueCount).toBe(1);
    expect(r.completionRate7).toBe(67); // 2 of 3 tasks due in the last 7 days
    expect(r.streak).toBe(2);
    expect(r.peakHour).not.toBeNull();
  });

  it('keeps a streak alive when today has no completion yet', () => {
    const tasks = [
      mk({ status: 'done', completed_at: '2026-11-16T10:00:00Z' }),
      mk({ status: 'done', completed_at: '2026-11-15T10:00:00Z' }),
    ];
    expect(computeInsights({ tasks, focus: [], plans: [], now, tz }).streak).toBe(2);
  });

  it('sums focus minutes and planning consistency', () => {
    const r = computeInsights({
      tasks: [],
      focus: [{ started_at: '2026-11-17T09:00:00Z', duration_seconds: 1500 }],
      plans: [{ plan_date: '2026-11-17', status: 'approved' }, { plan_date: '2026-11-16', status: 'proposed' }],
      now, tz,
    });
    expect(r.focusMinutesToday).toBe(25);
    expect(r.plannedDays14).toBe(2);
    expect(r.planningConsistency).toBe(14);
  });
});
