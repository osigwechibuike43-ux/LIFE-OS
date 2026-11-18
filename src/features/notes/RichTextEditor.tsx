import { useEffect, useRef } from 'react';
import { Bold, Code, Heading1, Heading2, Italic, Link2, List, ListOrdered, Quote, Underline } from 'lucide-react';
import { sanitizeHtml } from '@/lib/sanitize';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

interface Props { html: string; onChange: (html: string) => void; placeholder?: string }

/** Minimal rich-text editor on contentEditable. All output is sanitized (DOMPurify) before it leaves the component. */
export function RichTextEditor({ html, onChange, placeholder = 'Start writing…' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Initial content only; the DOM is the source of truth while typing.
  useEffect(() => { if (ref.current) ref.current.innerHTML = sanitizeHtml(html); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const emit = () => { if (ref.current) onChange(sanitizeHtml(ref.current.innerHTML)); };
  const exec = (cmd: string, value?: string) => { ref.current?.focus(); document.execCommand(cmd, false, value); emit(); };

  const link = () => {
    const url = window.prompt('Link address (https://…)');
    if (!url) return;
    if (!/^https?:\/\//i.test(url.trim())) return toast.error('Links must start with http:// or https://');
    exec('createLink', url.trim());
  };

  const tools: Array<{ icon: typeof Bold; label: string; run: () => void }> = [
    { icon: Bold, label: 'Bold', run: () => exec('bold') },
    { icon: Italic, label: 'Italic', run: () => exec('italic') },
    { icon: Underline, label: 'Underline', run: () => exec('underline') },
    { icon: Heading1, label: 'Heading 1', run: () => exec('formatBlock', 'h1') },
    { icon: Heading2, label: 'Heading 2', run: () => exec('formatBlock', 'h2') },
    { icon: List, label: 'Bulleted list', run: () => exec('insertUnorderedList') },
    { icon: ListOrdered, label: 'Numbered list', run: () => exec('insertOrderedList') },
    { icon: Quote, label: 'Quote', run: () => exec('formatBlock', 'blockquote') },
    { icon: Code, label: 'Code block', run: () => exec('formatBlock', 'pre') },
    { icon: Link2, label: 'Link', run: link },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="toolbar" aria-label="Formatting" className="mb-3 flex flex-wrap gap-0.5 rounded-xl border border-line bg-surface-2/60 p-1">
        {tools.map((t) => (
          <button key={t.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={t.run} aria-label={t.label} title={t.label}
            className={cn('flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg')}>
            <t.icon className="h-4 w-4" />
          </button>
        ))}
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label="Note content" data-placeholder={placeholder}
        onInput={emit}
        onPaste={(e) => { // paste as plain text to avoid importing foreign styles
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        className="rich-text min-h-[240px] flex-1 overflow-y-auto rounded-xl focus:outline-none" />
    </div>
  );
}
