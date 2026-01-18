import { createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { checkBillingStatus, BillingStatusResponse } from "@/lib/api";
import { useAuth } from '@clerk/nextjs';
import { useRefetchControl } from "@/hooks/use-refetch-control";
import { useRef } from 'react';

// Exponential backoff configuration
const BACKOFF_CONFIG = {
  baseInterval: 30 * 1000,     // 30 seconds initial
  maxInterval: 5 * 60 * 1000,  // 5 minutes max
  multiplier: 1.5,             // Increase by 50% each time
  normalInterval: 2 * 60 * 1000, // 2 minutes when credits available
};

export const useBillingStatusQuery = (enabled = true) => {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  // Track consecutive "at limit" polls for exponential backoff
  const consecutiveLimitPollsRef = useRef(0);

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
      staleTime: 1000 * 60 * 5, // 5 minutes - billing data rarely changes
      gcTime: 1000 * 60 * 5, // 5 minutes instead of 10
      refetchOnWindowFocus: !disableWindowFocus, // Controlled by context
      refetchOnMount: !disableMount, // Controlled by context
      refetchOnReconnect: !disableReconnect, // Controlled by context
      refetchInterval: disableInterval ? false : (query: { state: { data?: BillingStatusResponse } }) => {
        // Exponential backoff when at limit
        if (query.state.data && !query.state.data.can_run) {
          // Increment consecutive limit polls
          consecutiveLimitPollsRef.current += 1;

          // Calculate exponential backoff interval
          const backoffInterval = Math.min(
            BACKOFF_CONFIG.baseInterval * Math.pow(BACKOFF_CONFIG.multiplier, consecutiveLimitPollsRef.current - 1),
            BACKOFF_CONFIG.maxInterval
          );

          return backoffInterval;
        }

        // Reset backoff counter when credits become available
        consecutiveLimitPollsRef.current = 0;

        // Normal polling when credits available
        return BACKOFF_CONFIG.normalInterval;
      },
    }
  )();
};
