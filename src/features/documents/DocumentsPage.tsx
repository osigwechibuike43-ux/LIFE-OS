import { useRef, useState } from 'react';
import { Download, Eye, File, FileImage, FileText, FolderLock, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { Button, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, Select, Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useAppMutation, useEntitlements, useTimezone, useUserQuery } from '@/hooks/queries';
import { fmtDate } from '@/lib/dates';
import { errorMessage, formatBytes } from '@/lib/utils';
import { ALLOWED_DOC_TYPES, safeFileName, validateDocumentFile } from '@/lib/validation';
import { documentApi } from '@/services/data';
import type { DocumentRow } from '@/types/db';

const CATEGORIES = ['general', 'identity', 'education', 'work', 'finance', 'health', 'legal', 'other'];
const label = (c: string) => c[0].toUpperCase() + c.slice(1);
const iconFor = (m: string) => (m.startsWith('image/') ? FileImage : m === 'application/pdf' || m.includes('word') ? FileText : File);
const previewable = (m: string) => m.startsWith('image/') || m === 'application/pdf' || m === 'text/plain';

export default function DocumentsPage() {
  const tz = useTimezone();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [uploadCat, setUploadCat] = useState('general');
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [toDelete, setToDelete] = useState<DocumentRow | null>(null);
  const [rename, setRename] = useState<DocumentRow | null>(null);
  const [preview, setPreview] = useState<{ doc: DocumentRow; url: string } | null>(null);

  const ent = useEntitlements();
  const q = useUserQuery(['documents', search, category], () => documentApi.list({ search, category: category || null }));
  const remove = useAppMutation(documentApi.remove, { invalidate: ['documents'], success: 'Document deleted', onSuccess: () => setToDelete(null) });

  async function upload(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    let ok = 0;
    for (const f of list) {
      const problem = validateDocumentFile(f);
      if (problem) { toast.error(problem); continue; }
      try { await documentApi.upload(f, uploadCat, `${crypto.randomUUID()}-${safeFileName(f.name)}`); ok++; }
      catch (e) { toast.error(`“${f.name}”: ${errorMessage(e)}`); }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
    if (ok) { toast.success(`${ok} ${ok === 1 ? 'document' : 'documents'} uploaded`); void q.refetch(); }
  }

  async function open(doc: DocumentRow, mode: 'view' | 'download') {
    try {
      const url = await documentApi.signedUrl(doc.storage_path, mode === 'download' ? doc.name : undefined);
      if (mode === 'download') { const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; a.click(); }
      else setPreview({ doc, url });
    } catch (e) { toast.error(errorMessage(e)); }
  }

  const limit = ent.data?.limits?.documents;
  return (
    <div>
      <PageHeader title="Documents" description="A private library. Files are never public and open through short-lived links."
        actions={<>
          <Select aria-label="Upload category" className="w-auto" value={uploadCat} onChange={(e) => setUploadCat(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
          <Button onClick={() => fileRef.current?.click()} loading={uploading}><Upload className="h-4 w-4" />Upload</Button>
          <input ref={fileRef} type="file" multiple hidden accept={Object.keys(ALLOWED_DOC_TYPES).join(',')} onChange={(e) => e.target.files && upload(e.target.files)} aria-label="Choose files" />
        </>} />

      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files); }}
        className={`mb-5 flex items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-5 text-sm transition-colors ${drag ? 'border-accent bg-accent/8 text-accent' : 'border-line text-muted'}`}>
        <Upload className="h-4 w-4" />Drop PDF, DOCX, TXT or image files here (max 25 MB each){limit ? ` · ${q.data?.length ?? 0}/${limit} used` : ''}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted" />
          <input className="field pl-10" placeholder="Search by name" aria-label="Search documents" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} /></div>
        <Select aria-label="Filter category" className="w-auto" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
      </div>

      {q.isLoading ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-28" />)}</div>
        : q.isError ? <ErrorState message="Could not load documents." onRetry={() => q.refetch()} />
        : !q.data?.length ? <div className="card"><EmptyState icon={<FolderLock className="h-6 w-6" />} title={search || category ? 'No documents match' : 'Your library is empty'}
            description="Upload important files and keep them organised and private." action={!search && !category ? <Button onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />Upload a document</Button> : undefined} /></div>
        : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {q.data.map((d) => {
              const Icon = iconFor(d.mime_type);
              return (
                <li key={d.id} className="card flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Icon className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" title={d.name}>{d.name}</p>
                      <p className="mt-0.5 text-xs text-muted">{ALLOWED_DOC_TYPES[d.mime_type] ?? 'File'} · {formatBytes(d.size_bytes)} · {label(d.category)}</p>
                      <p className="text-xs text-muted">Uploaded {fmtDate(d.created_at, tz, { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
                  </div>
                  <div className="flex gap-1">
                    {previewable(d.mime_type) && <Button variant="secondary" size="sm" onClick={() => open(d, 'view')}><Eye className="h-3.5 w-3.5" />Preview</Button>}
                    <Button variant="secondary" size="sm" onClick={() => open(d, 'download')}><Download className="h-3.5 w-3.5" />Download</Button>
                    <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" aria-label={`Rename ${d.name}`} onClick={() => setRename(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete ${d.name}`} onClick={() => setToDelete(d)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

      <ConfirmDialog open={Boolean(toDelete)} title="Delete document?" message={`“${toDelete?.name}” and its file will be permanently deleted.`} loading={remove.isPending}
        onClose={() => setToDelete(null)} onConfirm={() => toDelete && remove.mutate(toDelete)} />
      <RenameModal doc={rename} onClose={() => setRename(null)} />
      <Modal open={Boolean(preview)} onClose={() => setPreview(null)} title={preview?.doc.name ?? 'Preview'} wide>
        {preview && (preview.doc.mime_type.startsWith('image/')
          ? <img src={preview.url} alt={preview.doc.name} className="mx-auto max-h-[70vh] rounded-xl" />
          : <iframe src={preview.url} title={preview.doc.name} sandbox="" className="h-[65vh] w-full rounded-xl border border-line bg-white" />)}
      </Modal>
    </div>
  );
}

function RenameModal({ doc, onClose }: { doc: DocumentRow | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [cat, setCat] = useState('general');
  const [seen, setSeen] = useState<string | null>(null);
  if (doc && seen !== doc.id) { setSeen(doc.id); setName(doc.name); setCat(doc.category); }
  const save = useAppMutation(() => documentApi.update(doc!.id, { name: name.trim().slice(0, 255), category: cat }), { invalidate: ['documents'], success: 'Document updated', onSuccess: () => { setSeen(null); onClose(); } });
  return (
    <Modal open={Boolean(doc)} onClose={onClose} title="Edit document" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></>}>
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} error={!name.trim() ? 'Name is required' : undefined} />
        <Select label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</Select>
      </div>
    </Modal>
  );
}
