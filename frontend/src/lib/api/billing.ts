// Billing API Functions
import { handleApiError } from '../error-handler';
import { API_URL } from './config';
import { InsufficientCreditsError } from './errors';
import {
  SubscriptionStatus,
  BillingStatusResponse,
  UsageHistoryResponse,
  PlanListResponse,
  CheckoutSessionResponse,
} from './types';

export const getSubscription = async (clerkToken?: string): Promise<SubscriptionStatus> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/billing/subscription`, {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error getting subscription: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error getting subscription: ${response.statusText} (${response.status})`,
      );
    }

    return response.json();
  } catch (error) {
    console.error('Failed to get subscription:', error);
    handleApiError(error, { operation: 'load subscription', resource: 'billing information' });
    throw error;
  }
};

export const checkBillingStatus = async (clerkToken?: string): Promise<BillingStatusResponse> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/billing/status`, {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error checking billing status: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error checking billing status: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();

    // Add backward compatibility fields
    data.can_run = data.credits_remaining > 0 || data.plan_id === 'byok';
    data.message = data.can_run
      ? `You have ${data.credits_remaining} credits remaining`
      : `Insufficient credits. You have ${data.credits_remaining} credits remaining.`;

    return data;
  } catch (error) {
    console.error('Failed to check billing status:', error);
    handleApiError(error, { operation: 'check billing status', resource: 'billing information' });
    throw error;
  }
};

export const getUsageHistory = async (clerkToken?: string, days: number = 30): Promise<UsageHistoryResponse> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/billing/usage-history?days=${days}`, {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error getting usage history: ${response.statusText} (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get usage history:', error);
    handleApiError(error, { operation: 'get usage history', resource: 'usage information' });
    throw error;
  }
};

export const getAvailablePlans = async (clerkToken?: string): Promise<PlanListResponse> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/billing/plans`, {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error getting plans: ${response.statusText} (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get plans:', error);
    handleApiError(error, { operation: 'get plans', resource: 'plan information' });
    throw error;
  }
};

export const createPolarCheckoutSession = async (
  clerkToken: string,
  planId: string,
  successUrl?: string,
  cancelUrl?: string
): Promise<CheckoutSessionResponse> => {
  try {
    const response = await fetch(`${API_URL}/billing/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_id: planId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      }),
    });

    if (!response.ok) {
      if (response.status === 402) {
        const errorData = await response.json();
        throw new InsufficientCreditsError(errorData.detail);
      }

      if (response.status === 503) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Payment processing is currently unavailable. Please contact support to upgrade your plan.');
      }

      throw new Error(`Error creating checkout session: ${response.statusText} (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to create checkout session:', error);
    throw error;
  }
};
