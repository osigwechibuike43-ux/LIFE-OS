// Client for the ai-agent Edge Function. The browser never sees a model API key.
import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

export type AiStreamEvent =
  | { type: 'meta'; conversation_id: string }
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; ok: boolean; summary: string; error?: string }
  | { type: 'confirmation'; id: string; tool: string; summary: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' };

export class AiError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new AiError('Your session has expired. Sign in again.', 'unauthorized');
  return { authorization: `Bearer ${data.session.access_token}`, apikey: env.supabaseAnonKey, 'content-type': 'application/json' };
}
const endpoint = () => `${env.supabaseUrl}/functions/v1/lifeos-ai`;

/** Parses an SSE byte stream into typed events. Exported for testing. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<AiStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        yield { type: event, ...JSON.parse(data) } as AiStreamEvent;
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

export async function* streamMessage(message: string, conversationId: string | null, signal?: AbortSignal): AsyncGenerator<AiStreamEvent> {
  let res: Response;
  try {
    res = await fetch(endpoint(), {
      method: 'POST', signal, headers: await authHeader(),
      body: JSON.stringify({ message, conversation_id: conversationId ?? undefined }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AiError('Could not reach the assistant. Check your connection.', 'network');
  }
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => null) as { code?: string; message?: string } | null;
    throw new AiError(j?.message ?? 'The assistant is unavailable right now.', j?.code ?? 'server_error');
  }
  yield* parseSse(res.body);
}

export async function decideAction(pendingId: string, approve: boolean): Promise<{ ok: boolean; rejected?: boolean; error?: string; summary?: string }> {
  const res = await fetch(endpoint(), {
    method: 'POST', headers: await authHeader(),
    body: JSON.stringify({ action: 'confirm', pending_id: pendingId, approve }),
  });
  const j = await res.json().catch(() => ({ ok: false, error: 'Unexpected response' }));
  return j;
}
