// Permanently deletes the signed-in user: stored documents first, then the auth user.
// Every personal table cascades from auth.users, so all rows are erased with it (NDPA / GDPR erasure).
// The service-role key is used ONLY here, on the server, and ONLY for the verified caller's own id.
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { bearer, corsHeaders, json } from '../_shared/http.ts';

const Body = z.object({ confirm: z.literal('DELETE') });

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('ALLOWED_ORIGINS'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ code: 'method_not_allowed' }, 405, cors);

  const token = bearer(req);
  if (!token) return json({ code: 'unauthorized' }, 401, cors);
  if (!Body.safeParse(await req.json().catch(() => null)).success) {
    return json({ code: 'bad_request', message: 'Type DELETE to confirm.' }, 400, cors);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return json({ code: 'unauthorized' }, 401, cors);
  const userId = data.user.id;

  // Remove stored files (paged) before the user row disappears.
  for (;;) {
    const { data: files, error: listError } = await admin.storage.from('documents').list(userId, { limit: 100 });
    if (listError) return json({ code: 'server_error', message: 'Could not remove your documents. Nothing was deleted.' }, 500, cors);
    if (!files?.length) break;
    const { error: rmError } = await admin.storage.from('documents').remove(files.map((f) => `${userId}/${f.name}`));
    if (rmError) return json({ code: 'server_error', message: 'Could not remove your documents. Nothing else was deleted.' }, 500, cors);
  }

  const { error: delError } = await admin.auth.admin.deleteUser(userId);
  if (delError) return json({ code: 'server_error', message: 'Could not delete the account. Please try again.' }, 500, cors);
  return json({ ok: true }, 200, cors);
});
