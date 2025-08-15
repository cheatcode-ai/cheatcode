import React from 'react';
import { BillingErrorAlert } from '@/components/billing/usage-limit-alert';
import { useBilling } from '../_contexts/BillingContext';

export function ThreadBillingAlerts() {
  const {
    showBillingAlert,
    billingData,
    onDismissBilling,
  } = useBilling();

  return (
    <BillingErrorAlert
      message={billingData.message}
      currentUsage={billingData.currentUsage}
      limit={billingData.limit}
      accountId={billingData.accountId}
      onDismiss={onDismissBilling}
      isOpen={showBillingAlert}
    />
  );
}