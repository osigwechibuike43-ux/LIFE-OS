import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Bell, BookMarked, Bot, CalendarDays, Check, ChevronDown, FolderLock, KeyRound, LineChart, Lock, Menu, Moon, ShieldCheck, Sun, Trash2, Workflow, X } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

const fade = { initial: { opacity: 0, y: 18 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: 0.5, ease: 'easeOut' } } as const;

const NAV = [['Product', '#product'], ['Features', '#features'], ['How it works', '#how'], ['Pricing', '#pricing']] as const;

export default function LandingPage() {
  const { user } = useAuth();
  const { resolved, setPref } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link to="/" aria-label="LIFE OS home"><Logo /></Link>
          <nav aria-label="Primary" className="ml-6 hidden gap-6 md:flex">{NAV.map(([l, h]) => <a key={l} href={h} className="text-sm text-muted transition-colors hover:text-fg">{l}</a>)}</nav>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setPref(resolved === 'dark' ? 'light' : 'dark')} aria-label="Toggle theme" className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2">{resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</button>
            {user ? <Link to="/app"><Button size="sm">Open app</Button></Link> : <>
              <Link to="/login" className="hidden sm:block"><Button size="sm" variant="ghost">Sign in</Button></Link>
              <Link to="/signup"><Button size="sm">Get started</Button></Link></>}
            <button onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} className="flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-surface-2 md:hidden">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
          </div>
        </div>
        {open && <nav aria-label="Mobile" className="border-t border-line px-5 py-3 md:hidden">{NAV.map(([l, h]) => <a key={l} href={h} onClick={() => setOpen(false)} className="block py-2.5 text-sm">{l}</a>)}<Link to="/login" className="block py-2.5 text-sm">Sign in</Link></nav>}
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(55% 45% at 80% 0%, rgb(var(--amber) / .16), transparent 70%), radial-gradient(45% 40% at 10% 10%, rgb(var(--accent) / .16), transparent 70%)' }} />
          <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 text-center sm:pt-24">
            <motion.p {...fade} className="mx-auto inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs text-muted"><span className="h-1.5 w-1.5 rounded-full bg-amber" />Personal operating system · Free to start</motion.p>
            <motion.h1 {...fade} className="mx-auto mt-6 max-w-3xl font-display text-5xl font-light leading-[1.05] tracking-tight sm:text-7xl">Your life, <span className="font-semibold">working together.</span></motion.h1>
            <motion.p {...fade} className="mx-auto mt-6 max-w-xl text-base text-muted sm:text-lg">Meet your personal operating system. Organize your responsibilities, remember what matters and manage everyday life with intelligent assistance.</motion.p>
            <motion.div {...fade} className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <Link to="/signup"><Button size="lg">Get started free<ArrowRight className="h-4 w-4" /></Button></Link>
              <a href="#product"><Button size="lg" variant="secondary">Explore LIFE OS</Button></a>
            </motion.div>
            <motion.div {...fade} className="mt-16"><ProductPreview /></motion.div>
          </div>
        </section>

        {/* Product value */}
        <section id="product" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <motion.div {...fade} className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-wider text-accent">Product</p>
            <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">Fewer apps. Fewer steps. Fewer decisions.</h2>
            <p className="mt-4 text-muted">Tasks, reminders, calendar, notes, documents and an assistant that actually works with them, instead of seven tabs you have to keep in sync.</p>
          </motion.div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            <Pillar icon={<Bot />} title="Personal intelligence" body="Say “remind me about my 10 AM meeting tomorrow”. The assistant works out the time, asks if unsure, and creates the reminder only after you approve. It reads your real schedule, never a canned one." />
            <Pillar icon={<BookMarked />} title="Memory you control" body="Keep preferences, goals and important dates. Turn memory off any time, export it, delete it. The assistant never saves anything silently and refuses to store secrets." />
            <Pillar icon={<Workflow />} title="Reliable automation" body="“Prepare my plan every morning.” “Warn me three days before a deadline.” Scheduled workflows with a full execution history so you always know what ran." />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 border-y border-line bg-surface/50">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <motion.h2 {...fade} className="max-w-2xl text-3xl font-semibold sm:text-4xl">Everything in one calm workspace</motion.h2>
            <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {[
                [Bell, 'Smart reminders', 'One-off or recurring, in-app and web push where your browser allows it.'],
                [CalendarDays, 'Calendar & planner', 'Day, week and month views. Draft a daily plan from your real tasks, edit it, approve it.'],
                [BookMarked, 'Notes', 'Rich text, tags, favourites, search and automatic saving.'],
                [FolderLock, 'Private documents', 'PDFs, DOCX, text and images in private storage, opened through short-lived links.'],
                [LineChart, 'Honest insights', 'Streaks, completion rate, focus time. Every number is computed from your records, never invented.'],
                [Bot, 'Voice & chat', 'Talk or type. Streaming answers, conversation history, and clear approval cards.'],
              ].map(([Icon, t, b]) => {
                const I = Icon as typeof Bell;
                return <div key={t as string} className="bg-bg p-6"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"><I className="h-5 w-5" /></div><h3 className="mt-4 text-sm font-semibold">{t as string}</h3><p className="mt-1.5 text-sm text-muted">{b as string}</p></div>;
              })}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <motion.h2 {...fade} className="max-w-xl text-3xl font-semibold sm:text-4xl">How it works</motion.h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {[['Tell it what you need', 'Type or speak naturally, or use the forms. Both write to the same place.'], ['Review before it happens', 'Reminders, edits and memories wait for your approval. Nothing consequential runs on its own.'], ['See it all together', 'Your dashboard, calendar and insights update from the same real data.']].map(([t, b], i) => (
              <motion.li key={t} {...fade} transition={{ ...fade.transition, delay: i * 0.08 }} className="relative border-l border-line pl-6"><span className="absolute -left-[13px] top-0 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg">{i + 1}</span><h3 className="font-semibold">{t}</h3><p className="mt-2 text-sm text-muted">{b}</p></motion.li>
            ))}
          </ol>
        </section>

        {/* Privacy */}
        <section id="privacy" className="border-y border-line bg-[#101116] text-[#F5F5F7]">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[1fr_1.1fr]">
            <motion.div {...fade}><p className="text-xs font-medium uppercase tracking-wider text-[#817AFF]">Privacy & security</p>
              <h2 className="mt-3 text-3xl font-semibold sm:text-4xl">Built to be trusted with your life.</h2>
              <p className="mt-4 text-[#A0A4B2]">Personal information is private by default. We designed the product with data-protection requirements in mind, including the Nigeria Data Protection Act and international privacy law.</p></motion.div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {[[ShieldCheck, 'Row Level Security', 'The database itself blocks access to anyone else’s records.'], [KeyRound, 'Keys stay on the server', 'AI provider keys never reach your browser.'], [Lock, 'Private files', 'Documents are never public and open via short-lived links.'], [Trash2, 'Export & erase', 'Download everything, or delete your account and data.']].map(([Icon, t, b]) => {
                const I = Icon as typeof Lock;
                return <li key={t as string} className="rounded-2xl border border-white/10 bg-white/[.03] p-5"><I className="h-5 w-5 text-[#F5B544]" /><h3 className="mt-3 text-sm font-semibold">{t as string}</h3><p className="mt-1 text-sm text-[#A0A4B2]">{b as string}</p></li>;
              })}
            </ul>
          </div>
        </section>

        <Pricing />
        <Faq />

        <section className="mx-auto max-w-4xl px-5 pb-24 text-center">
          <motion.div {...fade} className="rounded-3xl border border-line bg-surface p-10 shadow-soft sm:p-14">
            <h2 className="text-3xl font-semibold sm:text-4xl">Start organising your life today.</h2>
            <p className="mx-auto mt-3 max-w-md text-muted">Free to start. Set up takes about a minute.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3"><Link to="/signup"><Button size="lg">Get started free</Button></Link><Link to="/login"><Button size="lg" variant="secondary">Sign in</Button></Link></div>
          </motion.div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-muted">
          <Logo />
          <p>Your life. Organized. Understood. Connected.</p>
          <nav aria-label="Footer" className="flex gap-5"><Link to="/privacy" className="hover:text-fg">Privacy</Link><Link to="/terms" className="hover:text-fg">Terms</Link><a href="#pricing" className="hover:text-fg">Pricing</a></nav>
        </div>
      </footer>
    </div>
  );
}

function Pillar({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return <motion.div {...fade} className="card p-6"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent [&>svg]:h-5 [&>svg]:w-5">{icon}</div><h3 className="mt-5 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted">{body}</p></motion.div>;
}

/** A static, clearly labelled illustration of the dashboard. */
function ProductPreview() {
  const bars = [60, 46, 22, 70, 34, 88, 40, 26, 74];
  return (
    <div className="mx-auto max-w-5xl rounded-[28px] border border-line bg-[#101116] p-3 text-left text-[#F5F5F7] shadow-pop sm:p-5" role="img" aria-label="Illustration of the LIFE OS dashboard">
      <div className="rounded-3xl bg-[#14161d] p-4 sm:p-6">
        <div className="flex items-end justify-between"><div><p className="text-xs text-[#A0A4B2]">Your daily plan</p><p className="mt-1 font-display text-2xl font-light sm:text-3xl">Stay on <b className="font-semibold">track today</b></p></div><span className="hidden rounded-full bg-[#817AFF] px-4 py-1.5 text-xs font-medium text-[#101116] sm:block">Add task</span></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_1.6fr]">
          <div className="relative h-32 overflow-hidden rounded-2xl border border-white/10 p-4" style={{ background: 'radial-gradient(120% 90% at 85% 0%, rgba(245,181,68,.55), transparent 55%), #1b1e27' }}><p className="text-xs">Deep work time</p><p className="absolute bottom-3 font-display text-3xl font-light">1h 25m</p></div>
          <div className="relative h-32 overflow-hidden rounded-2xl border border-white/10 p-4" style={{ background: 'radial-gradient(90% 70% at 80% 0%, rgba(129,122,255,.3), transparent 60%), #1b1e27' }}><p className="text-xs">Task completion</p><p className="absolute bottom-3 font-display text-4xl font-light">88%</p></div>
          <div className="hidden h-32 rounded-2xl border border-white/10 bg-[#1b1e27] p-4 sm:block"><p className="text-xs">Productivity rhythm</p><div className="mt-3 flex h-16 items-end gap-2">{bars.map((h, i) => <span key={i} className="flex-1 rounded-md" style={{ height: `${h}%`, background: i === 5 ? '#F5B544' : 'rgba(129,122,255,.45)' }} />)}</div></div>
        </div>
        <div className="mt-3 rounded-2xl border border-white/10 bg-[#1b1e27] p-4">
          <p className="text-xs text-[#A0A4B2]">Daily timeline</p>
          <div className="mt-3 space-y-2">{[['Plan weekly routine', 'Low', '#817AFF', 0], ['Review project materials', 'Important', '#34D399', 22], ['Call with client', 'High', '#F472B6', 48]].map(([t, p, c, ml]) => (
            <div key={t as string} className="flex w-fit max-w-full items-center gap-3 rounded-full bg-white/[.06] px-3.5 py-2 text-xs" style={{ marginLeft: `${ml}%` }}><span className="truncate">{t as string}</span><span className="flex items-center gap-1.5 rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-[#A0A4B2]"><span className="h-1.5 w-1.5 rounded-full" style={{ background: c as string }} />{p as string}</span></div>))}</div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-[#7d8194]">Illustrative preview. In the app, every figure comes from your own data.</p>
    </div>
  );
}

const PLANS = [
  { name: 'Free', price: '$0', note: 'forever', features: ['Personal dashboard', 'Tasks & notes', 'Basic reminders', 'Limited AI usage'], cta: 'Get started free', primary: true },
  { name: 'Pro', price: 'Soon', note: 'not yet available', features: ['Advanced AI assistant', 'Expanded memory', 'Advanced planning', 'More automations'] },
  { name: 'Premium', price: 'Soon', note: 'not yet available', features: ['Higher AI usage', 'Advanced automation', 'Extended storage', 'Advanced intelligence'] },
  { name: 'Business', price: 'Soon', note: 'planned', features: ['Shared workspaces', 'Team collaboration', 'Organizational tools', 'Admin features'] },
];

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
      <motion.div {...fade} className="max-w-2xl"><p className="text-xs font-medium uppercase tracking-wider text-accent">Pricing</p><h2 className="mt-3 text-3xl font-semibold sm:text-4xl">Start free. Grow when you need to.</h2>
        <p className="mt-3 text-muted">Paid plans are on the roadmap and billing is not live yet. Everyone starts on Free.</p></motion.div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((p) => (
          <motion.div key={p.name} {...fade} className={cn('card flex flex-col p-6', p.primary && 'border-accent/60 ring-1 ring-accent/30')}>
            <h3 className="text-sm font-semibold">{p.name}</h3><p className="mt-3 font-display text-3xl font-light">{p.price}</p><p className="text-xs text-muted">{p.note}</p>
            <ul className="mt-5 flex-1 space-y-2.5 text-sm">{p.features.map((f) => <li key={f} className="flex items-center gap-2"><Check className="h-4 w-4 shrink-0 text-accent" />{f}</li>)}</ul>
            {p.cta ? <Link to="/signup" className="mt-6"><Button className="w-full">{p.cta}</Button></Link> : <Button variant="secondary" className="mt-6 w-full" disabled>Coming later</Button>}
          </motion.div>
        ))}
      </div>
    </section>
  );
}

const FAQS = [
  ['Does the assistant change things without asking?', 'No. Reminders, task edits, completions and memories are shown to you as approval cards first. The assistant cannot send messages, spend money, delete data or reach external accounts.'],
  ['What does the assistant remember?', 'Only what you ask it to remember and then approve, plus anything you add yourself in My Memory. You can turn memory off, export it or delete it at any time. It never stores passwords, card numbers or ID numbers.'],
  ['Is my data private?', 'Yes. Database Row Level Security restricts every record to its owner, documents live in private storage, and AI provider keys never leave the server.'],
  ['Do reminders work when the app is closed?', 'Reminders always appear in your in-app notifications. Web push, where your browser supports it and you grant permission, can also reach you when the app is closed.'],
  ['What happens to my data if I leave?', 'You can export everything as JSON and delete your account from Settings. Deletion removes your records and uploaded files.'],
  ['Is it free?', 'Yes, the Free plan costs nothing. Paid plans are planned but billing is not available yet.'],
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 pb-20">
      <motion.h2 {...fade} className="text-3xl font-semibold sm:text-4xl">Questions, answered</motion.h2>
      <div className="mt-8 divide-y divide-line border-y border-line">
        {FAQS.map(([q, a], i) => (
          <div key={q}><h3><button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-medium">{q}<ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open === i && 'rotate-180')} /></button></h3>
            {open === i && <p className="pb-5 text-sm leading-6 text-muted">{a}</p>}</div>
        ))}
      </div>
    </section>
  );
}
