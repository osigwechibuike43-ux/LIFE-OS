import { useEffect, useState } from 'react';
import { BookMarked, Download, Pencil, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Select, Skeleton, Switch, Textarea } from '@/components/ui';
import { useAppMutation, usePrefs, useTimezone, useUserQuery } from '@/hooks/queries';
import { fmtDateTime } from '@/lib/dates';
import { downloadJson } from '@/lib/download';
import { cn } from '@/lib/utils';
import { fieldErrors, memoryFormSchema } from '@/lib/validation';
import { exportApi, memoryApi, prefsApi } from '@/services/data';
import { MEMORY_CATEGORIES, type Memory, type MemoryCategory } from '@/types/db';

const catLabel = (c: string) => MEMORY_CATEGORIES.find(([k]) => k === c)?.[1] ?? c;

export default function MemoryPage() {
  const tz = useTimezone();
  const prefs = usePrefs();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [debounced, setDebounced] = useState('');
  const [modal, setModal] = useState<{ open: boolean; memory: Memory | null }>({ open: false, memory: null });
  const [toDelete, setToDelete] = useState<Memory | null>(null);
  const [clearAll, setClearAll] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  const q = useUserQuery(['memories', debounced, category], () => memoryApi.list({ search: debounced, category: category || null }));
  const setPref = useAppMutation((p: Parameters<typeof prefsApi.update>[0]) => prefsApi.update(p), { invalidate: ['prefs'] });
  const remove = useAppMutation(memoryApi.remove, { invalidate: ['memories'], success: 'Memory deleted', onSuccess: () => setToDelete(null) });
  const removeAll = useAppMutation(memoryApi.removeAll, { invalidate: ['memories'], success: 'All memories deleted', onSuccess: () => setClearAll(false) });
  const exporting = useAppMutation(exportApi.memories, { onSuccess: (d) => downloadJson(d, 'life-os-memories.json'), success: 'Memories exported' });

  const p = prefs.data;
  const enabled = p?.memory_enabled ?? true;

  return (
    <div>
      <PageHeader title="My Memory" description="Information you choose to keep. Nothing is saved without your say-so."
        actions={<>
          <Button variant="secondary" onClick={() => exporting.mutate(undefined)} loading={exporting.isPending} disabled={!q.data?.length}><Download className="h-4 w-4" />Export</Button>
          <Button onClick={() => setModal({ open: true, memory: null })}><Plus className="h-4 w-4" />Add memory</Button>
        </>} />

      <section className="card mb-5 grid gap-5 p-5 md:grid-cols-2" aria-label="Memory controls">
        <Switch checked={enabled} disabled={!p || setPref.isPending} label="Memory is on" description="When off, the assistant cannot read or save memories. Your existing memories stay until you delete them."
          onChange={(v) => setPref.mutate({ memory_enabled: v, ...(v ? {} : { ai_can_save_memory: false }) })} />
        <Switch checked={enabled && (p?.ai_can_save_memory ?? false)} disabled={!p || !enabled || setPref.isPending} label="Let the assistant propose memories"
          description="It can only suggest. Each memory needs your approval, and secrets like passwords or card numbers are always refused."
          onChange={(v) => setPref.mutate({ ai_can_save_memory: v })} />
        <p className="flex items-start gap-2 text-xs text-muted md:col-span-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />Memories are visible only to you. The assistant never infers private facts and stores them as truth.</p>
      </section>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted" />
          <input className="field pl-10" placeholder="Search memories" aria-label="Search memories" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} /></div>
        <Select aria-label="Category" className="w-auto" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{MEMORY_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      </div>

      <div className="card divide-y divide-line/70 overflow-hidden">
        {q.isLoading ? Array.from({ length: 4 }, (_, i) => <div key={i} className="p-4"><Skeleton className="h-10" /></div>)
          : q.isError ? <ErrorState message="Could not load memories." onRetry={() => q.refetch()} />
          : !q.data?.length ? <EmptyState icon={<BookMarked className="h-6 w-6" />} title={search || category ? 'No memories match' : 'No memories yet'}
              description="Add preferences, goals or important dates. For example: “I prefer studying in the morning.”" action={!search && !category ? <Button onClick={() => setModal({ open: true, memory: null })}><Plus className="h-4 w-4" />Add your first memory</Button> : undefined} />
          : q.data.map((m) => (
            <div key={m.id} className="group flex items-start gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-sm">{m.content}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone="accent">{catLabel(m.category)}</Badge>
                  <span>Saved {fmtDateTime(m.created_at, tz)}</span>
                  {m.source === 'ai_confirmed' && <Badge>Suggested by AI, approved by you</Badge>}
                </div>
              </div>
              <div className={cn('flex shrink-0 gap-1')}>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit memory" onClick={() => setModal({ open: true, memory: m })}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Delete memory" onClick={() => setToDelete(m)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
      </div>
      {!!q.data?.length && <div className="mt-4 text-right"><Button variant="ghost" size="sm" className="text-danger" onClick={() => setClearAll(true)}>Delete all memories</Button></div>}

      <MemoryModal open={modal.open} memory={modal.memory} onClose={() => setModal({ open: false, memory: null })} />
      <ConfirmDialog open={Boolean(toDelete)} title="Delete memory?" message="The assistant will no longer know this." loading={remove.isPending} onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete.id)} />
      <ConfirmDialog open={clearAll} title="Delete all memories?" message="Every memory will be permanently deleted. Export first if you want a copy." confirmLabel="Delete all" loading={removeAll.isPending} onClose={() => setClearAll(false)} onConfirm={() => removeAll.mutate(undefined)} />
    </div>
  );
}

function MemoryModal({ open, memory, onClose }: { open: boolean; memory: Memory | null; onClose: () => void }) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<MemoryCategory>('user_created');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (open) { setErrors({}); setContent(memory?.content ?? ''); setCategory(memory?.category ?? 'user_created'); } }, [open, memory]);
  const save = useAppMutation((v: { content: string; category: MemoryCategory }) => (memory ? memoryApi.update(memory.id, v) : memoryApi.create(v)),
    { invalidate: ['memories'], success: memory ? 'Memory updated' : 'Memory saved', onSuccess: onClose });
  function submit() {
    const parsed = memoryFormSchema.safeParse({ content, category });
    if (!parsed.success) return setErrors(fieldErrors(parsed));
    save.mutate(parsed.data);
  }
  return (
    <Modal open={open} onClose={onClose} title={memory ? 'Edit memory' : 'Add memory'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={save.isPending}>Save</Button></>}>
      <div className="space-y-4">
        <Textarea label="What should be remembered?" value={content} onChange={(e) => setContent(e.target.value)} error={errors.content} maxLength={2000} hint={`${content.length}/2000`} />
        <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value as MemoryCategory)}>{MEMORY_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
      </div>
    </Modal>
  );
}
