import { createQueryHook } from "@/hooks/use-query";
import { getUsageHistory, UsageHistoryResponse } from "@/lib/api";
import { billingKeys } from "@/hooks/react-query/threads/keys";
import { useAuth } from '@clerk/nextjs';

export const useUsageHistoryQuery = (days: number = 30, enabled = true) => {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  
  return createQueryHook(
    billingKeys.usageHistory(days),
    async () => {
      const token = await getToken();
      return getUsageHistory(token || undefined, days);
    },
    {
      enabled: enabled && isLoaded && isSignedIn,
      retry: 1,
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 10,   // 10 minutes
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    }
  )();
};