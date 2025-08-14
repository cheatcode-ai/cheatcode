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
  
  // Upgrade dialog
  showUpgradeDialog: boolean;
  setShowUpgradeDialog: React.Dispatch<React.SetStateAction<boolean>>;
  handleDismissUpgradeDialog: () => void;
  
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
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);

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

  const handleDismissUpgradeDialog = useCallback(() => {
    setShowUpgradeDialog(false);
    localStorage.setItem('suna_upgrade_dialog_displayed', 'true');
  }, []);

  // Show upgrade dialog for free tier users
  useEffect(() => {
    if (initialLoadCompleted && subscriptionData) {
      const hasSeenUpgradeDialog = localStorage.getItem('suna_upgrade_dialog_displayed');
      const isFreeTier = subscriptionStatus === 'no_subscription';
      if (!hasSeenUpgradeDialog && isFreeTier && !isLocalMode()) {
        setShowUpgradeDialog(true);
      }
    }
  }, [subscriptionData, subscriptionStatus, initialLoadCompleted]);

  const value: BillingContextValue = {
    showBillingAlert,
    setShowBillingAlert,
    billingData,
    setBillingData,
    onDismissBilling,
    showUpgradeDialog,
    setShowUpgradeDialog,
    handleDismissUpgradeDialog,
    subscriptionStatus,
  };

  return (
    <BillingContext.Provider value={value}>
      {children}
    </BillingContext.Provider>
  );
}