'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useSubscription } from '@/hooks/react-query/subscriptions/use-billing';
import { isLocalMode } from '@/lib/config';
import { BillingData } from '../_types';
import { useBilling as useBaseBilling } from '../_hooks';
import { useThreadState } from './ThreadStateContext';

interface BillingContextValue {
  // Billing state
  showBillingAlert: boolean;
  setShowBillingAlert: React.Dispatch<React.SetStateAction<boolean>>;
  billingData: BillingData;
  setBillingData: React.Dispatch<React.SetStateAction<BillingData>>;
  onDismissBilling: () => void;
  
  // Subscription data
  subscriptionStatus: 'active' | 'no_subscription';
}

const BillingContext = createContext<BillingContextValue | null>(null);

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) {
    throw new Error('useBilling must be used within BillingProvider');
  }
  return context;
}

interface BillingProviderProps {
  children: React.ReactNode;
}

export function BillingProvider({ children }: BillingProviderProps) {
  const { project, initialLoadCompleted } = useThreadState();

  const {
    showBillingAlert,
    setShowBillingAlert,
    billingData,
    setBillingData,
    checkBillingLimits,
    billingStatusQuery,
  } = useBaseBilling(project?.account_id, undefined, initialLoadCompleted);

  const { data: subscriptionData } = useSubscription();
  const subscriptionStatus: 'active' | 'no_subscription' = subscriptionData?.status === 'active'
    ? 'active'
    : 'no_subscription';

  const onDismissBilling = useCallback(() => {
    setShowBillingAlert(false);
  }, [setShowBillingAlert]);

  const value: BillingContextValue = {
    showBillingAlert,
    setShowBillingAlert,
    billingData,
    setBillingData,
    onDismissBilling,
    subscriptionStatus,
  };

  return (
    <BillingContext.Provider value={value}>
      {children}
    </BillingContext.Provider>
  );
}