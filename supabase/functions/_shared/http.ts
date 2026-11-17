// CORS + small HTTP helpers for Edge Functions.

export function corsHeaders(req: Request, allowed: string | undefined): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const list = (allowed ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = list.includes('*') ? '*' : list.includes(origin) ? origin : list[0] ?? '';
  return {
    'access-control-allow-origin': ok,
    'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    vary: 'origin',
  };
}

export function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json' } });
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization');
  return h?.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null;
}

/** Constant-time string compare for shared secrets. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
