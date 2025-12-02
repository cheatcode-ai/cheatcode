/**
 * Composio API utilities and hook.
 * Provides authenticated API calls for Composio integration.
 */

import { createClerkBackendApi } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';
import type {
  ComposioProfile,
  CreateComposioProfileRequest,
  CreateComposioProfileResponse,
  UpdateComposioProfileRequest,
  ComposioToolkit,
  ComposioTool,
  ComposioConnectionStatus,
  ComposioMCPConfig,
  CredentialProfilesResponse,
  MCPUrlResponse,
} from '@/types/composio-profiles';

// Response types
export interface HealthCheckResponse {
  status: string;
  api_key_configured: boolean;
  error?: string;
}

export interface CategoriesResponse {
  success: boolean;
  categories: string[];
}

export interface ToolkitsResponse {
  success: boolean;
  toolkits: ComposioToolkit[];
  next_cursor?: string;
  total: number;
}

export interface ToolkitDetailsResponse {
  success: boolean;
  toolkit: ComposioToolkit;
}

export interface ProfilesListResponse {
  success: boolean;
  profiles: ComposioProfile[];
  count: number;
}

export interface ProfileResponse {
  success: boolean;
  profile: ComposioProfile;
}

export interface ToolsResponse {
  success: boolean;
  tools: ComposioTool[];
  count: number;
}

export interface ConnectionsResponse {
  success: boolean;
  connections: Array<{
    id: string;
    app_name: string;
    status: string;
    created_at?: string;
  }>;
  count: number;
}

export interface DiscoverToolsResponse {
  success: boolean;
  tools: ComposioTool[];
  count: number;
  mcp_url: string;
}

/**
 * Hook that provides authenticated Composio API.
 */
export const useComposioApi = () => {
  const { getToken } = useAuth();
  const api = createClerkBackendApi(getToken);

  return {
    // Health & Status
    async getHealthCheck(): Promise<HealthCheckResponse> {
      const result = await api.get<HealthCheckResponse>('/composio/health', {
        errorContext: { operation: 'health check', resource: 'Composio service' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get health status');
      }
      return result.data!;
    },

    // Categories
    async getCategories(): Promise<CategoriesResponse> {
      const result = await api.get<CategoriesResponse>('/composio/categories', {
        errorContext: { operation: 'get categories', resource: 'Composio categories' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get categories');
      }
      return result.data!;
    },

    // Toolkits
    async getToolkits(params?: {
      category?: string;
      search?: string;
      cursor?: string;
      limit?: number;
    }): Promise<ToolkitsResponse> {
      const queryParams = new URLSearchParams();
      if (params?.category) queryParams.append('category', params.category);
      if (params?.search) queryParams.append('search', params.search);
      if (params?.cursor) queryParams.append('cursor', params.cursor);
      if (params?.limit) queryParams.append('limit', params.limit.toString());

      const result = await api.get<ToolkitsResponse>(
        `/composio/toolkits${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
        {
          errorContext: { operation: 'get toolkits', resource: 'Composio toolkits' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get toolkits');
      }
      return result.data!;
    },

    async getToolkitDetails(slug: string): Promise<ToolkitDetailsResponse> {
      const result = await api.get<ToolkitDetailsResponse>(`/composio/toolkits/${slug}/details`, {
        errorContext: { operation: 'get toolkit details', resource: 'Composio toolkit' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get toolkit details');
      }
      return result.data!;
    },

    async getToolkitIcon(slug: string): Promise<{ success: boolean; icon_url: string }> {
      const result = await api.get<{ success: boolean; icon_url: string }>(
        `/composio/toolkits/${slug}/icon`,
        {
          errorContext: { operation: 'get toolkit icon', resource: 'Composio toolkit icon' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get toolkit icon');
      }
      return result.data!;
    },

    // Profiles
    async getProfiles(params?: { toolkit_slug?: string }): Promise<ComposioProfile[]> {
      const queryParams = new URLSearchParams();
      if (params?.toolkit_slug) queryParams.append('toolkit_slug', params.toolkit_slug);

      const result = await api.get<ProfilesListResponse>(
        `/composio/profiles${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
        {
          errorContext: { operation: 'get profiles', resource: 'Composio profiles' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get profiles');
      }
      return result.data!.profiles;
    },

    async getProfile(profileId: string): Promise<ComposioProfile> {
      const result = await api.get<ProfileResponse>(`/composio/profiles/${profileId}`, {
        errorContext: { operation: 'get profile', resource: 'Composio profile' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get profile');
      }
      return result.data!.profile;
    },

    async checkNameAvailability(
      toolkitSlug: string,
      profileName: string
    ): Promise<{ success: boolean; available: boolean }> {
      const queryParams = new URLSearchParams({
        toolkit_slug: toolkitSlug,
        profile_name: profileName,
      });
      const result = await api.get<{ success: boolean; available: boolean }>(
        `/composio/profiles/check-name-availability?${queryParams.toString()}`,
        {
          errorContext: { operation: 'check name availability', resource: 'Composio profile name' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to check name availability');
      }
      return result.data!;
    },

    async createProfile(
      request: CreateComposioProfileRequest
    ): Promise<CreateComposioProfileResponse> {
      const result = await api.post<CreateComposioProfileResponse>('/composio/profiles', request, {
        errorContext: { operation: 'create profile', resource: 'Composio profile' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to create profile');
      }
      return result.data!;
    },

    async updateProfile(
      profileId: string,
      request: UpdateComposioProfileRequest
    ): Promise<ComposioProfile> {
      const result = await api.put<{ success: boolean; profile: ComposioProfile }>(
        `/composio/profiles/${profileId}`,
        request,
        {
          errorContext: { operation: 'update profile', resource: 'Composio profile' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to update profile');
      }
      return result.data!.profile;
    },

    async deleteProfile(profileId: string): Promise<{ success: boolean; message: string }> {
      const result = await api.delete<{ success: boolean; message: string }>(
        `/composio/profiles/${profileId}`,
        {
          errorContext: { operation: 'delete profile', resource: 'Composio profile' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to delete profile');
      }
      return result.data!;
    },

    async getMCPConfig(profileId: string): Promise<ComposioMCPConfig> {
      const result = await api.get<{ success: boolean } & ComposioMCPConfig>(
        `/composio/profiles/${profileId}/mcp-config`,
        {
          errorContext: { operation: 'get MCP config', resource: 'Composio MCP config' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get MCP config');
      }
      return result.data!;
    },

    // Tools
    async getTools(toolkitSlug: string, limit?: number): Promise<ComposioTool[]> {
      const queryParams = new URLSearchParams({ toolkit_slug: toolkitSlug });
      if (limit) queryParams.append('limit', limit.toString());

      const result = await api.get<ToolsResponse>(`/composio/tools/list?${queryParams.toString()}`, {
        errorContext: { operation: 'get tools', resource: 'Composio tools' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get tools');
      }
      return result.data!.tools;
    },

    async discoverTools(profileId: string): Promise<DiscoverToolsResponse> {
      const result = await api.post<DiscoverToolsResponse>(
        `/composio/discover-tools/${profileId}`,
        {},
        {
          errorContext: { operation: 'discover tools', resource: 'Composio tools' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to discover tools');
      }
      return result.data!;
    },

    async updateEnabledTools(
      profileId: string,
      enabledTools: string[]
    ): Promise<{ success: boolean; enabled_tools: string[] }> {
      const result = await api.put<{ success: boolean; enabled_tools: string[] }>(
        `/composio/profiles/${profileId}/tools`,
        enabledTools,
        {
          errorContext: { operation: 'update enabled tools', resource: 'Composio profile tools' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to update enabled tools');
      }
      return result.data!;
    },

    // Connections
    async getConnectionStatus(connectionId: string): Promise<ComposioConnectionStatus> {
      const result = await api.get<{ success: boolean } & ComposioConnectionStatus>(
        `/composio/connections/status/${connectionId}`,
        {
          errorContext: { operation: 'get connection status', resource: 'Composio connection' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get connection status');
      }
      return result.data!;
    },

    async getConnections(appName?: string): Promise<ConnectionsResponse> {
      const queryParams = appName ? `?app_name=${encodeURIComponent(appName)}` : '';
      const result = await api.get<ConnectionsResponse>(`/composio/connections${queryParams}`, {
        errorContext: { operation: 'get connections', resource: 'Composio connections' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get connections');
      }
      return result.data!;
    },

    async deleteConnection(connectionId: string): Promise<{ success: boolean; message: string }> {
      const result = await api.delete<{ success: boolean; message: string }>(
        `/composio/connections/${connectionId}`,
        {
          errorContext: { operation: 'delete connection', resource: 'Composio connection' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to delete connection');
      }
      return result.data!;
    },

    // Secure MCP API
    async getComposioProfiles(): Promise<CredentialProfilesResponse> {
      const result = await api.get<CredentialProfilesResponse>('/composio-secure/composio-profiles', {
        errorContext: { operation: 'get composio profiles', resource: 'Secure MCP profiles' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get composio profiles');
      }
      return result.data!;
    },

    async getProfileMCPUrl(profileId: string): Promise<MCPUrlResponse> {
      const result = await api.get<MCPUrlResponse>(
        `/composio-secure/composio-profiles/${profileId}/mcp-url`,
        {
          errorContext: { operation: 'get profile MCP URL', resource: 'Secure MCP URL' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get profile MCP URL');
      }
      return result.data!;
    },

    async deleteCredentialProfile(
      profileId: string
    ): Promise<{ success: boolean; message: string }> {
      const result = await api.delete<{ success: boolean; message: string }>(
        `/composio-secure/credential-profiles/${profileId}`,
        {
          errorContext: { operation: 'delete credential profile', resource: 'Secure MCP profile' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to delete credential profile');
      }
      return result.data!;
    },

    async bulkDeleteProfiles(
      profileIds: string[]
    ): Promise<{ success: boolean; deleted_count: number; requested_count: number }> {
      const result = await api.post<{
        success: boolean;
        deleted_count: number;
        requested_count: number;
      }>('/composio-secure/credential-profiles/bulk-delete', { profile_ids: profileIds }, {
        errorContext: { operation: 'bulk delete profiles', resource: 'Secure MCP profiles' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to bulk delete profiles');
      }
      return result.data!;
    },

    async setDefaultProfile(profileId: string): Promise<{ success: boolean; message: string }> {
      const result = await api.put<{ success: boolean; message: string }>(
        `/composio-secure/credential-profiles/${profileId}/set-default`,
        {},
        {
          errorContext: { operation: 'set default profile', resource: 'Secure MCP profile' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to set default profile');
      }
      return result.data!;
    },

    async setDashboardDefaultProfile(
      profileId: string
    ): Promise<{ success: boolean; message: string }> {
      const result = await api.put<{ success: boolean; message: string }>(
        `/composio-secure/credential-profiles/${profileId}/set-dashboard-default`,
        {},
        {
          errorContext: {
            operation: 'set dashboard default profile',
            resource: 'Secure MCP profile',
          },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to set dashboard default profile');
      }
      return result.data!;
    },

    async toggleProfileActive(
      profileId: string,
      isActive: boolean
    ): Promise<{ success: boolean; profile_id: string; is_active: boolean }> {
      const result = await api.put<{ success: boolean; profile_id: string; is_active: boolean }>(
        `/composio-secure/credential-profiles/${profileId}/toggle-active?is_active=${isActive}`,
        {},
        {
          errorContext: { operation: 'toggle profile active', resource: 'Secure MCP profile' },
        }
      );
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to toggle profile active status');
      }
      return result.data!;
    },

    async getDashboardProfiles(): Promise<{
      success: boolean;
      profiles: ComposioProfile[];
      count: number;
    }> {
      const result = await api.get<{
        success: boolean;
        profiles: ComposioProfile[];
        count: number;
      }>('/composio-secure/dashboard-profiles', {
        errorContext: { operation: 'get dashboard profiles', resource: 'Secure MCP profiles' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get dashboard profiles');
      }
      return result.data!;
    },

    async getDashboardMCPUrls(): Promise<{
      success: boolean;
      mcp_configs: Array<{
        profile_id: string;
        profile_name: string;
        toolkit_slug: string;
        mcp_url: string;
        enabled_tools: string[];
      }>;
      count: number;
    }> {
      const result = await api.get<{
        success: boolean;
        mcp_configs: Array<{
          profile_id: string;
          profile_name: string;
          toolkit_slug: string;
          mcp_url: string;
          enabled_tools: string[];
        }>;
        count: number;
      }>('/composio-secure/dashboard-mcp-urls', {
        errorContext: { operation: 'get dashboard MCP URLs', resource: 'Secure MCP URLs' },
      });
      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get dashboard MCP URLs');
      }
      return result.data!;
    },
  };
};
