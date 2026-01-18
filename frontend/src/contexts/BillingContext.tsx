'use client';

import React, { createContext, useContext, useCallback, useEffect, useRef, useMemo } from 'react';
import { useBillingStatusQuery } from '@/hooks/react-query/threads/use-billing-status';
import { useOpenRouterKeyStatus } from '@/hooks/react-query/settings/use-settings-queries';
import { useBillingCalculations } from '@/hooks/use-billing-calculations';
import { BillingStatusResponse } from '@/lib/api';
import { useAuth } from '@clerk/nextjs';
import { createLogger } from '@/lib/logger';

const logger = createLogger('Billing');

interface BillingContextType {
  // Core billing status
  billingStatus: BillingStatusResponse | null;
  isLoading: boolean;
  error: Error | null;
  checkBillingStatus: () => Promise<boolean>;
  lastCheckTime: number | null;

  // Calculated credit information
  creditsRemaining: number;
  creditsTotal: number;
  creditsUsagePercentage: number;
  rawCreditsRemaining: number;
  rawCreditsTotal: number;

  // Plan information
  planName: string;
  isUpgradeRequired: boolean;
  quotaResetsAt: string | null;

  // BYOK key status
  byokKeyConfigured: boolean;
  byokKeyValid: boolean;
  byokKeyError?: string;

  // Deployment information
  deploymentsUsed: number;
  deploymentsTotal: number;
  deploymentUsagePercentage: number;
}

const BillingContext = createContext<BillingContextType | null>(null);

export function BillingProvider({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  // Core billing status query
  const billingStatusQuery = useBillingStatusQuery(isLoaded && isSignedIn);
  const billingStatus = billingStatusQuery.data ?? null;

  // Use the calculations hook
  const calculations = useBillingCalculations(billingStatus);

  // BYOK status using the existing settings hook (only fetch for BYOK users)
  const byokStatusQuery = useOpenRouterKeyStatus(calculations.isByokUser && isLoaded && isSignedIn);

  // Track last check time
  const lastCheckRef = useRef<number | null>(null);
  const checkInProgressRef = useRef<boolean>(false);

  // Manual billing check function
  const checkBillingStatus = useCallback(async (force = false): Promise<boolean> => {
    // Don't check billing status if user isn't authenticated
    if (!isLoaded || !isSignedIn) {
      logger.debug('User not authenticated, skipping billing check');
      return false;
    }

    if (checkInProgressRef.current) {
      return !billingStatusQuery.data?.can_run;
    }

    const now = Date.now();
    if (!force && lastCheckRef.current && now - lastCheckRef.current < 60000) {
      return !billingStatusQuery.data?.can_run;
    }

    try {
      checkInProgressRef.current = true;
      if (force || billingStatusQuery.isStale) {
        await billingStatusQuery.refetch();
      }
      lastCheckRef.current = now;
      return !billingStatusQuery.data?.can_run;
    } catch (err) {
      logger.error('Error checking billing status:', err);
      return false;
    } finally {
      checkInProgressRef.current = false;
    }
  }, [billingStatusQuery, isLoaded, isSignedIn]);

  // Initial billing check
  useEffect(() => {
    if (!billingStatusQuery.data && isLoaded && isSignedIn) {
      checkBillingStatus(true);
    }
  }, [checkBillingStatus, billingStatusQuery.data, isLoaded, isSignedIn]);

  // Derive BYOK status from the query
  const byokKeyConfigured = byokStatusQuery.data?.key_configured ?? false;
  const byokKeyValid = byokStatusQuery.data?.has_key && !byokStatusQuery.data?.error;
  const byokKeyError = byokStatusQuery.data?.error;

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<BillingContextType>(() => ({
    // Core billing
    billingStatus,
    isLoading: billingStatusQuery.isLoading,
    error: billingStatusQuery.error,
    checkBillingStatus,
    lastCheckTime: lastCheckRef.current,

    // From calculations hook
    creditsRemaining: calculations.creditsRemaining,
    creditsTotal: calculations.creditsTotal,
    creditsUsagePercentage: calculations.creditsUsagePercentage,
    rawCreditsRemaining: calculations.rawCreditsRemaining,
    rawCreditsTotal: calculations.rawCreditsTotal,
    planName: calculations.planName,
    isUpgradeRequired: calculations.isUpgradeRequired,
    quotaResetsAt: calculations.quotaResetsAt,
    deploymentsUsed: calculations.deploymentsUsed,
    deploymentsTotal: calculations.deploymentsTotal,
    deploymentUsagePercentage: calculations.deploymentUsagePercentage,

    // BYOK status
    byokKeyConfigured,
    byokKeyValid: byokKeyValid ?? false,
    byokKeyError,
  }), [
    billingStatus,
    billingStatusQuery.isLoading,
    billingStatusQuery.error,
    checkBillingStatus,
    calculations,
    byokKeyConfigured,
    byokKeyValid,
    byokKeyError,
  ]);

  return (
    <BillingContext.Provider value={value}>
      {children}
    </BillingContext.Provider>
  );
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) {
    throw new Error('useBilling must be used within a BillingProvider');
  }
  return context;
}

// Re-export calculations hook for direct use
export { useBillingCalculations } from '@/hooks/use-billing-calculations';
