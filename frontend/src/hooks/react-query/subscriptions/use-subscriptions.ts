'use client';

import { SubscriptionStatus } from '@/lib/api';
import { useSubscription as useSubscriptionFromBilling } from './use-billing';

// Re-export from the canonical location
export const useSubscription = useSubscriptionFromBilling;

export const isPlan = (
  subscriptionData: SubscriptionStatus | null | undefined,
  planId?: string,
): boolean => {
  if (!subscriptionData) return planId === 'free';
  return subscriptionData.plan_name === planId;
};
