import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre', 'div', 'span'];

/** Sanitizes note HTML before it is stored or rendered. Scripts, handlers, iframes and styles are removed. */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
  });
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(sanitizeHtml(html).replace(/<\/(p|div|h[1-3]|li|blockquote)>/gi, '$&\n'), 'text/html');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
