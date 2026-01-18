import { BillingErrorAlert } from '@/components/billing/usage-limit-alert';
import { useThreadBilling } from '../_contexts/BillingContext';

export function ThreadBillingAlerts() {
  const {
    showBillingAlert,
    billingData,
    onDismissBilling,
  } = useThreadBilling();

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