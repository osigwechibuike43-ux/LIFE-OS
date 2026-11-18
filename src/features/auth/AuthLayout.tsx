import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/Logo';

/** Split-screen auth layout: brand + product preview on the left (desktop), form on the right. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-[#101116] p-12 text-[#F5F5F7] lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(60% 50% at 85% 0%, rgba(245,181,68,.28), transparent 60%), radial-gradient(50% 45% at 0% 100%, rgba(129,122,255,.28), transparent 60%)' }} />
        <Link to="/" className="relative"><Logo /></Link>
        <div className="relative max-w-md">
          <h2 className="font-display text-4xl font-light leading-tight">Your life, <span className="font-semibold">working together.</span></h2>
          <p className="mt-4 text-[#A0A4B2]">Tasks, notes, memory and planning in one calm place, with an assistant that works with your real data.</p>
          <ul className="mt-8 space-y-3 text-sm">
            {['You decide what the assistant remembers', 'Reminders that actually fire, or tell you why not', 'Private by design with Row Level Security'].map((t) => (
              <li key={t} className="flex items-center gap-2.5 text-[#D6D8E0]"><CheckCircle2 className="h-4 w-4 text-[#F5B544]" />{t}</li>
            ))}
          </ul>
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/[.04] p-4">
            <div className="flex items-center justify-between text-xs text-[#A0A4B2]"><span>Daily Timeline</span><span>3 tasks</span></div>
            {[['Plan weekly routine', '#817AFF'], ['Review project materials', '#34D399'], ['Call with client', '#F472B6']].map(([t, c], i) => (
              <div key={t} className="mt-2.5 flex items-center gap-3 rounded-full bg-white/[.06] px-3.5 py-2 text-sm" style={{ marginLeft: i * 28 }}>
                <span className="h-2 w-2 rounded-full" style={{ background: c }} />{t}
              </div>
            ))}
            <p className="mt-3 text-[11px] text-[#7d8194]">Illustrative preview</p>
          </div>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-[#7d8194]"><ShieldCheck className="h-4 w-4" />Encrypted in transit. Your data stays yours.</p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="mb-8 lg:hidden"><Link to="/"><Logo /></Link></div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </div>
        <p className="mt-8 text-center text-xs text-muted">
          <Link to="/terms" className="underline-offset-2 hover:underline">Terms</Link> · <Link to="/privacy" className="underline-offset-2 hover:underline">Privacy</Link>
        </p>
      </main>
    </div>
  );
}

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.4 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.4a12 12 0 0 0 0 10.8l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
    </svg>
  );
}
