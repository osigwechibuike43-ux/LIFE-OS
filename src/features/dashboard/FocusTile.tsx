import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { useAppMutation, useTimezone, useUserQuery } from '@/hooks/queries';
import { localDateKey, localDayRange } from '@/lib/dates';
import { focusApi } from '@/services/data';
import { Skeleton } from '@/components/ui';
import type { FocusSession } from '@/types/db';

function fmt(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** "Deep Work Time": a real focus timer backed by focus_sessions rows. */
export function FocusTile() {
  const tz = useTimezone();
  const qc = useQueryClient();
  const today = localDateKey(new Date(), tz);
  const [now, setNow] = useState(Date.now());

  const sessions = useUserQuery<FocusSession[]>(['focus', today], () => focusApi.since(localDayRange(today, tz).start.toISOString()));
  const open = useUserQuery<FocusSession | null>(['focus', 'open'], focusApi.open, { staleTime: 0 });
  const refresh = { invalidate: ['focus', 'insights'] };
  const start = useAppMutation(() => focusApi.start(), refresh);
  const stop = useAppMutation((s: FocusSession) => focusApi.stop(s.id, s.started_at), { ...refresh, success: 'Focus session saved' });

  const running = open.data ?? null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const finished = (sessions.data ?? []).filter((s) => s.ended_at).reduce((a, s) => a + s.duration_seconds, 0);
  const live = running ? Math.max(0, Math.round((now - new Date(running.started_at).getTime()) / 1000)) : 0;
  const busy = start.isPending || stop.isPending;

  return (
    <div className="glow-amber relative flex min-h-[180px] flex-col justify-between overflow-hidden rounded-3xl border border-line p-5">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-medium">Deep work time</h3>
        <button
          disabled={busy || open.isLoading}
          onClick={() => (running ? stop.mutate(running) : start.mutate(undefined, { onSuccess: () => void qc.invalidateQueries({ predicate: (q) => q.queryKey[1] === 'focus' }) }))}
          aria-label={running ? 'Stop focus session' : 'Start focus session'}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-soft transition-transform hover:scale-105 disabled:opacity-60">
          {running ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 translate-x-px fill-current" />}
        </button>
      </div>
      <div>
        {sessions.isLoading ? <Skeleton className="h-10 w-28" /> : <p className="font-display text-4xl font-light tabular-nums">{fmt(finished + live)}</p>}
        <p className="mt-1 text-xs text-muted">{running ? 'Session running…' : finished > 0 ? 'Focused today' : 'Press play to start tracking'}</p>
      </div>
    </div>
  );
}
