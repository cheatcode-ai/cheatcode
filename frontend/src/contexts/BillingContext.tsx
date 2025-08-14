'use client';

import React, { createContext, useContext, useCallback, useEffect, useRef } from 'react';
import { useBillingStatusQuery } from '@/hooks/react-query/threads/use-billing-status';
import { BillingStatusResponse } from '@/lib/api';
import { isLocalMode } from '@/lib/config';
import { useAuth } from '@clerk/nextjs';

interface BillingContextType {
  billingStatus: BillingStatusResponse | null;
  isLoading: boolean;
  error: Error | null;
  checkBillingStatus: () => Promise<boolean>;
  lastCheckTime: number | null;
  // Enhanced credit information
  creditsRemaining: number;
  creditsTotal: number;
  creditsUsagePercentage: number;
  planName: string;
  isUpgradeRequired: boolean;
  quotaResetsAt: string | null;
  // Raw credits for calculations (monthly totals)
  rawCreditsRemaining: number;
  rawCreditsTotal: number;
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
  const { isLoaded, isSignedIn, getToken } = useAuth();
  
  // Only enable billing status query when user is fully authenticated
  const billingStatusQuery = useBillingStatusQuery(isLoaded && isSignedIn);
  const lastCheckRef = useRef<number | null>(null);
  const checkInProgressRef = useRef<boolean>(false);

  const checkBillingStatus = useCallback(async (force = false): Promise<boolean> => {
    // if (isLocalMode()) {
    //   console.log('Running in local development mode - billing checks are disabled');
    //   return false;
    // }

    // Don't check billing status if user isn't authenticated
    if (!isLoaded || !isSignedIn) {
      console.log('User not authenticated, skipping billing check');
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
      console.error('Error checking billing status:', err);
      return false;
    } finally {
      checkInProgressRef.current = false;
    }
  }, [billingStatusQuery, isLoaded, isSignedIn]);

  useEffect(() => {
    if (!billingStatusQuery.data) {
      checkBillingStatus(true);
    }
  }, [checkBillingStatus, billingStatusQuery.data]);

  // Calculate enhanced credit information
  const billingStatus = billingStatusQuery.data || null;
  const rawCreditsRemaining = billingStatus?.credits_remaining || 0;
  const rawCreditsTotal = billingStatus?.credits_total || 0;
  const planName = billingStatus?.plan_name || 'Free';
  const quotaResetsAt = billingStatus?.quota_resets_at || null;
  
  // Deployment information
  const deploymentsUsed = billingStatus?.deployments_used || 0;
  const deploymentsTotal = billingStatus?.deployments_total || 0;
  const deploymentUsagePercentage = deploymentsTotal > 0 ? (deploymentsUsed / deploymentsTotal) * 100 : 0;
  
  // For free users, show daily credits (5/5) instead of monthly total (20/20)
  const isFreeUser = planName?.toLowerCase() === 'free' || billingStatus?.plan_id === 'free';
  const creditsRemaining = isFreeUser ? Math.min(rawCreditsRemaining, 5) : rawCreditsRemaining;
  const creditsTotal = isFreeUser ? 5 : rawCreditsTotal;
  const creditsUsagePercentage = creditsTotal > 0 ? ((creditsTotal - creditsRemaining) / creditsTotal) * 100 : 0;
  const isUpgradeRequired = rawCreditsRemaining <= 0 && billingStatus?.plan_id !== 'byok';
  
  // BYOK key status - Real implementation with API call
  const [byokStatus, setByokStatus] = React.useState<{
    configured: boolean;
    valid: boolean;
    error?: string;
  }>({
    configured: false,
    valid: false,
    error: undefined
  });
  
  const isByokUser = billingStatus?.plan_id === 'byok';
  
  // Fetch BYOK status for BYOK users
  React.useEffect(() => {
    const fetchByokStatus = async () => {
      if (!isByokUser || !isLoaded || !isSignedIn) {
        setByokStatus({ configured: false, valid: false });
        return;
      }
      
      try {
        const token = await getToken();
        if (!token) return;
        
        const response = await fetch('/api/billing/openrouter-key/status', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const data = await response.json();
          setByokStatus({
            configured: data.key_configured || false,
            valid: !data.error,
            error: data.error
          });
        } else {
          setByokStatus({ 
            configured: false, 
            valid: false, 
            error: 'Failed to check BYOK status' 
          });
        }
      } catch (error) {
        console.error('Error fetching BYOK status:', error);
        setByokStatus({ 
          configured: false, 
          valid: false, 
          error: 'Failed to check BYOK status' 
        });
      }
    };
    
    fetchByokStatus();
  }, [isByokUser, isLoaded, isSignedIn, getToken]);
  
  const byokKeyConfigured = byokStatus.configured;
  const byokKeyValid = byokStatus.valid;
  const byokKeyError = byokStatus.error;

  const value = {
    billingStatus,
    isLoading: billingStatusQuery.isLoading,
    error: billingStatusQuery.error,
    checkBillingStatus,
    lastCheckTime: lastCheckRef.current,
    creditsRemaining,
    creditsTotal,
    creditsUsagePercentage,
    planName,
    isUpgradeRequired,
    quotaResetsAt,
    rawCreditsRemaining,
    rawCreditsTotal,
    byokKeyConfigured,
    byokKeyValid,
    byokKeyError,
    deploymentsUsed,
    deploymentsTotal,
    deploymentUsagePercentage,
  };

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