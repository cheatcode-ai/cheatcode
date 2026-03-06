'use client';

/**
 * React Query hooks for Composio profile management.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useComposioApi } from './utils';
import { composioKeys } from './keys';
import { useRefetchControl } from '@/hooks/use-refetch-control';
import { toast } from 'sonner';

/**
 * Hook to list user's Composio profiles.
 */
export const useComposioProfiles = (params?: {
  toolkit_slug?: string;
  active_only?: boolean;
}) => {
  const composioApi = useComposioApi();
  const {
    disableWindowFocus,
    disableMount,
    disableReconnect,
    disableInterval,
  } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.profiles.list(params),
    queryFn: () => composioApi.getProfiles(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

/**
 * Hook to delete a profile.
 */
export const useDeleteComposioProfile = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: (profileId: string) => composioApi.deleteProfile(profileId),
    onSuccess: (_, profileId) => {
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      queryClient.removeQueries({
        queryKey: composioKeys.profiles.detail(profileId),
      });
      queryClient.removeQueries({
        queryKey: composioKeys.profiles.mcpConfig(profileId),
      });
      toast.success('Profile deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete profile');
    },
  });
};

/**
 * Hook to update profile dashboard default status.
 */
export const useUpdateCompositoDashboardDefault = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: async ({
      profileId,
      enabled,
    }: {
      profileId: string;
      enabled: boolean;
    }) => {
      return composioApi.updateProfile(profileId, {
        is_default_for_dashboard: enabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      queryClient.invalidateQueries({
        queryKey: composioKeys.secure.composioProfiles(),
      });
      queryClient.invalidateQueries({
        queryKey: composioKeys.secure.dashboardProfiles(),
      });
      queryClient.invalidateQueries({
        queryKey: composioKeys.secure.dashboardMcpUrls(),
      });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update dashboard preference');
    },
  });
};
