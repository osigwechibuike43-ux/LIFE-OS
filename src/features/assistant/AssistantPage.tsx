import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Bot, Check, Loader2, Menu, MessageSquarePlus, Mic, MicOff, Square, Trash2, Wrench, X } from 'lucide-react';
import { Button, ConfirmDialog, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useProfile, useUserQuery } from '@/hooks/queries';
import { cn, errorMessage } from '@/lib/utils';
import { AiError, decideAction, streamMessage } from '@/services/ai';
import { conversationApi } from '@/services/data';
import type { Conversation, Message } from '@/types/db';

interface Confirmation { id: string; summary: string; status: 'pending' | 'approved' | 'rejected' | 'expired' | 'failed' | 'working'; error?: string }
interface ToolChip { name: string; ok: boolean; summary: string; error?: string }
interface ChatMsg { key: string; role: 'user' | 'assistant'; content: string; streaming?: boolean; tools: ToolChip[]; confirmations: Confirmation[]; error?: string }

const SUGGESTIONS = [
  'What do I have planned for today?', 'Help me organize my week.', 'Remind me about my meeting tomorrow at 10 AM.',
  'Remember that I prefer studying in the morning.', 'How productive was I this week?', 'Create a task to renew my passport by Friday.',
];

type SpeechRec = { start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null; interimResults: boolean; lang: string; continuous: boolean };
const getSpeech = (): (new () => SpeechRec) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export default function AssistantPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const profile = useProfile();
  const [params, setParams] = useSearchParams();
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingConv, setLoadingConv] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [toDelete, setToDelete] = useState<Conversation | null>(null);
  const [listening, setListening] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const speechOk = Boolean(getSpeech());

  const convs = useUserQuery(['conversations'], conversationApi.list);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);
  useEffect(() => () => { abortRef.current?.abort(); recRef.current?.stop(); }, []);
  useEffect(() => { const el = taRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; } }, [input]);

  const refreshAppData = useCallback(() => {
    // Assistant actions may have changed any of these; refresh everything except the chat itself.
    void qc.invalidateQueries({ predicate: (q) => !['conversations'].includes(String(q.queryKey[1])) });
  }, [qc]);

  const loadConversation = useCallback(async (id: string) => {
    setLoadingConv(true); setConvId(id); setDrawer(false);
    try {
      const rows: Message[] = await conversationApi.messages(id);
      const ids = rows.flatMap((m) => m.metadata?.pending_action_ids ?? []);
      const pend = await conversationApi.pending(ids).catch(() => []);
      const byId = new Map(pend.map((p) => [p.id, p]));
      setMsgs(rows.map((m) => ({
        key: m.id, role: m.role as 'user' | 'assistant', content: m.content, tools: m.metadata?.tools?.map((t) => ({ ...t })) ?? [],
        confirmations: (m.metadata?.pending_action_ids ?? []).flatMap((pid) => { const p = byId.get(pid); return p ? [{ id: p.id, summary: p.summary, status: p.status }] : []; }),
      })));
    } catch (e) { toast.error(errorMessage(e)); } finally { setLoadingConv(false); }
  }, [toast]);

  const newChat = useCallback(() => { abortRef.current?.abort(); setConvId(null); setMsgs([]); setBusy(false); setDrawer(false); taRef.current?.focus(); }, []);

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    const aKey = crypto.randomUUID();
    setMsgs((m) => [...m, { key: crypto.randomUUID(), role: 'user', content: message, tools: [], confirmations: [] }, { key: aKey, role: 'assistant', content: '', streaming: true, tools: [], confirmations: [] }]);
    setBusy(true);
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const patch = (fn: (m: ChatMsg) => ChatMsg) => setMsgs((list) => list.map((m) => (m.key === aKey ? fn(m) : m)));
    try {
      for await (const ev of streamMessage(message, convId, ctrl.signal)) {
        if (ev.type === 'meta') setConvId(ev.conversation_id);
        else if (ev.type === 'token') patch((m) => ({ ...m, content: m.content + ev.text }));
        else if (ev.type === 'tool') { patch((m) => ({ ...m, tools: [...m.tools, { name: ev.name, ok: ev.ok, summary: ev.summary, error: ev.error }] })); if (ev.ok) refreshAppData(); }
        else if (ev.type === 'confirmation') patch((m) => ({ ...m, confirmations: [...m.confirmations, { id: ev.id, summary: ev.summary, status: 'pending' }] }));
        else if (ev.type === 'error') patch((m) => ({ ...m, error: ev.message }));
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') patch((m) => ({ ...m, error: e instanceof AiError ? e.message : errorMessage(e) }));
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      setBusy(false);
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === 'conversations' });
    }
  }, [busy, convId, qc, refreshAppData]);

  // Prompt handed over from the dashboard / companion panel.
  const handled = useRef(false);
  useEffect(() => {
    const p = params.get('prompt');
    if (p && !handled.current) { handled.current = true; setParams({}, { replace: true }); void send(p.slice(0, 4000)); }
  }, [params, setParams, send]);

  async function decide(msgKey: string, c: Confirmation, approve: boolean) {
    const set = (status: Confirmation['status'], error?: string) => setMsgs((l) => l.map((m) => (m.key === msgKey ? { ...m, confirmations: m.confirmations.map((x) => (x.id === c.id ? { ...x, status, error } : x)) } : m)));
    set('working');
    try {
      const r = await decideAction(c.id, approve);
      if (r.rejected) return set('rejected');
      if (r.ok) { set('approved'); refreshAppData(); } else set('failed', r.error ?? 'Could not complete that action.');
    } catch (e) { set('failed', errorMessage(e)); }
  }

  function toggleVoice() {
    if (listening) { recRef.current?.stop(); return; }
    const Rec = getSpeech();
    if (!Rec) return toast.info('Voice input is not supported in this browser.');
    const r = new Rec(); r.lang = navigator.language || 'en-US'; r.interimResults = false; r.continuous = false;
    r.onresult = (e) => { const t = e.results[0]?.[0]?.transcript; if (t) setInput((v) => (v ? v + ' ' : '') + t); };
    r.onerror = () => { toast.error('Could not use the microphone. Check browser permissions.'); setListening(false); };
    r.onend = () => setListening(false);
    recRef.current = r; setListening(true);
    try { r.start(); } catch { setListening(false); }
  }

  const deleteConv = async () => {
    if (!toDelete) return;
    try { await conversationApi.remove(toDelete.id); if (toDelete.id === convId) newChat(); void convs.refetch(); setToDelete(null); toast.success('Conversation deleted'); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  const name = (profile.data?.display_name ?? '').split(' ')[0];
  const history = (
    <div className="flex h-full flex-col">
      <div className="p-3"><Button variant="secondary" className="w-full" onClick={newChat}><MessageSquarePlus className="h-4 w-4" />New conversation</Button></div>
      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {convs.isLoading ? <Skeleton className="mx-1 h-9" /> : !convs.data?.length ? <p className="px-3 py-6 text-center text-xs text-muted">No conversations yet.</p>
          : convs.data.map((c) => (
            <div key={c.id} className={cn('group flex items-center rounded-xl', c.id === convId ? 'bg-accent/12' : 'hover:bg-surface-2')}>
              <button onClick={() => void loadConversation(c.id)} className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm" aria-current={c.id === convId}>{c.title}</button>
              <button onClick={() => setToDelete(c)} aria-label={`Delete conversation ${c.title}`} className="mr-1 rounded-lg p-1.5 text-muted opacity-100 hover:text-danger sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          ))}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-4rem)] pb-16 lg:pb-0">
      <aside className="hidden w-64 shrink-0 border-r border-line lg:block" aria-label="Conversations">{history}</aside>
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden"><div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface"><div className="flex justify-end p-2"><button aria-label="Close" onClick={() => setDrawer(false)} className="p-2"><X className="h-5 w-5" /></button></div>{history}</aside></div>
      )}

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Chat">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 lg:hidden">
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Conversations" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></Button>
          <span className="text-sm font-medium">Assistant</span>
          <Button variant="ghost" size="icon" className="ml-auto h-9 w-9" aria-label="New conversation" onClick={newChat}><MessageSquarePlus className="h-5 w-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8" aria-live="polite">
          <div className="mx-auto max-w-3xl space-y-6">
            {loadingConv ? <><Skeleton className="h-16" /><Skeleton className="ml-auto h-10 w-2/3" /></>
              : msgs.length === 0 ? (
                <div className="flex flex-col items-center pt-10 text-center sm:pt-20">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/12 text-accent"><Bot className="h-7 w-7" /></div>
                  <h1 className="mt-5 font-display text-2xl font-semibold sm:text-3xl">{name ? `Hi ${name}, what can I help with?` : 'What can I help with?'}</h1>
                  <p className="mt-2 max-w-md text-sm text-muted">I work with your real tasks, reminders, notes and memory. I ask before changing anything important.</p>
                  <div className="mt-8 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
                    {SUGGESTIONS.map((s) => <button key={s} onClick={() => void send(s)} className="rounded-xl border border-line bg-surface px-4 py-3 text-left text-sm transition-colors hover:border-accent/50 hover:bg-surface-2">{s}</button>)}
                  </div>
                </div>
              ) : msgs.map((m) => <Bubble key={m.key} m={m} onDecide={(c, a) => void decide(m.key, c, a)} />)}
            <div ref={endRef} />
          </div>
        </div>

        <form onSubmit={(e: FormEvent) => { e.preventDefault(); void send(input); }} className="border-t border-line bg-bg px-4 py-3 sm:px-8">
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-soft focus-within:border-accent/60">
            <textarea ref={taRef} value={input} rows={1} maxLength={4000} aria-label="Message" placeholder={listening ? 'Listening…' : 'Message your assistant'} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm placeholder:text-muted/70 focus:outline-none" />
            {speechOk && <Button type="button" variant={listening ? 'primary' : 'ghost'} size="icon" className="h-10 w-10" aria-pressed={listening} aria-label={listening ? 'Stop voice input' : 'Start voice input'} onClick={toggleVoice}>{listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</Button>}
            {busy ? <Button type="button" size="icon" className="h-10 w-10" aria-label="Stop generating" onClick={() => abortRef.current?.abort()}><Square className="h-4 w-4 fill-current" /></Button>
              : <Button type="submit" size="icon" className="h-10 w-10" disabled={!input.trim()} aria-label="Send message"><ArrowUp className="h-4 w-4" /></Button>}
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted">The assistant can make mistakes. Changes to reminders, tasks and memory need your approval.</p>
        </form>
      </section>

      <ConfirmDialog open={Boolean(toDelete)} title="Delete conversation?" message="This conversation and its messages will be permanently deleted." onClose={() => setToDelete(null)} onConfirm={() => void deleteConv()} />
    </div>
  );
}

function Bubble({ m, onDecide }: { m: ChatMsg; onDecide: (c: Confirmation, approve: boolean) => void }) {
  if (m.role === 'user') return <div className="flex justify-end"><div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-fg">{m.content}</div></div>;
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent"><Bot className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1 space-y-3">
        {m.tools.length > 0 && <div className="flex flex-wrap gap-1.5">{m.tools.map((t, i) => (
          <span key={i} title={t.error} className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]', t.ok ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger')}>
            {t.ok ? <Check className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}{t.ok ? t.summary : `${t.name.replace(/_/g, ' ')} failed`}</span>))}</div>}
        {m.content ? (
          <div className="prose-chat text-sm leading-7">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              a: (p) => <a {...p} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline" />,
              p: (p) => <p className="my-2 first:mt-0 last:mb-0" {...p} />,
              ul: (p) => <ul className="my-2 list-disc pl-5" {...p} />, ol: (p) => <ol className="my-2 list-decimal pl-5" {...p} />,
              code: ({ className, children, ...p }) => (className ? <code className={cn('font-mono text-xs', className)} {...p}>{children}</code> : <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]" {...p}>{children}</code>),
              pre: (p) => <pre className="my-3 overflow-x-auto rounded-xl bg-surface-2 p-3" {...p} />,
              table: (p) => <div className="my-3 overflow-x-auto"><table className="w-full text-xs" {...p} /></div>, th: (p) => <th className="border-b border-line px-2 py-1 text-left" {...p} />, td: (p) => <td className="border-b border-line/50 px-2 py-1" {...p} />,
            }}>{m.content}</ReactMarkdown>
          </div>
        ) : m.streaming && !m.error ? <span className="inline-flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />Thinking…</span> : null}
        {m.streaming && m.content && <span className="inline-block h-4 w-1.5 animate-blink rounded-sm bg-accent align-middle" aria-hidden />}
        {m.confirmations.map((c) => (
          <div key={c.id} className="rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{c.status === 'pending' || c.status === 'working' ? 'Needs your approval' : c.status === 'approved' ? 'Done' : c.status === 'rejected' ? 'Declined' : c.status === 'expired' ? 'Expired' : 'Could not complete'}</p>
            <p className="mt-1 text-sm font-medium">{c.summary}</p>
            {c.error && <p role="alert" className="mt-1 text-xs text-danger">{c.error}</p>}
            {(c.status === 'pending' || c.status === 'working') && (
              <div className="mt-3 flex gap-2"><Button size="sm" loading={c.status === 'working'} onClick={() => onDecide(c, true)}>Approve</Button><Button size="sm" variant="secondary" disabled={c.status === 'working'} onClick={() => onDecide(c, false)}>Decline</Button></div>
            )}
          </div>
        ))}
        {m.error && <p role="alert" className="rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger">{m.error}</p>}
      </div>
    </div>
  );
}
