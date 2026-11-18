import { useUserQuery } from '@/hooks/queries';
import { exportApi, prefsApi, profileApi } from '@/services/data';

export { exportApi, prefsApi, profileApi };
export const useProviderQuery = () => useUserQuery(['ai-provider'], prefsApi.getProvider, { staleTime: 5 * 60_000 });
