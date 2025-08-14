'use client';

import { createMutationHook, createQueryHook } from '@/hooks/use-query';
import {
  getSubscription,

  SubscriptionStatus,
} from '@/lib/api';
import { subscriptionKeys } from './keys';
import { useAuth } from '@clerk/nextjs';
import { useSubscription as useSubscriptionFromBilling } from './use-billing';

// DEPRECATED: Use useSubscription from use-billing.ts instead
export const useSubscriptionLegacy = createQueryHook(
  subscriptionKeys.details(),
  async () => {
    // This legacy hook doesn't pass Clerk token, so it will fail
    // Use the new useSubscription from use-billing.ts instead
    throw new Error('DEPRECATED: Use useSubscription from use-billing.ts instead');
  },
  {
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: true,
    enabled: false, // Disable this hook
  },
);

// DEPRECATED: Redirect to new hook for backward compatibility
export const useSubscription = useSubscriptionFromBilling;



export const isPlan = (
  subscriptionData: SubscriptionStatus | null | undefined,
  planId?: string,
): boolean => {
  if (!subscriptionData) return planId === 'free';
  return subscriptionData.plan_name === planId;
};
