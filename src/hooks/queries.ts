import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/AuthProvider';
import { categoryApi, notificationApi, prefsApi, profileApi } from '@/services/data';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/utils';
import { safeTimeZone } from '@/lib/dates';

export const qk = {
  profile: ['profile'] as const,
  prefs: ['prefs'] as const,
  entitlements: ['entitlements'] as const,
  taskCats: ['task-categories'] as const,
  noteCats: ['note-categories'] as const,
  unread: ['notifications', 'unread'] as const,
  notifications: ['notifications'] as const,
};

/** Query that only runs when a user is signed in. */
export function useUserQuery<T>(key: QueryKey, fn: () => Promise<T>, opts: { staleTime?: number; refetchInterval?: number; enabled?: boolean } = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [user?.id, ...key], queryFn: fn, enabled: Boolean(user) && (opts.enabled ?? true),
    staleTime: opts.staleTime ?? 30_000, refetchInterval: opts.refetchInterval,
  });
}

export const useProfile = () => useUserQuery(qk.profile, profileApi.get, { staleTime: 5 * 60_000 });
export const usePrefs = () => useUserQuery(qk.prefs, prefsApi.get, { staleTime: 5 * 60_000 });
export const useEntitlements = () => useUserQuery(qk.entitlements, profileApi.entitlements, { staleTime: 5 * 60_000 });
export const useTaskCategories = () => useUserQuery(qk.taskCats, categoryApi.tasks, { staleTime: 10 * 60_000 });
export const useNoteCategories = () => useUserQuery(qk.noteCats, categoryApi.notes, { staleTime: 10 * 60_000 });
export const useUnreadCount = () => useUserQuery(qk.unread, notificationApi.unreadCount, { refetchInterval: 30_000 });
export const useNotifications = () => useUserQuery(qk.notifications, notificationApi.list, { refetchInterval: 30_000 });

export function useTimezone(): string {
  const { data } = useProfile();
  return safeTimeZone(data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Mutation with uniform error toasts and cache invalidation.
 * `invalidate` lists key prefixes (after the user id) to refresh on success.
 */
export function useAppMutation<TArgs, TRes>(
  fn: (a: TArgs) => Promise<TRes>,
  opts: { invalidate?: string[]; success?: string | ((r: TRes) => string | undefined); onSuccess?: (r: TRes) => void } = {},
) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      // Query keys are [userId, domain, ...]; invalidate every query whose domain matches.
      void qc.invalidateQueries({ predicate: (q) => (opts.invalidate ?? []).some((k) => q.queryKey[1] === k) });
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(r);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}
