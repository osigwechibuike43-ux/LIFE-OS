import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, LogOut, Menu, Moon, Sun, X } from 'lucide-react';
import { motion } from 'framer-motion';
import { Logo, LogoMark } from '@/components/Logo';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Skeleton } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useProfile } from '@/hooks/queries';
import { useTheme } from '@/hooks/useTheme';
import { cn, initials } from '@/lib/utils';
import { CompanionPanel } from './CompanionPanel';
import { GlobalSearchButton } from './GlobalSearch';
import { MOBILE_TABS, NAV } from './nav';
import { NotificationsMenu } from './NotificationsMenu';

const COLLAPSE_KEY = 'lifeos-sidebar';

function useCollapsed(): [boolean, () => void] {
  const [c, setC] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } });
  const toggle = () => setC((v) => { try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); } catch { /* ignore */ } return !v; });
  return [c, toggle];
}

export function AppShell() {
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const isAssistant = pathname.startsWith('/app/assistant');

  useEffect(() => { setDrawer(false); mainRef.current?.scrollTo({ top: 0 }); }, [pathname]);

  return (
    <div className="flex min-h-screen bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className={cn('sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface/60 transition-[width] duration-200 lg:flex', collapsed ? 'w-[72px]' : 'w-64')}>
        <div className={cn('flex h-16 items-center', collapsed ? 'justify-center' : 'px-5')}>
          {collapsed ? <LogoMark /> : <Logo />}
        </div>
        <SideNav collapsed={collapsed} />
        <div className="border-t border-line p-3">
          <button onClick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="flex h-9 w-full items-center justify-center gap-2 rounded-xl text-xs text-muted hover:bg-surface-2 hover:text-fg">
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" />Collapse</>}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 flex w-72 animate-fade-up flex-col border-r border-line bg-surface">
            <div className="flex h-16 items-center justify-between px-5">
              <Logo />
              <button onClick={() => setDrawer(false)} aria-label="Close menu" className="rounded-lg p-1.5 text-muted hover:bg-surface-2"><X className="h-5 w-5" /></button>
            </div>
            <SideNav collapsed={false} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setDrawer(true)} />
        <div className="flex min-h-0 flex-1">
          <main id="main" ref={mainRef} tabIndex={-1} className={cn('min-w-0 flex-1 outline-none', isAssistant ? '' : 'px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-8')}>
            <ErrorBoundary key={pathname}>
              <Suspense fallback={<div className="space-y-4 p-4"><Skeleton className="h-10 w-64" /><Skeleton className="h-64" /></div>}>
                <motion.div key={pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className={isAssistant ? 'h-full' : 'mx-auto max-w-6xl'}>
                  <Outlet />
                </motion.div>
              </Suspense>
            </ErrorBoundary>
          </main>
          {!isAssistant && <CompanionPanel />}
        </div>
      </div>

      <MobileTabs onMore={() => setDrawer(true)} />
    </div>
  );
}

function SideNav({ collapsed }: { collapsed: boolean }) {
  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined}
          className={({ isActive }) => cn('group flex h-10 items-center gap-3 rounded-xl text-sm font-medium transition-colors', collapsed ? 'justify-center' : 'px-3',
            isActive ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
          <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          {!collapsed && <span className="truncate">{n.label}</span>}
          {collapsed && <span className="sr-only">{n.label}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { signOut } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const profile = useProfile();
  const { resolved, setPref } = useTheme();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menu]);

  const name = profile.data?.display_name ?? '';
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-line bg-bg/85 px-4 backdrop-blur sm:gap-3 sm:px-6 lg:px-10">
      <button onClick={onMenu} aria-label="Open menu" className="rounded-xl p-2 text-muted hover:bg-surface-2 lg:hidden"><Menu className="h-5 w-5" /></button>
      <div className="lg:hidden"><LogoMark className="h-7 w-7" /></div>
      <div className="flex-1" />
      <GlobalSearchButton />
      <button onClick={() => setPref(resolved === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
        className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg">
        {resolved === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
      </button>
      <NotificationsMenu />
      <div ref={ref} className="relative">
        <button onClick={() => setMenu((m) => !m)} aria-label="Account menu" aria-expanded={menu}
          className="flex h-10 items-center gap-2 rounded-xl border border-line bg-surface pl-1.5 pr-1.5 hover:bg-surface-2 sm:pr-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-xs font-semibold text-accent">{initials(name)}</span>
          <span className="hidden max-w-[120px] truncate text-sm font-medium sm:block">{name || 'Account'}</span>
        </button>
        {menu && (
          <div role="menu" className="absolute right-0 top-12 z-50 w-56 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-pop">
            <button role="menuitem" onClick={() => { setMenu(false); nav('/app/settings'); }} className="flex w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2">Settings</button>
            <button role="menuitem" onClick={async () => {
              try { await signOut(); nav('/login', { replace: true }); } catch { toast.error('Could not sign out. Please try again.'); }
            }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-surface-2"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

function MobileTabs({ onMore }: { onMore: () => void }) {
  const tabs = NAV.filter((n) => MOBILE_TABS.includes(n.to));
  return (
    <nav aria-label="Mobile" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur pb-safe lg:hidden">
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-2">
        {tabs.map((n) => (
          <li key={n.to} className="flex-1">
            <NavLink to={n.to} end={n.end} className={({ isActive }) => cn('flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium', isActive ? 'text-accent' : 'text-muted')}>
              <n.icon className="h-5 w-5" aria-hidden />{n.label.replace('AI ', '').replace('Overview', 'Home')}
            </NavLink>
          </li>
        ))}
        <li className="flex-1">
          <button onClick={onMore} className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted"><Menu className="h-5 w-5" />More</button>
        </li>
      </ul>
    </nav>
  );
}
