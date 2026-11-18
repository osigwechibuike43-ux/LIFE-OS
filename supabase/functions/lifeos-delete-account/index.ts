// Erases the signed-in user's LIFE OS data: stored documents first, then every LIFE OS row.
// The Supabase auth account is deliberately NOT deleted: this project's auth is shared with other apps,
// so removing the login would also remove the user's access to them.
// Database erasure runs as the caller (SECURITY DEFINER function bound to auth.uid()); the service role is
// used only to remove that same user's files.
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { bearer, corsHeaders, json } from '../_shared/http.ts';

const Body = z.object({ confirm: z.literal('DELETE') });
const BUCKET = 'lifeos-documents';

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('LIFEOS_ALLOWED_ORIGINS'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ code: 'method_not_allowed' }, 405, cors);

  const token = bearer(req);
  if (!token) return json({ code: 'unauthorized' }, 401, cors);
  if (!Body.safeParse(await req.json().catch(() => null)).success) {
    return json({ code: 'bad_request', message: 'Type DELETE to confirm.' }, 400, cors);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const noSession = { persistSession: false, autoRefreshToken: false };
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: noSession });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ code: 'unauthorized' }, 401, cors);
  const userId = data.user.id;

  // Remove stored files (paged) before the rows that point to them disappear.
  for (;;) {
    const { data: files, error: listError } = await admin.storage.from(BUCKET).list(userId, { limit: 100 });
    if (listError) return json({ code: 'server_error', message: 'Could not remove your documents. Nothing was deleted.' }, 500, cors);
    if (!files?.length) break;
    const { error: rmError } = await admin.storage.from(BUCKET).remove(files.map((f) => `${userId}/${f.name}`));
    if (rmError) return json({ code: 'server_error', message: 'Could not remove your documents. Nothing else was deleted.' }, 500, cors);
  }

  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: noSession,
    db: { schema: 'lifeos' },
  });
  const { error: eraseError } = await asUser.rpc('erase_my_data');
  if (eraseError) return json({ code: 'server_error', message: 'Could not erase your data. Please try again.' }, 500, cors);
  return json({ ok: true }, 200, cors);
});
