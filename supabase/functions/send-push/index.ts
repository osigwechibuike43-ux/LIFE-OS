// Delivers web push for notifications that have not been pushed yet. Call it every minute with the CRON_SECRET.
// Only users who enabled push AND granted browser permission have a row in push_subscriptions.
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { bearer, json, safeEqual } from '../_shared/http.ts';

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  const token = bearer(req);
  if (!secret || !token || !safeEqual(token, secret)) return json({ code: 'unauthorized' }, 401, {});

  const pub = Deno.env.get('VAPID_PUBLIC_KEY');
  const priv = Deno.env.get('VAPID_PRIVATE_KEY');
  const subject = Deno.env.get('VAPID_SUBJECT');
  if (!pub || !priv || !subject) {
    return json({ code: 'push_not_configured', message: 'Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.' }, 503, {});
  }
  webpush.setVapidDetails(subject, pub, priv);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: notes, error } = await db.from('notifications')
    .select('id,user_id,title,body,link').is('push_sent_at', null).is('read_at', null)
    .gte('created_at', new Date(Date.now() - 6 * 3600_000).toISOString()).order('created_at').limit(200);
  if (error) return json({ ok: false }, 500, {});

  let sent = 0;
  let removed = 0;
  for (const n of notes ?? []) {
    const { data: prefs } = await db.from('user_preferences').select('notifications_push').eq('user_id', n.user_id).maybeSingle();
    if (prefs?.notifications_push) {
      const { data: subs } = await db.from('push_subscriptions').select('id,endpoint,p256dh,auth_key').eq('user_id', n.user_id);
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } },
            JSON.stringify({ title: n.title, body: n.body ?? '', url: n.link ?? '/app' }),
          );
          sent++;
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await db.from('push_subscriptions').delete().eq('id', s.id); // subscription expired
            removed++;
          }
        }
      }
    }
    await db.from('notifications').update({ push_sent_at: new Date().toISOString() }).eq('id', n.id);
  }
  return json({ ok: true, sent, removed_stale: removed }, 200, {});
});
