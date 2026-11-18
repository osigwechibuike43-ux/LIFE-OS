import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Check, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Skeleton } from '@/components/ui';
import { useNotifications, useTimezone, useUnreadCount, useAppMutation } from '@/hooks/queries';
import { fmtDateTime } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { notificationApi } from '@/services/data';
import { useAuth } from '@/features/auth/AuthProvider';
import { supabase } from '@/lib/supabase';

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const tz = useTimezone();
  const qc = useQueryClient();
  const { user } = useAuth();
  const unread = useUnreadCount();
  const list = useNotifications();
  const refresh = { invalidate: ['notifications'] };
  const markAll = useAppMutation(notificationApi.markAllRead, refresh);
  const markOne = useAppMutation(notificationApi.markRead, refresh);
  const clear = useAppMutation(notificationApi.clear, refresh);

  // Live updates: new notifications appear without a refresh.
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`notif-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === 'notifications' }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user, qc]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const count = unread.data ?? 0;
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="icon" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${count ? `, ${count} unread` : ''}`} aria-expanded={open} className="relative">
        <Bell className="h-[18px] w-[18px]" />
        {count > 0 && <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-fg">{count > 9 ? '9+' : count}</span>}
      </Button>
      {open && (
        <div className="fixed inset-x-3 top-16 z-50 overflow-hidden rounded-2xl border border-line bg-surface shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[380px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold">Notifications</h2>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => markAll.mutate(undefined)} disabled={!count}><Check className="h-3.5 w-3.5" />Mark all read</Button>
              <Button size="sm" variant="ghost" onClick={() => clear.mutate(undefined)} disabled={!list.data?.length} aria-label="Clear all"><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {list.isLoading ? <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
              : list.isError ? <p className="p-6 text-center text-sm text-danger">Could not load notifications.</p>
              : !list.data?.length ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-muted">
                  <BellOff className="h-6 w-6" /><p className="text-sm">You are all caught up.</p>
                </div>
              ) : list.data.map((n) => (
                <button key={n.id} onClick={() => { if (!n.read_at) markOne.mutate(n.id); setOpen(false); if (n.link) nav(n.link); }}
                  className="flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left last:border-0 hover:bg-surface-2">
                  <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-accent')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{n.title}</span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-muted">{fmtDateTime(n.created_at, tz)}</span>
                  </span>
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
