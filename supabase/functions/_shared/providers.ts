// Provider-independent chat client. Groq, Gemini and OpenAI all expose the OpenAI chat-completions
// protocol, so one streaming implementation covers them; adding a provider is one config entry.
// API keys are read from Edge Function secrets only and never leave the server.

export type ProviderName = 'groq' | 'gemini' | 'openai';

interface ProviderSpec {
  baseUrl: string;
  keyEnvs: string[];
  modelEnvs: string[];
  defaultModel: string;
}

export const PROVIDERS: Record<ProviderName, ProviderSpec> = {
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnvs: ['GROQ_API_KEY'], modelEnvs: ['GROQ_MODEL', 'GROQ_CHAT_MODEL'], defaultModel: 'llama-3.3-70b-versatile',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnvs: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'], modelEnvs: ['GEMINI_MODEL', 'GEMINI_CHAT_MODEL'], defaultModel: 'gemini-2.0-flash',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    keyEnvs: ['OPENAI_API_KEY'], modelEnvs: ['OPENAI_MODEL'], defaultModel: 'gpt-4o-mini',
  },
};

export interface ProviderConfig {
  name: ProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const MODEL_RE = /^[\w.\-:/]{1,100}$/;

/**
 * Picks the provider: the user's choice if it is configured, else AI_DEFAULT_PROVIDER, else any configured one.
 * Returns null when no key is configured at all (the app then reports "not configured" instead of faking AI).
 */
const firstEnv = (env: (k: string) => string | undefined, keys: string[]) => {
  for (const k of keys) { const v = env(k)?.trim(); if (v) return v; }
  return undefined;
};

/**
 * Every configured provider, best first: the user's choice, then AI_DEFAULT_PROVIDER, then groq, gemini, openai.
 * The caller tries them in order, so one provider being rate-limited or down does not take the assistant offline.
 */
export function resolveProviders(
  env: (k: string) => string | undefined,
  preferred?: string | null,
  preferredModel?: string | null,
): ProviderConfig[] {
  const order: ProviderName[] = [];
  const push = (n: string | null | undefined) => {
    if (n && n in PROVIDERS && !order.includes(n as ProviderName)) order.push(n as ProviderName);
  };
  if (preferred && preferred !== 'default') push(preferred);
  push(env('AI_DEFAULT_PROVIDER'));
  (Object.keys(PROVIDERS) as ProviderName[]).forEach(push);

  const out: ProviderConfig[] = [];
  for (const name of order) {
    const spec = PROVIDERS[name];
    const apiKey = firstEnv(env, spec.keyEnvs);
    if (!apiKey) continue;
    const userModel = preferredModel && MODEL_RE.test(preferredModel) && name === preferred ? preferredModel : null;
    out.push({ name, baseUrl: spec.baseUrl, apiKey, model: userModel ?? firstEnv(env, spec.modelEnvs) ?? spec.defaultModel });
  }
  return out;
}

/** The single best provider, or null when none is configured (the app then says so instead of faking AI). */
export function resolveProvider(
  env: (k: string) => string | undefined,
  preferred?: string | null,
  preferredModel?: string | null,
): ProviderConfig | null {
  return resolveProviders(env, preferred, preferredModel)[0] ?? null;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export interface ToolCall { id: string; name: string; arguments: string }

export type ChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_calls'; calls: ToolCall[] }
  | { type: 'done' };

export class ProviderError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Streams one model turn. Yields text tokens as they arrive and, if requested, the assembled tool calls. */
export async function* streamChat(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  tools: unknown[],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<ChatEvent> {
  const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model, messages, tools, tool_choice: 'auto', stream: true, temperature: 0.3, max_tokens: 1200,
    }),
  });
  if (!res.ok || !res.body) {
    // Provider error bodies can echo request content; keep only the status.
    throw new ProviderError(`Provider responded with ${res.status}`, res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const calls = new Map<number, ToolCall>();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json: { choices?: Array<{ delta?: { content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }> };
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) yield { type: 'token', text: delta.content };
      for (const tc of delta.tool_calls ?? []) {
        const i = tc.index ?? 0;
        const cur = calls.get(i) ?? { id: '', name: '', arguments: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.arguments += tc.function.arguments;
        calls.set(i, cur);
      }
    }
  }
  if (calls.size > 0) {
    yield {
      type: 'tool_calls',
      calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c], n) => ({ ...c, id: c.id || `call_${n}` })),
    };
  }
  yield { type: 'done' };
}
