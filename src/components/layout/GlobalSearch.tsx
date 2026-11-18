import { useEffect, useRef, useState } from 'react';
import { CheckSquare, FileText, FolderLock, BookMarked, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { documentApi, memoryApi, noteApi, taskApi } from '@/services/data';
import { Spinner } from '@/components/ui';

export function GlobalSearchButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Search"
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-muted hover:bg-surface-2 sm:w-64 sm:justify-start sm:gap-2 sm:px-3.5">
        <Search className="h-4 w-4" />
        <span className="hidden flex-1 text-left text-sm sm:block">Search everything</span>
        <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-[10px] sm:block">⌘K</kbd>
      </button>
      <SearchDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const nav = useNavigate();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { if (!open) setQ(''); }, [open]);

  const res = useQuery({
    queryKey: [user?.id, 'search', debounced],
    enabled: open && debounced.length >= 2,
    queryFn: async () => {
      const [tasks, notes, memories, docs] = await Promise.all([
        taskApi.list({ status: 'all', search: debounced }), noteApi.list({ search: debounced }),
        memoryApi.list({ search: debounced }), documentApi.list({ search: debounced }),
      ]);
      return { tasks: tasks.rows.slice(0, 5), notes: notes.rows.slice(0, 5), memories: memories.slice(0, 5), docs: docs.slice(0, 5) };
    },
  });

  const go = (to: string) => { onClose(); nav(to); };
  const d = res.data;
  const empty = d && !d.tasks.length && !d.notes.length && !d.memories.length && !d.docs.length;

  return (
    <Modal open={open} onClose={onClose} title="Search">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted" />
        <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks, notes, memories, documents…" className="field pl-10" aria-label="Search query" maxLength={100} />
      </div>
      <div className="mt-4 min-h-[120px]">
        {debounced.length < 2 ? <p className="py-8 text-center text-sm text-muted">Type at least 2 characters.</p>
          : res.isFetching && !d ? <div className="flex justify-center py-8"><Spinner /></div>
          : res.isError ? <p className="py-8 text-center text-sm text-danger">Search failed. Try again.</p>
          : empty ? <p className="py-8 text-center text-sm text-muted">No results for “{debounced}”.</p>
          : d && (
            <div className="space-y-4">
              <Group title="Tasks" icon={CheckSquare} items={d.tasks.map((t) => ({ id: t.id, label: t.title, to: '/app/tasks' }))} go={go} />
              <Group title="Notes" icon={FileText} items={d.notes.map((n) => ({ id: n.id, label: n.title || 'Untitled', to: `/app/notes?open=${n.id}` }))} go={go} />
              <Group title="Memories" icon={BookMarked} items={d.memories.map((m) => ({ id: m.id, label: m.content, to: '/app/memory' }))} go={go} />
              <Group title="Documents" icon={FolderLock} items={d.docs.map((x) => ({ id: x.id, label: x.name, to: '/app/documents' }))} go={go} />
            </div>
          )}
      </div>
    </Modal>
  );
}

function Group({ title, icon: Icon, items, go }: { title: string; icon: typeof Search; items: Array<{ id: string; label: string; to: string }>; go: (to: string) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {items.map((i) => (
        <button key={i.id} onClick={() => go(i.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2">
          <Icon className="h-4 w-4 shrink-0 text-muted" /><span className="truncate">{i.label}</span>
        </button>
      ))}
    </div>
  );
}
