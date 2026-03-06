import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOptimizedAuth } from '@/contexts/AuthTokenContext';
import { settingsKeys, settingsQueryOptions } from './keys';

// Types for OpenRouter API responses
interface OpenRouterKeyStatus {
  has_key: boolean;
  key_configured: boolean;
  display_name?: string;
  last_used_at?: string;
  created_at?: string;
  error?: string;
}

interface SaveKeyRequest {
  api_key: string;
  display_name: string;
}

/**
 * Hook to get OpenRouter API key status on the client side
 * 🚀 OPTIMIZED: Reads from server-hydrated cache - NO network requests needed!
 *
 * Architecture:
 * 1. Server layout calls getOpenRouterKeyStatus() and prefetches into QueryClient
 * 2. Data is dehydrated and sent to client via HydrationBoundary
 * 3. This hook reads the hydrated data instantly from cache
 * 4. Fallback queryFn only used if server prefetch failed
 *
 * Ideal:    Client hook → Reads hydrated cache → Instant data
 * Fallback: Client hook → queryFn API call → Backend (if cache empty)
 */
export function useOpenRouterKeyStatus(enabled = true) {
  const { getToken, isLoaded, isSignedIn } = useOptimizedAuth();

  return useQuery<OpenRouterKeyStatus, Error>({
    queryKey: settingsKeys.byok.openrouter.status(),
    queryFn: async (): Promise<OpenRouterKeyStatus> => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch('/api/billing/openrouter-key/status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    },
    enabled: enabled && isLoaded && isSignedIn,
    ...settingsQueryOptions.user,
    staleTime: 2 * 60 * 1000, // 2 minutes - key status can change
    retry: 2, // Allow retries for fallback scenario
  });
}

/**
 * Hook to save OpenRouter API key
 * Includes optimistic updates for instant UX and automatic cache invalidation
 */
export function useSaveOpenRouterKey() {
  const { getToken } = useOptimizedAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      request: SaveKeyRequest,
    ): Promise<{ success: boolean }> => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch('/api/billing/openrouter-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.detail || errorData.error || 'Failed to save API key',
        );
      }

      return response.json();
    },
    onMutate: async (newKeyData) => {
      // Cancel any outgoing refetches to avoid conflicts
      await queryClient.cancelQueries({
        queryKey: settingsKeys.byok.openrouter.status(),
      });

      // Snapshot the previous value
      const previousStatus = queryClient.getQueryData<OpenRouterKeyStatus>(
        settingsKeys.byok.openrouter.status(),
      );

      // Optimistically update to show key as saved
      queryClient.setQueryData<OpenRouterKeyStatus>(
        settingsKeys.byok.openrouter.status(),
        (old) => ({
          ...old,
          has_key: true,
          key_configured: true,
          display_name: newKeyData.display_name,
          created_at: new Date().toISOString(),
          last_used_at: undefined, // Will be set on first use
          error: undefined,
        }),
      );

      return { previousStatus };
    },
    onError: (_err, _newKeyData, context) => {
      // Rollback optimistic update on error
      if (context?.previousStatus) {
        queryClient.setQueryData(
          settingsKeys.byok.openrouter.status(),
          context.previousStatus,
        );
      }
    },
    onSuccess: () => {
      // Invalidate and refetch to ensure we have the latest server data
      queryClient.invalidateQueries({
        queryKey: settingsKeys.byok.openrouter.all,
      });
    },
    mutationKey: ['save-openrouter-key'],
  });
}

/**
 * Hook to delete OpenRouter API key
 * Includes optimistic updates and automatic cache invalidation
 */
export function useDeleteOpenRouterKey() {
  const { getToken } = useOptimizedAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<{ success: boolean }> => {
      const token = await getToken();
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch('/api/billing/openrouter-key', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.detail || errorData.error || 'Failed to remove API key',
        );
      }

      return response.json();
    },
    onMutate: async () => {
      // Optimistically update the cache
      await queryClient.cancelQueries({
        queryKey: settingsKeys.byok.openrouter.status(),
      });

      // Get the previous value
      const previousStatus = queryClient.getQueryData<OpenRouterKeyStatus>(
        settingsKeys.byok.openrouter.status(),
      );

      // Optimistically update to show key as removed
      if (previousStatus) {
        queryClient.setQueryData<OpenRouterKeyStatus>(
          settingsKeys.byok.openrouter.status(),
          {
            ...previousStatus,
            has_key: false,
            key_configured: false,
            display_name: undefined,
            last_used_at: undefined,
            created_at: undefined,
          },
        );
      }

      return { previousStatus };
    },
    onError: (_err, _variables, context) => {
      // Rollback optimistic update on error
      if (context?.previousStatus) {
        queryClient.setQueryData(
          settingsKeys.byok.openrouter.status(),
          context.previousStatus,
        );
      }
    },
    onSuccess: () => {
      // Ensure we have the latest data
      queryClient.invalidateQueries({
        queryKey: settingsKeys.byok.openrouter.all,
      });
    },
    mutationKey: ['delete-openrouter-key'],
  });
}
