import { createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { checkBillingStatus, BillingStatusResponse } from "@/lib/api";
import { Query } from "@tanstack/react-query";
import { useAuth } from '@clerk/nextjs';

export const useBillingStatusQuery = (enabled = true) => {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  
  return createQueryHook(
    threadKeys.billingStatus,
    async () => {
      // Double-check authentication before making the call
      if (!isLoaded || !isSignedIn) {
        throw new Error('User not authenticated');
      }
      
      const token = await getToken();
      if (!token) {
        throw new Error('Failed to get authentication token');
      }
      
      return checkBillingStatus(token);
    },
    {
      enabled: enabled && isLoaded && isSignedIn,
      retry: (failureCount, error) => {
        // Only retry for certain types of errors, not authentication errors
        if (error?.message?.includes('Authentication required') || 
            error?.message?.includes('Failed to get authentication token')) {
          return false;
        }
        return failureCount < 3;
      },
      staleTime: 1000 * 30, // 30 seconds instead of 5 minutes
      gcTime: 1000 * 60 * 5, // 5 minutes instead of 10
      refetchOnWindowFocus: true, // Refetch when user comes back to window
      refetchOnMount: true, // Refetch when component mounts
      refetchOnReconnect: true, // Refetch on network reconnection
      refetchInterval: (query: Query<BillingStatusResponse, Error>) => {
        // More frequent polling when approaching/at limit
        if (query.state.data && !query.state.data.can_run) {
          return 1000 * 30; // 30 seconds when at limit
        }
        // Less frequent polling when credits available
        return 1000 * 60 * 2; // 2 minutes when credits available
      },
    }
  )();
};
