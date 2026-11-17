// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { executeTool, looksSensitive, toolDefinitions, toInstant, type ToolContext } from '../../supabase/functions/_shared/tools';
import { buildSystemPrompt, runAgent, runApprovedAction, sanitizeInput } from '../../supabase/functions/_shared/agent';
import { resolveProvider, streamChat } from '../../supabase/functions/_shared/providers';
import { createMemoryStore } from './memoryStore';

const NOW = new Date('2026-11-17T11:19:00Z'); // 12:19 in Lagos
function setup(prefs = { memory_enabled: true, ai_can_save_memory: true }) {
  const mem = createMemoryStore();
  const ctx: ToolContext = { store: mem.store, timezone: 'Africa/Lagos', now: () => NOW, prefs };
  return { ...mem, ctx };
}

describe('tool definitions', () => {
  it('exposes exactly the required tools with JSON schemas', () => {
    const names = toolDefinitions().map((t) => t.function.name).sort();
    expect(names).toEqual([
      'complete_task', 'create_note', 'create_reminder', 'create_task', 'generate_daily_plan', 'get_daily_schedule',
      'retrieve_productivity_insights', 'save_memory', 'search_memories', 'search_notes', 'search_reminders',
      'search_tasks', 'update_task',
    ]);
    for (const t of toolDefinitions()) expect(t.function.parameters).toMatchObject({ type: 'object' });
  });

  it('does not expose any raw SQL or user-id parameter', () => {
    const json = JSON.stringify(toolDefinitions());
    expect(json).not.toMatch(/user_id|\bsql\b|query_sql/i);
  });
});

describe('input validation', () => {
  it('rejects unknown tools and bad arguments without touching the store', async () => {
    const { ctx, state } = setup();
    expect((await executeTool(ctx, 'drop_database', {})).ok).toBe(false);
    const bad = await executeTool(ctx, 'create_task', { title: '' });
    expect(bad).toMatchObject({ ok: false, code: 'invalid_args' });
    const badDate = await executeTool(ctx, 'create_task', { title: 'x', due_at: 'tomorrow-ish' });
    expect(badDate).toMatchObject({ ok: false, code: 'invalid_args' });
    expect(state.inserts).toHaveLength(0);
  });

  it('ignores a user_id smuggled into the arguments', async () => {
    const { ctx, state } = setup();
    const r = await executeTool(ctx, 'create_task', { title: 'mine', user_id: 'another-user-id' });
    expect(r.ok).toBe(true);
    expect(JSON.stringify(state.inserts[0].row)).not.toContain('another-user-id');
  });

  it('reads timezone-naive times in the user timezone', () => {
    expect(toInstant('2026-11-18T10:00', 'Africa/Lagos').toISOString()).toBe('2026-11-18T09:00:00.000Z');
    expect(toInstant('2026-11-18T10:00:00+00:00', 'Africa/Lagos').toISOString()).toBe('2026-11-18T10:00:00.000Z');
  });

  it('maps categories by name and logs activity', async () => {
    const { ctx, state } = setup();
    const r = await executeTool(ctx, 'create_task', { title: 'Quarterly report', category: 'work', priority: 'high' });
    expect(r.ok).toBe(true);
    expect(state.tasks[0].category_id).toBe('cat-work');
    expect(state.activity).toContain('ai.create_task');
  });
});

describe('reminders', () => {
  it('rejects a time in the past instead of silently scheduling it', async () => {
    const { ctx, state } = setup();
    const r = await executeTool(ctx, 'create_reminder', { title: 'late', remind_at: '2026-11-16T09:00:00+01:00' });
    expect(r).toMatchObject({ ok: false });
    expect(state.reminders).toHaveLength(0);
  });
});

describe('memory permissions', () => {
  it('blocks reading and saving when memory is turned off', async () => {
    const { ctx } = setup({ memory_enabled: false, ai_can_save_memory: true });
    expect(await executeTool(ctx, 'search_memories', {})).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await executeTool(ctx, 'save_memory', { content: 'I prefer mornings' })).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('blocks saving when the user has not allowed the assistant to save', async () => {
    const { ctx, state } = setup({ memory_enabled: true, ai_can_save_memory: false });
    expect(await executeTool(ctx, 'save_memory', { content: 'I prefer mornings' })).toMatchObject({ ok: false, code: 'forbidden' });
    expect(state.memories).toHaveLength(0);
  });

  it('refuses to store secrets and identifiers', async () => {
    const { ctx, state } = setup();
    expect(looksSensitive('my card is 4111 1111 1111 1111')).toBe(true);
    expect(looksSensitive('my password is hunter2')).toBe(true);
    expect(looksSensitive('I prefer studying in the morning')).toBe(false);
    const r = await executeTool(ctx, 'save_memory', { content: 'my bvn is 22222222222' });
    expect(r.ok).toBe(false);
    expect(state.memories).toHaveLength(0);
  });
});

describe('daily plan proposals', () => {
  it('rejects references to items that do not exist', async () => {
    const { ctx, state } = setup();
    const r = await executeTool(ctx, 'generate_daily_plan', {
      items: [{ title: 'Ghost', kind: 'task', ref_id: '11111111-1111-4111-8111-111111111111' }],
    });
    expect(r.ok).toBe(false);
    expect(state.plans).toHaveLength(0);
  });

  it('saves only a proposal and never overwrites an approved plan', async () => {
    const { ctx, state } = setup();
    const ok = await executeTool(ctx, 'generate_daily_plan', { items: [{ title: 'Deep work', start: '09:00', end: '11:00', kind: 'focus' }] });
    expect(ok.ok).toBe(true);
    expect(state.plans[0].status).toBe('proposed');
    state.plans[0].status = 'approved';
    const again = await executeTool(ctx, 'generate_daily_plan', { items: [{ title: 'Other', kind: 'task' }] });
    expect(again.ok).toBe(false);
    expect(state.plans[0].items[0].title).toBe('Deep work');
  });

  it('rejects an item that ends before it starts', async () => {
    const { ctx } = setup();
    const r = await executeTool(ctx, 'generate_daily_plan', { items: [{ title: 'Bad', start: '11:00', end: '09:00', kind: 'focus' }] });
    expect(r.ok).toBe(false);
  });
});

describe('insights tool', () => {
  it('returns only computed numbers (no placeholders) when there is no data', async () => {
    const { ctx } = setup();
    const r = await executeTool(ctx, 'retrieve_productivity_insights', {});
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as { completion_rate_last_7_days_percent: number | null }).completion_rate_last_7_days_percent).toBeNull();
  });
});

// --- model streaming helpers --------------------------------------------------------------
function sse(...events: unknown[]): Response {
  const body = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
  return new Response(new ReadableStream({
    start(c) {
      // Deliver in awkward 7-byte chunks to exercise buffering.
      const bytes = new TextEncoder().encode(body);
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  }), { status: 200 });
}
const cfg = { name: 'groq' as const, baseUrl: 'https://x', apiKey: 'k', model: 'm' };

describe('provider layer', () => {
  it('reports not-configured when no key exists (no fake AI)', () => {
    expect(resolveProvider(() => undefined)).toBeNull();
  });

  it('prefers the user choice when configured, ignoring unsafe model names', () => {
    const env = (k: string) => ({ GROQ_API_KEY: 'a', GEMINI_API_KEY: 'b' } as Record<string, string>)[k];
    expect(resolveProvider(env, 'gemini')?.name).toBe('gemini');
    expect(resolveProvider(env, 'openai')?.name).toBe('groq'); // openai not configured -> fall back
    expect(resolveProvider(env, 'gemini', 'evil model; rm -rf')?.model).toBe('gemini-2.0-flash');
    expect(resolveProvider(env, 'gemini', 'gemini-2.5-pro')?.model).toBe('gemini-2.5-pro');
  });

  it('streams tokens and assembles tool calls split across chunks', async () => {
    const fetchImpl = (async () => sse(
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'create_task', arguments: '{"title":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Buy milk"}' } }] } }] },
      '[DONE]',
    )) as unknown as typeof fetch;
    const out: string[] = [];
    let calls: unknown;
    for await (const e of streamChat(cfg, [], [], undefined, fetchImpl)) {
      if (e.type === 'token') out.push(e.text);
      if (e.type === 'tool_calls') calls = e.calls;
    }
    expect(out.join('')).toBe('Hello');
    expect(calls).toEqual([{ id: 'c1', name: 'create_task', arguments: '{"title":"Buy milk"}' }]);
  });

  it('does not leak provider error bodies', async () => {
    const fetchImpl = (async () => new Response('secret echo of prompt', { status: 500 })) as unknown as typeof fetch;
    await expect((async () => { for await (const _ of streamChat(cfg, [], [], undefined, fetchImpl)) { /* drain */ } })())
      .rejects.toThrow(/500/);
  });
});

describe('agent pipeline', () => {
  /** A scripted model: first turn asks for a tool, second turn gives the final text. */
  function scripted(toolName: string, args: unknown, finalText: string) {
    let call = 0;
    return (async () => {
      call++;
      if (call === 1) {
        return sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: toolName, arguments: JSON.stringify(args) } }] } }] }, '[DONE]');
      }
      return sse({ choices: [{ delta: { content: finalText } }] }, '[DONE]');
    }) as unknown as typeof fetch;
  }

  it('creates reminders only after approval: the proposal writes nothing', async () => {
    const { ctx, state } = setup();
    const events: string[] = [];
    const result = await runAgent({
      cfg, ctx, system: 's', history: [], userMessage: 'remind me', conversationId: null,
      emit: (e) => events.push(e.type),
      fetchImpl: scripted('create_reminder', { title: 'Meeting', remind_at: '2026-11-18T10:00:00+01:00' }, 'Waiting for your approval.'),
    });
    expect(events).toContain('confirmation');
    expect(result.pendingIds).toHaveLength(1);
    expect(state.reminders).toHaveLength(0); // not scheduled yet

    const done = await runApprovedAction(ctx, result.pendingIds[0]);
    expect(done.ok).toBe(true);
    expect(state.reminders).toHaveLength(1);
    expect(state.reminders[0].remind_at).toBe('2026-11-18T09:00:00.000Z');

    const twice = await runApprovedAction(ctx, result.pendingIds[0]); // no double execution
    expect(twice.ok).toBe(false);
    expect(state.reminders).toHaveLength(1);
  });

  it('executes safe tools immediately and reports them', async () => {
    const { ctx, state } = setup();
    const result = await runAgent({
      cfg, ctx, system: 's', history: [], userMessage: 'add a task', conversationId: null, emit: () => undefined,
      fetchImpl: scripted('create_task', { title: 'Call mum' }, 'Added.'),
    });
    expect(state.tasks.map((t) => t.title)).toEqual(['Call mum']);
    expect(result.tools[0]).toMatchObject({ name: 'create_task', ok: true });
    expect(result.text).toBe('Added.');
  });

  it('never queues an action that would fail permission checks', async () => {
    const { ctx, state } = setup({ memory_enabled: false, ai_can_save_memory: false });
    const events: string[] = [];
    await runAgent({
      cfg, ctx, system: 's', history: [], userMessage: 'remember x', conversationId: null, emit: (e) => events.push(e.type),
      fetchImpl: scripted('save_memory', { content: 'x' }, 'I cannot save memories.'),
    });
    expect(events).not.toContain('confirmation');
    expect(state.pending).toHaveLength(0);
  });

  it('rejects approval of an expired action', async () => {
    const { ctx, state } = setup();
    state.pending.push({ id: 'p1', tool: 'create_reminder', args: {}, summary: 's', status: 'pending', expires_at: '2026-01-01T00:00:00Z' });
    const r = await runApprovedAction(ctx, 'p1');
    expect(r).toMatchObject({ ok: false });
    expect(state.pending[0].status).toBe('expired');
  });

  it('re-validates arguments on approval (approval is not a bypass)', async () => {
    const { ctx, state } = setup({ memory_enabled: false, ai_can_save_memory: false });
    state.pending.push({ id: 'p2', tool: 'save_memory', args: { content: 'x', category: 'preferences' }, summary: 's', status: 'pending', expires_at: '2027-01-01T00:00:00Z' });
    const r = await runApprovedAction(ctx, 'p2');
    expect(r.ok).toBe(false);
    expect(state.memories).toHaveLength(0);
  });
});

describe('prompt and input handling', () => {
  it('strips control characters and caps length', () => {
    expect(sanitizeInput('  hi\u0000 there  ')).toBe('hi there');
    expect(sanitizeInput('a'.repeat(5000))).toHaveLength(4000);
  });

  it('omits memories entirely when memory is off', () => {
    const p = buildSystemPrompt({ displayName: 'Ada', now: NOW, timezone: 'Africa/Lagos', memories: ['[preferences] likes tea'], memoryEnabled: false, canSaveMemory: true });
    expect(p).not.toContain('likes tea');
    expect(p).toContain('turned memory OFF');
    expect(p).toContain('2026-11-17T12:19:00+01:00');
  });
});
