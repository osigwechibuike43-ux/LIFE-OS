// Timezone-aware helpers for the UI. The user's saved timezone (profile) is the source of truth.
export {
  addDaysToKey, isValidDateKey, isValidTimeZone, localDateKey, localDayRange, localHour, safeTimeZone,
  zonedParts, zonedTimeToUtc,
} from '../../supabase/functions/_shared/time';
import { localDateKey, zonedParts, zonedTimeToUtc } from '../../supabase/functions/_shared/time';

export function fmtTime(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export function fmtDate(iso: string | Date, tz: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date(iso));
}
export function fmtDateTime(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
export function fmtLong(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
}

/** Date + time in the user's timezone -> UTC ISO. `date` is YYYY-MM-DD, `time` is HH:MM. */
export function toIso(date: string, time: string, tz: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedTimeToUtc(y, m, d, h, mi, tz).toISOString();
}

/** Splits an ISO instant into the form-friendly local date and time strings. */
export function fromIso(iso: string, tz: string): { date: string; time: string } {
  const p = zonedParts(iso, tz);
  return { date: localDateKey(iso, tz), time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` };
}

export function relativeDue(iso: string, tz: string, now = new Date()): { label: string; overdue: boolean } {
  const key = localDateKey(iso, tz);
  const today = localDateKey(now, tz);
  const overdue = new Date(iso).getTime() < now.getTime();
  if (key === today) return { label: `Today ${fmtTime(iso, tz)}`, overdue };
  const tomorrow = localDateKey(new Date(now.getTime() + 86400000), tz);
  if (key === tomorrow) return { label: `Tomorrow ${fmtTime(iso, tz)}`, overdue: false };
  return { label: fmtDateTime(iso, tz), overdue };
}

/** Monday-first (or Sunday-first) grid of date keys covering the month of `anchorKey`. */
export function monthGrid(anchorKey: string, weekStartsOn: number): string[] {
  const [y, m] = anchorKey.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  });
}

export function weekDays(anchorKey: string, weekStartsOn: number): string[] {
  const [y, m, d] = anchorKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const lead = (dt.getUTCDay() - weekStartsOn + 7) % 7;
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(Date.UTC(y, m - 1, d - lead + i));
    return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
  });
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
export function fmtKey(key: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(keyToDate(key));
}

export function commonTimeZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = fn ? fn('timeZone') : ['UTC', 'Africa/Lagos', 'Europe/London', 'America/New_York', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
  return list.includes('UTC') ? list : ['UTC', ...list];
}
