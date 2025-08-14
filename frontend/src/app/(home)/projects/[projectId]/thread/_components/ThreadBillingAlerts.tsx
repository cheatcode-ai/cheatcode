import React from 'react';
import { BillingErrorAlert } from '@/components/billing/usage-limit-alert';
import { UpgradeDialog } from './UpgradeDialog';
import { useBilling } from '../_contexts/BillingContext';

export function ThreadBillingAlerts() {
  const {
    showBillingAlert,
    billingData,
    onDismissBilling,
    showUpgradeDialog,
    setShowUpgradeDialog,
    handleDismissUpgradeDialog,
  } = useBilling();

  return (
    <>
      <BillingErrorAlert
        message={billingData.message}
        currentUsage={billingData.currentUsage}
        limit={billingData.limit}
        accountId={billingData.accountId}
        onDismiss={onDismissBilling}
        isOpen={showBillingAlert}
      />
      
      <UpgradeDialog
        open={showUpgradeDialog}
        onOpenChange={setShowUpgradeDialog}
        onDismiss={handleDismissUpgradeDialog}
      />
    </>
  );
}