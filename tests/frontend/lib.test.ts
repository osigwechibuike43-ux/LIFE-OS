import { describe, expect, it } from 'vitest';
import {
  fieldErrors, loginSchema, newPasswordSchema, passwordSchema, reminderFormSchema, safeFileName,
  signupSchema, taskFormSchema, validateDocumentFile, MAX_DOC_BYTES,
} from '@/lib/validation';
import { htmlToText, sanitizeHtml } from '@/lib/sanitize';
import { fromIso, monthGrid, relativeDue, toIso, weekDays } from '@/lib/dates';
import { parseSse } from '@/services/ai';

describe('auth validation', () => {
  it('normalises and validates email', () => {
    const r = loginSchema.safeParse({ email: '  USER@Example.com ', password: 'x' });
    expect(r.success && r.data.email).toBe('user@example.com');
    expect(fieldErrors(loginSchema.safeParse({ email: 'nope', password: 'x' })).email).toMatch(/valid email/);
  });
  it.each([['short1A', /8 characters/], ['alllowercase1', /uppercase/], ['ALLUPPER1234', /lowercase/], ['NoNumbersHere', /number/]])(
    'rejects weak password %s', (pw, msg) => {
      const r = passwordSchema.safeParse(pw);
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.message).join()).toMatch(msg);
    });
  it('accepts a strong password and rejects >72 chars', () => {
    expect(passwordSchema.safeParse('Str0ngPassw0rd').success).toBe(true);
    expect(passwordSchema.safeParse('Aa1' + 'x'.repeat(80)).success).toBe(false);
  });
  it('requires terms acceptance on signup', () => {
    const base = { name: 'Ada', email: 'a@b.co', password: 'Str0ngPassw0rd' };
    expect(signupSchema.safeParse({ ...base, accept: false }).success).toBe(false);
    expect(signupSchema.safeParse({ ...base, accept: true }).success).toBe(true);
  });
  it('checks password confirmation', () => {
    expect(fieldErrors(newPasswordSchema.safeParse({ password: 'Str0ngPassw0rd', confirm: 'different' })).confirm).toMatch(/do not match/);
  });
});

describe('form validation', () => {
  it('trims and requires task title', () => {
    expect(taskFormSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(taskFormSchema.safeParse({ title: 'x'.repeat(301) }).success).toBe(false);
  });
  it('validates reminder date/time format', () => {
    const ok = { title: 'Call', priority: 'low', date: '2026-11-18', time: '09:30', recurrence: 'none' };
    expect(reminderFormSchema.safeParse(ok).success).toBe(true);
    expect(reminderFormSchema.safeParse({ ...ok, time: '25:00' }).success).toBe(false);
    expect(reminderFormSchema.safeParse({ ...ok, date: '18/11/2026' }).success).toBe(false);
  });
});

describe('document file validation', () => {
  it('accepts supported types and rejects others', () => {
    expect(validateDocumentFile({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toBeNull();
    expect(validateDocumentFile({ name: 'a.exe', type: 'application/x-msdownload', size: 10 })).toMatch(/not supported/);
    expect(validateDocumentFile({ name: 'a.pdf', type: 'application/pdf', size: 0 })).toMatch(/empty/);
    expect(validateDocumentFile({ name: 'a.pdf', type: 'application/pdf', size: MAX_DOC_BYTES + 1 })).toMatch(/25 MB/);
  });
  it('sanitises file names against traversal', () => {
    expect(safeFileName('../../etc/passwd')).not.toContain('/');
    expect(safeFileName('../../etc/passwd')).not.toMatch(/^\./);
    expect(safeFileName('my report (final).pdf')).toBe('my-report-final.pdf');
    expect(safeFileName('???')).toBe('file');
    expect(safeFileName('a'.repeat(300) + '.pdf').length).toBeLessThanOrEqual(100);
  });
});

describe('sanitizeHtml', () => {
  it('strips scripts, handlers and unsafe URLs', () => {
    const out = sanitizeHtml('<p onclick="x()">Hi</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a><iframe src="//e"></iframe>');
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|iframe|<img/i);
    expect(out).toContain('Hi');
  });
  it('keeps safe formatting and https links', () => {
    expect(sanitizeHtml('<strong>b</strong><a href="https://x.com">x</a>')).toContain('href="https://x.com"');
  });
  it('converts html to plain text with line breaks', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
  });
});

describe('dates', () => {
  it('round-trips local time in a timezone (Lagos is UTC+1)', () => {
    expect(toIso('2026-11-18', '09:30', 'Africa/Lagos')).toBe('2026-11-18T08:30:00.000Z');
    expect(fromIso('2026-11-18T08:30:00.000Z', 'Africa/Lagos')).toEqual({ date: '2026-11-18', time: '09:30' });
  });
  it('handles DST zones', () => {
    expect(toIso('2026-07-01', '12:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z');
    expect(toIso('2026-01-01', '12:00', 'America/New_York')).toBe('2026-01-01T17:00:00.000Z');
  });
  it('labels relative due dates', () => {
    const now = new Date('2026-11-18T10:00:00Z');
    expect(relativeDue('2026-11-18T15:00:00Z', 'UTC', now)).toMatchObject({ overdue: false, label: expect.stringContaining('Today') });
    expect(relativeDue('2026-11-18T08:00:00Z', 'UTC', now).overdue).toBe(true);
    expect(relativeDue('2026-11-19T08:00:00Z', 'UTC', now).label).toContain('Tomorrow');
  });
  it('builds week-start aware grids', () => {
    expect(weekDays('2026-11-18', 1)[0]).toBe('2026-11-16');
    expect(weekDays('2026-11-18', 0)[0]).toBe('2026-11-15');
    const g = monthGrid('2026-11-18', 1);
    expect(g.length % 7).toBe(0);
    expect(g).toContain('2026-11-30');
  });
});

describe('parseSse', () => {
  const stream = (chunks: string[]) => new ReadableStream<Uint8Array>({
    start(c) { for (const s of chunks) c.enqueue(new TextEncoder().encode(s)); c.close(); },
  });
  const collect = async (s: ReadableStream<Uint8Array>) => { const out: unknown[] = []; for await (const e of parseSse(s)) out.push(e); return out; };

  it('parses events split across chunks', async () => {
    const ev = await collect(stream(['event: delta\ndata: {"te', 'xt":"Hi"}\n\nevent: done\ndata: {"ok":true}\n\n']));
    expect(ev).toEqual([{ type: 'delta', text: 'Hi' }, { type: 'done', ok: true }]);
  });
  it('skips malformed frames and keeps going', async () => {
    const ev = await collect(stream(['event: delta\ndata: {bad\n\n', 'event: delta\ndata: {"text":"ok"}\n\n']));
    expect(ev).toEqual([{ type: 'delta', text: 'ok' }]);
  });
});
