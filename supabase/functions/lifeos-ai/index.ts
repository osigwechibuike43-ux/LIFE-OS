// AI assistant endpoint. Streams server-sent events. API keys stay in Edge Function secrets.
//
// POST { message, conversation_id? }            -> SSE stream (meta, token, tool, confirmation, error, done)
// POST { action: "confirm", pending_id, approve } -> JSON result of the user's approval decision
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { buildSystemPrompt, runAgent, runApprovedAction, sanitizeInput, type AgentEvent } from '../_shared/agent.ts';
import { bearer, corsHeaders, json } from '../_shared/http.ts';
import { resolveProviders, type ChatMessage } from '../_shared/providers.ts';
import { createSupabaseStore } from '../_shared/store.ts';
import { safeTimeZone } from '../_shared/time.ts';
import type { ToolContext } from '../_shared/tools.ts';

const Body = z.union([
  z.object({ action: z.literal('confirm'), pending_id: z.string().uuid(), approve: z.boolean() }),
  z.object({ action: z.undefined().optional(), message: z.string().min(1).max(8000), conversation_id: z.string().uuid().optional() }),
]);

Deno.serve(async (req) => {
  const cors = corsHeaders(req, Deno.env.get('LIFEOS_ALLOWED_ORIGINS'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ code: 'method_not_allowed' }, 405, cors);

  const token = bearer(req);
  if (!token) return json({ code: 'unauthorized', message: 'Sign in to use the assistant.' }, 401, cors);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  // User-scoped client: every query runs with the caller's JWT, so Row Level Security applies.
  const db = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'lifeos' },
  });
  const { data: userData, error: authError } = await db.auth.getUser(token);
  if (authError || !userData.user) return json({ code: 'unauthorized', message: 'Your session has expired. Sign in again.' }, 401, cors);
  const userId = userData.user.id;

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return json({ code: 'bad_request', message: 'Invalid request.' }, 400, cors);
  }

  const [{ data: profile }, { data: prefs }, { data: providerSettings }] = await Promise.all([
    db.from('profiles').select('display_name,timezone').eq('id', userId).maybeSingle(),
    db.from('user_preferences').select('memory_enabled,ai_can_save_memory,ai_enabled').eq('user_id', userId).maybeSingle(),
    db.from('ai_provider_settings').select('provider,model').eq('user_id', userId).maybeSingle(),
  ]);
  const timezone = safeTimeZone(profile?.timezone);
  const memoryEnabled = prefs?.memory_enabled ?? true;
  const ctx: ToolContext = {
    store: createSupabaseStore(db, userId),
    timezone,
    now: () => new Date(),
    prefs: { memory_enabled: memoryEnabled, ai_can_save_memory: prefs?.ai_can_save_memory ?? true },
  };

  // ---- Approval path: executes a previously proposed action after the user clicked Approve/Reject ----
  if (body.action === 'confirm') {
    if (!body.approve) {
      const pending = await ctx.store.getPending(body.pending_id);
      if (pending?.status === 'pending') await ctx.store.resolvePending(pending.id, 'rejected');
      return json({ ok: true, rejected: true }, 200, cors);
    }
    const out = await runApprovedAction(ctx, body.pending_id);
    return json(out, out.ok ? 200 : 422, cors);
  }

  // ---- Chat path ----
  if (prefs && prefs.ai_enabled === false) {
    return json({ code: 'ai_disabled', message: 'The assistant is turned off in your AI preferences.' }, 403, cors);
  }
  const providers = resolveProviders((k) => Deno.env.get(k), providerSettings?.provider, providerSettings?.model);
  if (providers.length === 0) {
    return json({
      code: 'ai_not_configured',
      message: 'No AI provider is configured on the server. Set GROQ_API_KEY (or GEMINI_API_KEY / OPENAI_API_KEY) as an Edge Function secret.',
    }, 503, cors);
  }

  const { data: quota, error: quotaError } = await db.rpc('consume_ai_quota');
  if (quotaError) return json({ code: 'server_error', message: 'Could not check your usage limit.' }, 500, cors);
  if (!quota?.allowed) {
    const daily = quota?.reason === 'daily_limit';
    return json({
      code: daily ? 'daily_limit' : 'rate_limited',
      message: daily ? 'You have reached your daily AI message limit for your plan.' : 'You are sending messages too quickly. Wait a moment and try again.',
    }, 429, cors);
  }

  const message = sanitizeInput(body.message);
  if (!message) return json({ code: 'bad_request', message: 'Message is empty.' }, 400, cors);

  // Conversation (ownership enforced by RLS; a foreign id simply returns nothing).
  let conversationId = body.conversation_id ?? null;
  let history: ChatMessage[] = [];
  if (conversationId) {
    const { data: conv } = await db.from('conversations').select('id').eq('id', conversationId).eq('user_id', userId).maybeSingle();
    if (!conv) return json({ code: 'not_found', message: 'Conversation not found.' }, 404, cors);
    const { data: msgs } = await db.from('messages').select('role,content').eq('conversation_id', conversationId)
      .in('role', ['user', 'assistant']).order('created_at', { ascending: false }).limit(16);
    history = (msgs ?? []).reverse().map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  } else {
    const { data: conv, error } = await db.from('conversations')
      .insert({ user_id: userId, title: message.slice(0, 60) }).select('id').single();
    if (error || !conv) return json({ code: 'server_error', message: 'Could not start a conversation.' }, 500, cors);
    conversationId = conv.id;
  }

  const { error: userMsgError } = await db.from('messages')
    .insert({ conversation_id: conversationId, user_id: userId, role: 'user', content: message });
  if (userMsgError) return json({ code: 'server_error', message: 'Could not save your message.' }, 500, cors);

  // Context retrieval: only memories the user kept, and only when memory is enabled.
  let memories: string[] = [];
  if (memoryEnabled) {
    const found = await ctx.store.searchMemories({ limit: 25 });
    memories = found.map((m) => `[${m.category}] ${m.content}`);
  }
  const system = buildSystemPrompt({
    displayName: profile?.display_name ?? null, now: new Date(), timezone,
    memories, memoryEnabled, canSaveMemory: ctx.prefs.ai_can_save_memory,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send('meta', { conversation_id: conversationId });
      try {
      let emitted = false;
      let lastError: unknown = null;
      // Try each configured provider (e.g. Groq, then Gemini). Fail over only if nothing was streamed yet,
      // so a user never sees two different answers stitched together.
      for (const provider of providers) {
        try {
          const result = await runAgent({
            cfg: provider, ctx, system, history, userMessage: message, conversationId,
            signal: req.signal,
            emit: (e: AgentEvent) => {
              emitted = true;
              if (e.type === 'token') send('token', { text: e.text });
              else if (e.type === 'tool') send('tool', e);
              else send('confirmation', e);
            },
          });
          await db.from('messages').insert({
            conversation_id: conversationId, user_id: userId, role: 'assistant', content: result.text,
            metadata: { provider: provider.name, tools: result.tools, pending_action_ids: result.pendingIds },
          });
          await db.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId!);
          send('done', { ok: true });
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          console.error(`provider ${provider.name} failed`, (e as Error)?.message);
          if (emitted || req.signal.aborted) break;
        }
      }
      if (lastError) {
        send('error', { code: 'provider_error', message: 'The AI provider could not complete that request. Please try again.' });
      }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  });
});
