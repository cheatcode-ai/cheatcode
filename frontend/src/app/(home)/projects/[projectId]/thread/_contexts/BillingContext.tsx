'use client';

import React, { createContext, useContext, useCallback } from 'react';
import { useSubscription } from '@/hooks/react-query/subscriptions/use-billing';
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

export function useThreadBilling() {
  const context = useContext(BillingContext);
  if (!context) {
    throw new Error('useThreadBilling must be used within ThreadBillingProvider');
  }
  return context;
}

interface BillingProviderProps {
  children: React.ReactNode;
}

export function ThreadBillingProvider({ children }: BillingProviderProps) {
  const { project, initialLoadCompleted } = useThreadState();

  const {
    showBillingAlert,
    setShowBillingAlert,
    billingData,
    setBillingData,
  } = useBaseBilling(project?.account_id, 'idle', initialLoadCompleted);

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