import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().min(1, 'Enter your email').email('Enter a valid email address').max(254);

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[a-z]/, 'Add a lowercase letter')
  .regex(/[A-Z]/, 'Add an uppercase letter')
  .regex(/\d/, 'Add a number');

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Enter your password') });
export const signupSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your name').max(80),
    email: emailSchema,
    password: passwordSchema,
    accept: z.literal(true, { errorMap: () => ({ message: 'Please accept the Terms and Privacy Policy' }) }),
  });
export const resetSchema = z.object({ email: emailSchema });
export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export const prioritySchema = z.enum(['low', 'medium', 'high']);

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title').max(300),
  description: z.string().max(5000).optional(),
  priority: prioritySchema,
  category_id: z.string().uuid().nullable(),
  date: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Invalid date'),
  time: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, 'Invalid time'),
  recurrence: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly']),
});

export const reminderFormSchema = z.object({
  title: z.string().trim().min(1, 'Give the reminder a title').max(300),
  description: z.string().max(2000).optional(),
  priority: prioritySchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a time'),
  recurrence: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly']),
});

export const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Give the event a title').max(300),
    description: z.string().max(5000).optional(),
    location: z.string().max(300).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a start time'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose an end time'),
    all_day: z.boolean(),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  })
  .refine((v) => v.all_day || v.end > v.start, { path: ['end'], message: 'End must be after start' });

export const memoryFormSchema = z.object({
  content: z.string().trim().min(1, 'Write something to remember').max(2000, 'Keep it under 2000 characters'),
  category: z.enum(['preferences', 'important_info', 'goals', 'work_education', 'projects', 'important_dates', 'user_created']),
});

export const automationFormSchema = z.object({
  name: z.string().trim().min(1, 'Name your automation').max(120),
  trigger_type: z.enum(['daily', 'weekly', 'before_deadline']),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose a time'),
  weekday: z.number().int().min(1).max(7),
  days_before: z.number().int().min(1).max(30),
  action_type: z.enum(['notify', 'weekly_summary', 'daily_plan', 'deadline_alert']),
  title: z.string().max(120).optional(),
  body: z.string().max(500).optional(),
  weekdays_only: z.boolean(),
  only_if_open_tasks: z.boolean(),
});

export const ALLOWED_DOC_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/plain': 'TXT',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
};
export const MAX_DOC_BYTES = 25 * 1024 * 1024;

export function validateDocumentFile(f: { name: string; type: string; size: number }): string | null {
  if (!ALLOWED_DOC_TYPES[f.type]) return `“${f.name}” is not supported. Use PDF, DOCX, TXT or an image.`;
  if (f.size === 0) return `“${f.name}” is empty.`;
  if (f.size > MAX_DOC_BYTES) return `“${f.name}” is larger than 25 MB.`;
  return null;
}

export function safeFileName(name: string): string {
  const clean = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/\.{2,}/g, '.').replace(/^\.+/, '');
  return (clean || 'file').slice(-100);
}

/** First field error as { field: message } for inline form display. */
export function fieldErrors<T>(r: z.SafeParseReturnType<unknown, T>): Record<string, string> {
  if (r.success) return {};
  const out: Record<string, string> = {};
  for (const i of r.error.issues) out[String(i.path[0] ?? 'form')] ??= i.message;
  return out;
}
