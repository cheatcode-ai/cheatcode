import { useMemo } from 'react';
import { BillingStatusResponse } from '@/lib/api';

export interface BillingCalculations {
  // Display credits (adjusted for free tier daily limits)
  creditsRemaining: number;
  creditsTotal: number;
  creditsUsagePercentage: number;

  // Raw credits (monthly totals from API)
  rawCreditsRemaining: number;
  rawCreditsTotal: number;

  // Plan info
  planName: string;
  isFreeUser: boolean;
  isByokUser: boolean;
  isUpgradeRequired: boolean;
  quotaResetsAt: string | null;

  // Deployment info
  deploymentsUsed: number;
  deploymentsTotal: number;
  deploymentUsagePercentage: number;
}

/**
 * Hook for computing billing calculations from raw billing status
 * Separates calculation logic from data fetching concerns
 */
export function useBillingCalculations(
  billingStatus: BillingStatusResponse | null | undefined
): BillingCalculations {
  return useMemo(() => {
    // Raw values from API
    const rawCreditsRemaining = billingStatus?.credits_remaining ?? 0;
    const rawCreditsTotal = billingStatus?.credits_total ?? 0;
    const planName = billingStatus?.plan_name ?? 'Free';
    const quotaResetsAt = billingStatus?.quota_resets_at ?? null;

    // Plan type detection
    const isFreeUser = planName?.toLowerCase() === 'free' || billingStatus?.plan_id === 'free';
    const isByokUser = billingStatus?.plan_id === 'byok';

    // For free users, show daily credits (5/5) instead of monthly total (20/20)
    const creditsRemaining = isFreeUser ? Math.min(rawCreditsRemaining, 5) : rawCreditsRemaining;
    const creditsTotal = isFreeUser ? 5 : rawCreditsTotal;

    // Calculate usage percentage (0-100)
    const creditsUsagePercentage = creditsTotal > 0
      ? ((creditsTotal - creditsRemaining) / creditsTotal) * 100
      : 0;

    // Upgrade required if no credits and not on BYOK plan
    const isUpgradeRequired = rawCreditsRemaining <= 0 && !isByokUser;

    // Deployment calculations
    const deploymentsUsed = billingStatus?.deployments_used ?? 0;
    const deploymentsTotal = billingStatus?.deployments_total ?? 0;
    const deploymentUsagePercentage = deploymentsTotal > 0
      ? (deploymentsUsed / deploymentsTotal) * 100
      : 0;

    return {
      creditsRemaining,
      creditsTotal,
      creditsUsagePercentage,
      rawCreditsRemaining,
      rawCreditsTotal,
      planName,
      isFreeUser,
      isByokUser,
      isUpgradeRequired,
      quotaResetsAt,
      deploymentsUsed,
      deploymentsTotal,
      deploymentUsagePercentage,
    };
  }, [billingStatus]);
}

/**
 * Helper to check if user can perform actions
 */
export function canUserRun(billingStatus: BillingStatusResponse | null | undefined): boolean {
  if (!billingStatus) return false;
  return billingStatus.can_run === true;
}

/**
 * Helper to check if user is near credit limit
 */
export function isNearCreditLimit(
  calculations: BillingCalculations,
  threshold = 80
): boolean {
  return calculations.creditsUsagePercentage >= threshold;
}
