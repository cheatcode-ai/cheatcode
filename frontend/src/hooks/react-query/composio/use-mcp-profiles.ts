'use client';

/**
 * Hook for managing MCP credential profiles in navbar/header components.
 * Consolidated from navbar.tsx and thread-site-header.tsx
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { createClerkBackendApi } from '@/lib/api-client';
import { toast } from 'sonner';

export interface MCPCredentialProfile {
  profile_id: string;
  mcp_qualified_name: string;
  display_name: string;
  is_default_for_dashboard: boolean;
  is_active: boolean;
}

export const mcpProfileKeys = {
  all: ['mcp-credential-profiles'] as const,
};

/**
 * Hook to fetch MCP credential profiles
 */
export function useMCPProfiles(enabled = true) {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: mcpProfileKeys.all,
    queryFn: async () => {
      const apiClient = createClerkBackendApi(getToken);
      const response = await apiClient.get('/composio/profiles');
      const profiles = response.data?.profiles;
      return Array.isArray(profiles) ? profiles : [];
    },
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to toggle integration dashboard default status
 * Provides mutation and local loading state management
 */
export function useIntegrationToggle() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [updatingProfileId, setUpdatingProfileId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ profileId, isDefault }: { profileId: string; isDefault: boolean }) => {
      const apiClient = createClerkBackendApi(getToken);
      await apiClient.put(`/composio/profiles/${profileId}`, {
        is_default_for_dashboard: isDefault,
      });
      return { profileId, isDefault };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(mcpProfileKeys.all, (old: MCPCredentialProfile[] | undefined) => {
        return old?.map(profile =>
          profile.profile_id === data.profileId
            ? { ...profile, is_default_for_dashboard: data.isDefault }
            : profile
        ) || [];
      });
      const action = data.isDefault ? 'enabled' : 'disabled';
      toast.success(`${action.charAt(0).toUpperCase() + action.slice(1)} integration for chats`);
    },
    onError: (error) => {
      console.error('Error updating integration:', error);
      toast.error('Failed to update integration setting');
    },
    onSettled: () => {
      setUpdatingProfileId(null);
    },
  });

  const toggleIntegration = useCallback(async (profileId: string, currentValue: boolean) => {
    setUpdatingProfileId(profileId);
    await mutation.mutateAsync({
      profileId,
      isDefault: !currentValue,
    });
  }, [mutation]);

  return {
    toggleIntegration,
    isUpdating: updatingProfileId,
    isUpdatingProfile: (profileId: string) => updatingProfileId === profileId,
  };
}

/**
 * Combined hook for MCP profiles with toggle functionality
 * Convenient wrapper that provides both query and mutation
 */
export function useMCPProfilesWithToggle(enabled = true) {
  const profilesQuery = useMCPProfiles(enabled);
  const toggle = useIntegrationToggle();

  // Ensure mcpProfiles is always an array
  const mcpProfiles = Array.isArray(profilesQuery.data) ? profilesQuery.data : [];

  // Count of active dashboard integrations
  const activeCount = mcpProfiles.filter(p => p.is_default_for_dashboard).length;

  return {
    mcpProfiles,
    activeCount,
    isLoading: profilesQuery.isLoading,
    error: profilesQuery.error,
    ...toggle,
  };
}
