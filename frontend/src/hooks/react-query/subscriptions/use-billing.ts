'use client';

import { createQueryHook } from '@/hooks/use-query';
import { createClerkBillingApi } from '@/lib/api-enhanced';
import { usageKeys } from './keys';
import { useAuth } from '@clerk/nextjs';

export const useSubscription = () => {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  return createQueryHook(
    ['billing', 'subscription'],
    async () => {
      // Wait for auth to be loaded
      if (!isLoaded) {
        return null;
      }

      // Don't make API call if user is not signed in
      if (!isSignedIn) {
        return null;
      }

      const clerkBillingApi = createClerkBillingApi(getToken);
      return clerkBillingApi.getSubscription();
    },
    {
      staleTime: 2 * 60 * 1000, // 2 minutes
      refetchOnWindowFocus: true,
      enabled: isLoaded && isSignedIn, // Only run query when auth is loaded and user is signed in
    },
  )();
};

export const useUsageLogs = (days: number = 30) => {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  return createQueryHook(
    usageKeys.logs(days),
    async () => {
      // Wait for auth to be loaded
      if (!isLoaded) {
        return null;
      }

      // Don't make API call if user is not signed in
      if (!isSignedIn) {
        return null;
      }

      const clerkBillingApi = createClerkBillingApi(getToken);
      return clerkBillingApi.getUsageLogs(days);
    },
    {
      staleTime: 30 * 1000, // 30 seconds
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      enabled: isLoaded && isSignedIn, // Only run query when auth is loaded and user is signed in
    },
  )();
};
