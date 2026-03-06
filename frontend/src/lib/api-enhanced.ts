import { createClerkBackendApi } from './api-client';
import {
  type CreateCheckoutSessionRequest,
  type CreateCheckoutSessionResponse,
  type SubscriptionStatus,
  type BillingStatusResponse,
  type UsageHistoryResponse,
} from './api';

export * from './api';

// Clerk-aware billing API factory
export const createClerkBillingApi = (
  getToken: () => Promise<string | null>,
) => {
  const clerkBackendApi = createClerkBackendApi(getToken);

  return {
    async getSubscription(): Promise<SubscriptionStatus | null> {
      try {
        const token = await getToken();
        if (!token) {
          // Don't log error for unauthenticated users - this is expected
          return null;
        }

        const result = await clerkBackendApi.get<SubscriptionStatus>(
          '/billing/status',
          {
            errorContext: {
              operation: 'load subscription',
              resource: 'billing information',
            },
          },
        );

        return result.data ?? null;
      } catch (error) {
        throw error;
      }
    },

    async checkStatus(): Promise<BillingStatusResponse | null> {
      const result = await clerkBackendApi.get<BillingStatusResponse>(
        '/billing/status',
        {
          errorContext: {
            operation: 'check billing status',
            resource: 'account status',
          },
        },
      );

      return result.data ?? null;
    },

    async createCheckoutSession(
      request: CreateCheckoutSessionRequest,
    ): Promise<CreateCheckoutSessionResponse | null> {
      const result = await clerkBackendApi.post<CreateCheckoutSessionResponse>(
        '/billing/create-checkout-session',
        request,
        {
          errorContext: {
            operation: 'create checkout session',
            resource: 'billing',
          },
        },
      );

      return result.data ?? null;
    },

    async getUsageLogs(
      days: number = 30,
    ): Promise<UsageHistoryResponse | null> {
      const result = await clerkBackendApi.get<UsageHistoryResponse>(
        `/billing/usage-history?days=${days}`,
        {
          errorContext: {
            operation: 'load usage logs',
            resource: 'usage history',
          },
        },
      );

      return result.data ?? null;
    },
  };
};
