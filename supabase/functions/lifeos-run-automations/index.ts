// Scheduler fallback. If pg_cron is not available on your plan, call this function every minute
// (Supabase Scheduled Functions, GitHub Actions, cron-job.org, ...) with `Authorization: Bearer <LIFEOS_CRON_SECRET>`.
// It runs the same SQL routines pg_cron would. Normal users can never call those routines directly.
import { createClient } from '@supabase/supabase-js';
import { bearer, json, safeEqual } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('LIFEOS_CRON_SECRET');
  const token = bearer(req);
  if (!secret || !token || !safeEqual(token, secret)) return json({ code: 'unauthorized' }, 401, {});

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'lifeos' },
  });
  const reminders = await db.rpc('process_due_reminders');
  const automations = await db.rpc('run_automations');
  if (reminders.error || automations.error) {
    console.error('run-automations failed', reminders.error?.message, automations.error?.message);
    return json({ ok: false }, 500, {});
  }
  return json({ ok: true, reminders: reminders.data, automations: automations.data }, 200, {});
});
