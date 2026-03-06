import { useState, useCallback } from 'react';

interface BillingErrorState {
  message: string;
  currentUsage?: number;
  limit?: number;
  subscription?: {
    price_id?: string;
    plan_name?: string;
    current_usage?: number;
    limit?: number;
  };
}

export function useBillingError() {
  const [billingError, setBillingError] = useState<BillingErrorState | null>(
    null,
  );

  const handleBillingError = useCallback((error: Record<string, unknown>) => {
    const sub = error.subscription as Record<string, unknown> | undefined;

    // Case 1: Error is already a formatted billing error detail object
    if (error && (error.message || sub)) {
      setBillingError({
        message:
          (error.message as string) ||
          "You've reached your monthly usage limit.",
        currentUsage:
          (error.currentUsage as number | undefined) ||
          (sub?.current_usage as number | undefined),
        limit:
          (error.limit as number | undefined) ||
          (sub?.limit as number | undefined),
        subscription: (sub as BillingErrorState['subscription']) || {},
      });
      return true;
    }

    // Case 2: Error is an HTTP error response
    const errMsg = error.message as string | undefined;
    if (
      error.status === 402 ||
      (errMsg && errMsg.includes('Payment Required'))
    ) {
      // Try to get details from error.data.detail (common API pattern)
      const errorData = error.data as Record<string, unknown> | undefined;
      const errorDetail = (errorData?.detail as Record<string, unknown>) || {};
      const subscription =
        (errorDetail.subscription as BillingErrorState['subscription']) || {};

      setBillingError({
        message:
          (errorDetail.message as string) ||
          "You've reached your monthly usage limit.",
        currentUsage: subscription.current_usage,
        limit: subscription.limit,
        subscription,
      });
      return true;
    }

    // Not a billing error
    return false;
  }, []);

  const clearBillingError = useCallback(() => {
    setBillingError(null);
  }, []);

  return {
    billingError,
    handleBillingError,
    clearBillingError,
  };
}
