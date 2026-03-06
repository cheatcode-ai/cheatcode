'use client';

/**
 * React Query hooks for Composio integration.
 * Handles toolkit discovery, connections, and tools.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useComposioApi } from './utils';
import { composioKeys } from './keys';
import { useRefetchControl } from '@/hooks/use-refetch-control';
import type { CreateComposioProfileRequest } from '@/types/composio-profiles';

/**
 * Hook to list available toolkits with optional filtering.
 */
export const useComposioToolkits = (params?: {
  category?: string;
  search?: string;
  cursor?: string;
  limit?: number;
}) => {
  const composioApi = useComposioApi();
  const {
    disableWindowFocus,
    disableMount,
    disableReconnect,
    disableInterval,
  } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.toolkits(1, params?.search, params?.category),
    queryFn: () => composioApi.getToolkits(params),
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

/**
 * Hook to create a new profile with OAuth flow.
 */
export const useCreateComposioProfile = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: (request: CreateComposioProfileRequest) =>
      composioApi.createProfile(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      queryClient.invalidateQueries({ queryKey: composioKeys.connections() });

      // If OAuth redirect URL is returned, open it
      if (data.redirect_url) {
        const connectWindow = window.open(
          data.redirect_url,
          '_blank',
          'width=600,height=700',
        );
        if (connectWindow) {
          // Monitor window close
          const checkClosed = setInterval(() => {
            if (connectWindow.closed) {
              clearInterval(checkClosed);
              // Refetch profiles after OAuth completes
              queryClient.invalidateQueries({
                queryKey: composioKeys.profiles.all(),
              });
              queryClient.invalidateQueries({
                queryKey: composioKeys.connections(),
              });
            }
          }, 1000);
          // Clear interval after 5 minutes
          setTimeout(() => clearInterval(checkClosed), 5 * 60 * 1000);
        }
      }
    },
    onError: () => {},
  });
};
