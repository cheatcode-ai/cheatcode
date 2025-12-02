"use client";

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { createPolarCheckoutSession } from '@/lib/api';
import { useAuth } from '@clerk/nextjs';

interface UsePolarCheckoutOptions {
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface CheckoutOpenOptions {
  planId?: string;
  paymentLink?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export function usePolarCheckout(options: UsePolarCheckoutOptions = {}) {
  const [isLoading, setIsLoading] = useState(false);
  const { getToken } = useAuth();

  const { onError } = options;

  const openCheckout = useCallback(async (checkoutOptions: CheckoutOpenOptions) => {
    try {
      setIsLoading(true);

      const {
        planId,
        paymentLink,
        successUrl,
        cancelUrl
      } = checkoutOptions;

      let finalPaymentLink = paymentLink;

      // If planId is provided but no paymentLink, call backend to create checkout session
      if (planId && !paymentLink) {
        const token = await getToken();
        if (!token) {
          throw new Error('Authentication required');
        }

        const result = await createPolarCheckoutSession(
          token,
          planId,
          successUrl || `${window.location.origin}/dashboard?upgrade=success`,
          cancelUrl || `${window.location.origin}/dashboard?upgrade=cancelled`
        );

        if (!result.checkout_url) {
          throw new Error('Failed to create checkout session');
        }

        finalPaymentLink = result.checkout_url;
      }

      if (!finalPaymentLink) {
        throw new Error('Either planId or paymentLink must be provided');
      }

      // Direct redirect to Polar hosted checkout
      window.location.href = finalPaymentLink;

    } catch (error) {
      setIsLoading(false);
      console.error('Failed to open checkout:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to open checkout';
      onError?.(errorMessage);
      toast.error(errorMessage);
    }
  }, [onError, getToken]);

  return {
    openCheckout,
    isLoading,
  };
}
