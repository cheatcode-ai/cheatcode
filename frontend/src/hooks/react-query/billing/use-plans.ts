import { createQueryHook } from "@/hooks/use-query";
import { getAvailablePlans, PlanListResponse } from "@/lib/api";
import { billingKeys } from "@/hooks/react-query/threads/keys";
import { useAuth } from '@clerk/nextjs';

export const usePlansQuery = (enabled = true) => {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  
  return createQueryHook(
    billingKeys.plans,
    async () => {
      const token = await getToken();
      return getAvailablePlans(token || undefined);
    },
    {
      enabled: enabled && isLoaded && isSignedIn,
      retry: 1,
      staleTime: 1000 * 60 * 15, // 15 minutes (plans don't change often)
      gcTime: 1000 * 60 * 30,    // 30 minutes
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    }
  )();
};