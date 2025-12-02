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
 * Hook to check Composio service health.
 */
export const useComposioHealthCheck = () => {
  const composioApi = useComposioApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.health(),
    queryFn: () => composioApi.getHealthCheck(),
    staleTime: 60 * 1000, // 1 minute
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

/**
 * Hook to get available categories.
 */
export const useComposioCategories = () => {
  const composioApi = useComposioApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.categories(),
    queryFn: () => composioApi.getCategories(),
    staleTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

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
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

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
 * Hook to get toolkit details.
 */
export const useComposioToolkitDetails = (slug: string, enabled = true) => {
  const composioApi = useComposioApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.toolkitDetails(slug),
    queryFn: () => composioApi.getToolkitDetails(slug),
    enabled: enabled && !!slug,
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

/**
 * Hook to get toolkit icon.
 */
export const useComposioToolkitIcon = (slug: string, enabled = true) => {
  const composioApi = useComposioApi();

  return useQuery({
    queryKey: composioKeys.toolkitIcon(slug),
    queryFn: () => composioApi.getToolkitIcon(slug),
    enabled: enabled && !!slug,
    staleTime: 60 * 60 * 1000, // 1 hour (icons rarely change)
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
};

/**
 * Hook to list tools for a toolkit.
 */
export const useComposioTools = (toolkitSlug: string, enabled = true) => {
  const composioApi = useComposioApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.tools(toolkitSlug),
    queryFn: () => composioApi.getTools(toolkitSlug),
    enabled: enabled && !!toolkitSlug,
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

/**
 * Hook to list user connections.
 */
export const useComposioConnections = (appName?: string) => {
  const composioApi = useComposioApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.connections(appName),
    queryFn: () => composioApi.getConnections(appName),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

/**
 * Hook to check connection status.
 */
export const useComposioConnectionStatus = (connectionId: string, enabled = true) => {
  const composioApi = useComposioApi();

  return useQuery({
    queryKey: composioKeys.connectionStatus(connectionId),
    queryFn: () => composioApi.getConnectionStatus(connectionId),
    enabled: enabled && !!connectionId,
    staleTime: 10 * 1000, // 10 seconds (poll frequently during OAuth)
    refetchInterval: enabled ? 3000 : false, // Poll every 3 seconds while waiting
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });
};

/**
 * Hook to create a new profile with OAuth flow.
 */
export const useCreateComposioProfile = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: (request: CreateComposioProfileRequest) => composioApi.createProfile(request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      queryClient.invalidateQueries({ queryKey: composioKeys.connections() });

      // If OAuth redirect URL is returned, open it
      if (data.redirect_url) {
        const connectWindow = window.open(data.redirect_url, '_blank', 'width=600,height=700');
        if (connectWindow) {
          // Monitor window close
          const checkClosed = setInterval(() => {
            if (connectWindow.closed) {
              clearInterval(checkClosed);
              // Refetch profiles after OAuth completes
              queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
              queryClient.invalidateQueries({ queryKey: composioKeys.connections() });
            }
          }, 1000);
          // Clear interval after 5 minutes
          setTimeout(() => clearInterval(checkClosed), 5 * 60 * 1000);
        }
      }
    },
    onError: (error) => {
      console.error('Failed to create Composio profile:', error);
    },
  });
};

/**
 * Hook to delete a connection.
 */
export const useDeleteComposioConnection = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: (connectionId: string) => composioApi.deleteConnection(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: composioKeys.connections() });
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
    },
    onError: (error) => {
      console.error('Failed to delete connection:', error);
    },
  });
};

/**
 * Hook to discover tools for a profile.
 */
export const useDiscoverComposioTools = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: (profileId: string) => composioApi.discoverTools(profileId),
    onSuccess: (data, profileId) => {
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.detail(profileId) });
    },
    onError: (error) => {
      console.error('Failed to discover tools:', error);
    },
  });
};

/**
 * Hook to update enabled tools for a profile.
 */
export const useUpdateComposioEnabledTools = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: ({ profileId, enabledTools }: { profileId: string; enabledTools: string[] }) =>
      composioApi.updateEnabledTools(profileId, enabledTools),
    onSuccess: (data, { profileId }) => {
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.detail(profileId) });
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
    },
    onError: (error) => {
      console.error('Failed to update enabled tools:', error);
    },
  });
};
