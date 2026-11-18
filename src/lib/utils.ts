import clsx, { type ClassValue } from 'clsx';

export const cn = (...v: ClassValue[]) => clsx(v);

/** Turns any thrown value into a message that is safe and useful to show. */
export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m) {
      if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Network problem. Check your connection and try again.';
      if (/plan limit/i.test(m)) return m;
      if (/jwt|not authenticated/i.test(m)) return 'Your session expired. Please sign in again.';
      if (/row-level security|permission denied|42501/i.test(m)) return 'You do not have permission to do that.';
      if (/duplicate key|unique constraint/i.test(m)) return 'That already exists.';
      if (/violates check constraint/i.test(m)) return 'Some of the values are not allowed. Please review the form.';
      return m.length < 160 ? m : fallback;
    }
  }
  return fallback;
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function greeting(hour: number): string {
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_,()]/g, (c) => (c === ',' || c === '(' || c === ')' ? ' ' : `\\${c}`));
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}
