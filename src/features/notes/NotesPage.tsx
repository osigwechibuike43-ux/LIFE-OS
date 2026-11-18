import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, FileText, Loader2, Plus, Search, Star, Tag, Trash2, X } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, ErrorState, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useAppMutation, useNoteCategories, useTimezone } from '@/hooks/queries';
import { fmtDateTime } from '@/lib/dates';
import { htmlToText } from '@/lib/sanitize';
import { cn, errorMessage } from '@/lib/utils';
import { noteApi, type NoteFilter } from '@/services/data';
import type { Note } from '@/types/db';
import { RichTextEditor } from './RichTextEditor';

export default function NotesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const cats = useNoteCategories();
  const [filter, setFilter] = useState<Omit<NoteFilter, 'page'>>({ search: '', categoryId: null, favorites: false, tag: null });
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(params.get('open'));

  useEffect(() => { const t = setTimeout(() => setFilter((f) => ({ ...f, search })), 300); return () => clearTimeout(t); }, [search]);

  const list = useInfiniteQuery({
    queryKey: [user?.id, 'notes', 'list', filter], enabled: Boolean(user), initialPageParam: 0,
    queryFn: ({ pageParam }) => noteApi.list({ ...filter, page: pageParam }),
    getNextPageParam: (last, all) => (last.hasMore ? all.length : undefined),
  });
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? [];

  const create = useAppMutation(() => noteApi.create({ title: '', content: '', content_text: '', tags: [], category_id: filter.categoryId ?? null }),
    { invalidate: ['notes'], onSuccess: (n) => setOpenId(n.id) });

  useEffect(() => {
    if (params.get('new') === '1') { create.mutate(undefined); const p = new URLSearchParams(params); p.delete('new'); setParams(p, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const refreshList = useCallback(() => void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === 'notes' }), [qc]);
  const allTags = Array.from(new Set(rows.flatMap((n) => n.tags))).slice(0, 12);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold sm:text-3xl">Notes</h1><p className="mt-1 text-sm text-muted">Capture ideas. Everything saves automatically.</p></div>
        <Button onClick={() => create.mutate(undefined)} loading={create.isPending}><Plus className="h-4 w-4" />New note</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* List column (hidden on mobile while editing) */}
        <section className={cn('min-w-0', openId && 'hidden lg:block')} aria-label="Notes list">
          <div className="mb-3 space-y-2">
            <div className="relative"><Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted" />
              <input className="field pl-10" placeholder="Search notes" aria-label="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} /></div>
            <div className="flex gap-2">
              <Select aria-label="Category" value={filter.categoryId ?? ''} onChange={(e) => setFilter((f) => ({ ...f, categoryId: e.target.value || null }))}>
                <option value="">All categories</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Button variant={filter.favorites ? 'primary' : 'secondary'} size="icon" aria-pressed={filter.favorites} aria-label="Favourites only" onClick={() => setFilter((f) => ({ ...f, favorites: !f.favorites }))}><Star className="h-4 w-4" /></Button>
            </div>
            {allTags.length > 0 && <div className="flex flex-wrap gap-1.5">{allTags.map((t) => (
              <button key={t} onClick={() => setFilter((f) => ({ ...f, tag: f.tag === t ? null : t }))} aria-pressed={filter.tag === t}
                className={cn('rounded-full px-2.5 py-1 text-xs', filter.tag === t ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted hover:text-fg')}>#{t}</button>))}</div>}
          </div>
          <div className="card divide-y divide-line/70 overflow-hidden">
            {list.isLoading ? Array.from({ length: 4 }, (_, i) => <div key={i} className="p-4"><Skeleton className="h-12" /></div>)
              : list.isError ? <ErrorState message="Could not load notes." onRetry={() => list.refetch()} />
              : rows.length === 0 ? <EmptyState icon={<FileText className="h-6 w-6" />} title={filter.search || filter.tag || filter.favorites || filter.categoryId ? 'No matching notes' : 'No notes yet'}
                  description={filter.search ? 'Try different words.' : 'Write down an idea, a plan or anything you want to keep.'}
                  action={!filter.search ? <Button onClick={() => create.mutate(undefined)}><Plus className="h-4 w-4" />New note</Button> : undefined} />
              : rows.map((n) => <NoteRow key={n.id} note={n} active={n.id === openId} onOpen={() => setOpenId(n.id)} />)}
          </div>
          {list.hasNextPage && <div className="mt-3 flex justify-center"><Button variant="secondary" size="sm" loading={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>Load more</Button></div>}
        </section>

        {/* Editor column */}
        <section className={cn('min-w-0', !openId && 'hidden lg:block')} aria-label="Note editor">
          {openId
            ? <NoteEditor key={openId} id={openId} onBack={() => setOpenId(null)} onSaved={refreshList} onDeleted={() => { setOpenId(null); refreshList(); toast.success('Note deleted'); }} />
            : <div className="card hidden h-full min-h-[420px] items-center justify-center lg:flex"><EmptyState icon={<FileText className="h-6 w-6" />} title="Select a note" description="Pick a note from the list or start a new one." /></div>}
        </section>
      </div>
    </div>
  );
}

function NoteRow({ note, active, onOpen }: { note: Note; active: boolean; onOpen: () => void }) {
  const tz = useTimezone();
  return (
    <button onClick={onOpen} aria-current={active} className={cn('block w-full px-4 py-3 text-left transition-colors hover:bg-surface-2', active && 'bg-accent/8')}>
      <div className="flex items-center gap-2">
        {note.is_favorite && <Star className="h-3.5 w-3.5 shrink-0 fill-amber text-amber" aria-label="Favourite" />}
        <p className="truncate text-sm font-medium">{note.title || 'Untitled'}</p>
      </div>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted">{note.content_text || 'Empty note'}</p>
      <p className="mt-1.5 text-[11px] text-muted">{fmtDateTime(note.updated_at, tz)}{note.tags.length > 0 && ` · ${note.tags.map((t) => '#' + t).join(' ')}`}</p>
    </button>
  );
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

function NoteEditor({ id, onBack, onSaved, onDeleted }: { id: string; onBack: () => void; onSaved: () => void; onDeleted: () => void }) {
  const cats = useNoteCategories();
  const toast = useToast();
  const q = useQuery({ queryKey: ['note', id], queryFn: async () => (await noteApi.list({ page: 0 })).rows.find((n) => n.id === id) ?? (await fetchOne(id)), staleTime: 0, gcTime: 0 });

  if (q.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (q.isError || !q.data) return <ErrorState message={q.isError ? errorMessage(q.error) : 'This note no longer exists.'} onRetry={q.isError ? () => q.refetch() : onBack} />;
  return <EditorBody note={q.data} cats={cats.data ?? []} onBack={onBack} onSaved={onSaved} onDeleted={onDeleted} onError={(m) => toast.error(m)} />;
}

async function fetchOne(id: string): Promise<Note> {
  const { supabase } = await import('@/lib/supabase');
  const { data, error } = await supabase.from('notes').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data as Note;
}

function EditorBody({ note, cats, onBack, onSaved, onDeleted, onError }: {
  note: Note; cats: Array<{ id: string; name: string }>; onBack: () => void; onSaved: () => void; onDeleted: () => void; onError: (m: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [html, setHtml] = useState(note.content);
  const [tags, setTags] = useState(note.tags);
  const [categoryId, setCategoryId] = useState(note.category_id ?? '');
  const [favorite, setFavorite] = useState(note.is_favorite);
  const [tagInput, setTagInput] = useState('');
  const [state, setState] = useState<SaveState>('saved');
  const [confirm, setConfirm] = useState(false);
  const draft = useRef({ title, html, tags, categoryId, favorite });
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const tz = useTimezone();

  const flush = useCallback(async () => {
    if (!dirty.current) return;
    const d = draft.current;
    dirty.current = false;
    if (alive.current) setState('saving');
    try {
      await noteApi.update(note.id, { title: d.title.slice(0, 300), content: d.html, content_text: htmlToText(d.html).slice(0, 100000), tags: d.tags, category_id: d.categoryId || null, is_favorite: d.favorite });
      if (alive.current) setState(dirty.current ? 'dirty' : 'saved');
      onSaved();
    } catch (e) {
      dirty.current = true;
      if (alive.current) setState('error');
      onError(`Could not save your note. ${errorMessage(e)}`);
    }
  }, [note.id, onSaved, onError]);

  const touch = useCallback((patch: Partial<typeof draft.current>) => {
    draft.current = { ...draft.current, ...patch };
    dirty.current = true;
    setState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  }, [flush]);

  // Flush pending edits when leaving the note or the page.
  useEffect(() => {
    alive.current = true;
    const before = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => { alive.current = false; clearTimeout(timer.current); window.removeEventListener('beforeunload', before); void flush(); };
  }, [flush]);

  const remove = useAppMutation(() => noteApi.remove(note.id), { onSuccess: () => { dirty.current = false; onDeleted(); } });

  function addTag() {
    const t = tagInput.trim().toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 30);
    setTagInput('');
    if (!t || tags.includes(t)) return;
    if (tags.length >= 20) return onError('A note can have at most 20 tags.');
    const next = [...tags, t]; setTags(next); touch({ tags: next });
  }

  return (
    <div className="card flex min-h-[520px] flex-col p-4 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-9 w-9 lg:hidden" onClick={onBack} aria-label="Back to notes"><ArrowLeft className="h-4 w-4" /></Button>
        <span className={cn('inline-flex items-center gap-1.5 text-xs', state === 'error' ? 'text-danger' : 'text-muted')} role="status">
          {state === 'saving' ? <><Loader2 className="h-3 w-3 animate-spin" />Saving…</> : state === 'saved' ? <><Check className="h-3 w-3" />Saved</> : state === 'error' ? 'Not saved. Retrying on next edit' : 'Unsaved changes'}
        </span>
        <span className="hidden text-xs text-muted sm:inline">· Edited {fmtDateTime(note.updated_at, tz)}</span>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-pressed={favorite} aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'} onClick={() => { setFavorite(!favorite); touch({ favorite: !favorite }); }}>
            <Star className={cn('h-4 w-4', favorite && 'fill-amber text-amber')} /></Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Delete note" onClick={() => setConfirm(true)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>

      <input value={title} onChange={(e) => { setTitle(e.target.value); touch({ title: e.target.value }); }} maxLength={300} placeholder="Untitled" aria-label="Note title"
        className="mb-3 w-full bg-transparent font-display text-2xl font-semibold placeholder:text-muted/50 focus:outline-none" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select aria-label="Category" className="h-8 w-auto py-0 text-xs" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); touch({ categoryId: e.target.value }); }}>
          <option value="">No category</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs">#{t}
            <button aria-label={`Remove tag ${t}`} onClick={() => { const n = tags.filter((x) => x !== t); setTags(n); touch({ tags: n }); }}><X className="h-3 w-3" /></button></span>
        ))}
        <div className="relative"><Tag className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted" />
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } }} onBlur={addTag}
            placeholder="Add tag" aria-label="Add tag" className="field h-8 w-28 py-0 pl-8 text-xs" maxLength={30} /></div>
      </div>

      <RichTextEditor html={note.content} onChange={(h) => { setHtml(h); touch({ html: h }); }} />
      <ConfirmDialog open={confirm} title="Delete note?" message="This note will be permanently deleted." loading={remove.isPending} onClose={() => setConfirm(false)} onConfirm={() => remove.mutate(undefined)} />
    </div>
  );
}
