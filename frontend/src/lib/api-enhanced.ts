import { createClerkBackendApi } from './api-client';
import { 
  CreateCheckoutSessionRequest,
  CreateCheckoutSessionResponse,

  SubscriptionStatus,
  BillingStatusResponse,
  UsageLogsResponse
} from './api';

export * from './api';

// Clerk-aware billing API factory
export const createClerkBillingApi = (getToken: () => Promise<string | null>) => {
  const clerkBackendApi = createClerkBackendApi(getToken);
  
  return {
    async getSubscription(): Promise<SubscriptionStatus | null> {
      try {
        const token = await getToken();
        if (!token) {
          // Don't log error for unauthenticated users - this is expected
          return null;
        }
        
        const result = await clerkBackendApi.get(
          '/billing/status',
          {
            errorContext: { operation: 'load subscription', resource: 'billing information' },
          }
        );

        return result.data || null;
      } catch (error) {
        throw error;
      }
    },

    async checkStatus(): Promise<BillingStatusResponse | null> {
      const result = await clerkBackendApi.get(
        '/billing/status',
        {
          errorContext: { operation: 'check billing status', resource: 'account status' },
        }
      );

      return result.data || null;
    },

    async createCheckoutSession(request: CreateCheckoutSessionRequest): Promise<CreateCheckoutSessionResponse | null> {
      const result = await clerkBackendApi.post(
        '/billing/create-checkout-session',
        request,
        {
          errorContext: { operation: 'create checkout session', resource: 'billing' },
        }
      );

      return result.data || null;
    },



    async getUsageLogs(days: number = 30): Promise<UsageLogsResponse | null> {
      const result = await clerkBackendApi.get(
        `/billing/usage-history?days=${days}`,
        {
          errorContext: { operation: 'load usage logs', resource: 'usage history' },
        }
      );

      return result.data || null;
    },
  };
}; 