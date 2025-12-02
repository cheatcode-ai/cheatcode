'use client';

/**
 * React Query hooks for Composio profile management.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useComposioApi } from './utils';
import { composioKeys } from './keys';
import { useRefetchControl } from '@/hooks/use-refetch-control';
import { toast } from 'sonner';
import type { UpdateComposioProfileRequest } from '@/types/composio-profiles';

/**
 * Hook to list user's Composio profiles.
 */
export const useComposioProfiles = (params?: { toolkit_slug?: string; active_only?: boolean }) => {
  const composioApi = useComposioApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

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
 * Hook to get a single profile.
 */
export const useComposioProfile = (profileId: string, enabled = true) => {
  const composioApi = useComposioApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.profiles.detail(profileId),
    queryFn: () => composioApi.getProfile(profileId),
    enabled: enabled && !!profileId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

/**
 * Hook to get profile MCP config.
 */
export const useComposioProfileMCPConfig = (profileId: string, enabled = true) => {
  const composioApi = useComposioApi();

  return useQuery({
    queryKey: composioKeys.profiles.mcpConfig(profileId),
    queryFn: () => composioApi.getMCPConfig(profileId),
    enabled: enabled && !!profileId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchOnReconnect: false,
  });
};

/**
 * Hook to update a profile.
 */
export const useUpdateComposioProfile = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: ({
      profileId,
      request,
    }: {
      profileId: string;
      request: UpdateComposioProfileRequest;
    }) => composioApi.updateProfile(profileId, request),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.detail(data.profile_id) });
      toast.success(`Profile "${data.profile_name}" updated successfully`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update profile');
    },
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
      queryClient.removeQueries({ queryKey: composioKeys.profiles.detail(profileId) });
      queryClient.removeQueries({ queryKey: composioKeys.profiles.mcpConfig(profileId) });
      toast.success('Profile deleted successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete profile');
    },
  });
};

/**
 * Hook to get credential profiles grouped by toolkit (secure API).
 */
export const useComposioCredentialProfiles = () => {
  const composioApi = useComposioApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.secure.composioProfiles(),
    queryFn: () => composioApi.getComposioProfiles(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

/**
 * Hook to get profile MCP URL (secure API).
 */
export const useComposioProfileMCPUrl = (profileId: string, enabled = true) => {
  const composioApi = useComposioApi();

  return useQuery({
    queryKey: composioKeys.secure.mcpUrl(profileId),
    queryFn: () => composioApi.getProfileMCPUrl(profileId),
    enabled: enabled && !!profileId,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchOnReconnect: false,
  });
};

/**
 * Hook to delete credential profile (secure API).
 */
export const useDeleteComposioCredentialProfile = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: (profileId: string) => composioApi.deleteCredentialProfile(profileId),
    onSuccess: (_, profileId) => {
      queryClient.invalidateQueries({ queryKey: composioKeys.secure.composioProfiles() });
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      queryClient.removeQueries({ queryKey: composioKeys.secure.mcpUrl(profileId) });
      toast.success('Integration removed successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove integration');
    },
  });
};

/**
 * Hook to bulk delete profiles (secure API).
 */
export const useBulkDeleteComposioProfiles = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: (profileIds: string[]) => composioApi.bulkDeleteProfiles(profileIds),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: composioKeys.secure.composioProfiles() });
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      toast.success(`Deleted ${data.deleted_count} integrations`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete integrations');
    },
  });
};

/**
 * Hook to set default profile (secure API).
 */
export const useSetComposioDefaultProfile = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: (profileId: string) => composioApi.setDefaultProfile(profileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: composioKeys.secure.composioProfiles() });
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      toast.success('Default profile updated');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set default profile');
    },
  });
};

/**
 * Hook to set dashboard default profile (secure API).
 */
export const useSetCompositoDashboardDefaultProfile = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: (profileId: string) => composioApi.setDashboardDefaultProfile(profileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: composioKeys.secure.composioProfiles() });
      queryClient.invalidateQueries({ queryKey: composioKeys.secure.dashboardProfiles() });
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      toast.success('Dashboard default updated');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to set dashboard default');
    },
  });
};

/**
 * Hook to toggle profile active status (secure API).
 */
export const useToggleComposioProfileActive = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: ({ profileId, isActive }: { profileId: string; isActive: boolean }) =>
      composioApi.toggleProfileActive(profileId, isActive),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: composioKeys.secure.composioProfiles() });
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      toast.success(data.is_active ? 'Integration enabled' : 'Integration disabled');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to toggle integration status');
    },
  });
};

/**
 * Hook to get dashboard profiles (secure API).
 */
export const useCompositoDashboardProfiles = () => {
  const composioApi = useComposioApi();
  const { disableWindowFocus, disableMount, disableReconnect, disableInterval } = useRefetchControl();

  return useQuery({
    queryKey: composioKeys.secure.dashboardProfiles(),
    queryFn: () => composioApi.getDashboardProfiles(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: !disableWindowFocus,
    refetchOnMount: !disableMount,
    refetchOnReconnect: !disableReconnect,
    refetchInterval: disableInterval ? false : undefined,
  });
};

/**
 * Hook to get dashboard MCP URLs (secure API).
 */
export const useCompositoDashboardMCPUrls = (enabled = true) => {
  const composioApi = useComposioApi();

  return useQuery({
    queryKey: composioKeys.secure.dashboardMcpUrls(),
    queryFn: () => composioApi.getDashboardMCPUrls(),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    refetchOnReconnect: false,
  });
};

/**
 * Hook to update profile dashboard default status.
 */
export const useUpdateCompositoDashboardDefault = () => {
  const queryClient = useQueryClient();
  const composioApi = useComposioApi();

  return useMutation({
    mutationFn: async ({ profileId, enabled }: { profileId: string; enabled: boolean }) => {
      return composioApi.updateProfile(profileId, {
        is_default_for_dashboard: enabled,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: composioKeys.profiles.all() });
      queryClient.invalidateQueries({ queryKey: composioKeys.secure.composioProfiles() });
      queryClient.invalidateQueries({ queryKey: composioKeys.secure.dashboardProfiles() });
      queryClient.invalidateQueries({ queryKey: composioKeys.secure.dashboardMcpUrls() });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update dashboard preference');
    },
  });
};
