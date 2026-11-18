import { useMemo } from 'react';
import { computeInsights, type Insights } from '../../supabase/functions/_shared/insights';
import { addDaysToKey, localDateKey, localDayRange } from '@/lib/dates';
import { insightsApi } from '@/services/data';
import { useTimezone, useUserQuery } from './queries';

/** Real analytics for the signed-in user, computed client-side from their own rows (same code the assistant uses). */
export function useInsights() {
  const tz = useTimezone();
  const today = localDateKey(new Date(), tz);
  const sinceDate = addDaysToKey(today, -34);
  const q = useUserQuery(['insights', today], () => insightsApi.load(localDayRange(sinceDate, tz).start.toISOString(), sinceDate), { staleTime: 60_000 });
  const insights = useMemo<Insights | null>(() => (q.data ? computeInsights({ ...q.data, now: new Date(), tz }) : null), [q.data, tz]);
  return { insights, isLoading: q.isLoading, isError: q.isError, refetch: q.refetch, tz };
}
