import { createClerkBackendApi } from '@/lib/api-client';
import { useAuth } from '@clerk/nextjs';
import { pipedreamKeys } from './keys';
import type {
  PipedreamProfile,
  CreateProfileRequest,
  UpdateProfileRequest,
  ProfileConnectionResponse,
  ProfileConnectionsResponse
} from '@/types/pipedream-profiles';

export interface CreateConnectionTokenRequest {
  app?: string;
}

export interface ConnectionTokenResponse {
  success: boolean;
  link?: string;
  token?: string;
  external_user_id: string;
  app?: string;
  expires_at?: string;
  error?: string;
}

export interface ConnectionResponse {
  success: boolean;
  connections: Array<{
    id: string;
    name: string;
    name_slug: string;
    status: string;
    connected_at: string;
    app_id?: string;
    oauth_uid?: string;
  }>;
  count: number;
  error?: string;
}

export interface HealthCheckResponse {
  status: string;
  project_id: string;
  environment: string;
  has_access_token: boolean;
  error?: string;
}

export interface TriggerWorkflowRequest {
  workflow_id: string;
  payload: Record<string, any>;
}

export interface TriggerWorkflowResponse {
  success: boolean;
  workflow_id: string;
  run_id?: string;
  status?: string;
  error?: string;
}

export interface MCPDiscoveryRequest {
  app_slug?: string;
  oauth_app_id?: string;
}

export interface MCPProfileDiscoveryRequest {
  external_user_id: string;
  app_slug?: string;
  oauth_app_id?: string;
}

export interface MCPDiscoveryResponse {
  success: boolean;
  mcp_servers: Array<{
    name: string;
    description: string;
    server_url: string;
    tools: Array<{
      name: string;
      description: string;
      input_schema?: any;
    }>;
  }>;
  count: number;
  error?: string;
}

export interface MCPConnectionRequest {
  app_slug: string;
  oauth_app_id?: string;
}

export interface MCPConnectionResponse {
  success: boolean;
  mcp_config?: {
    server_url: string;
    auth_config?: any;
  };
  error?: string;
}

export interface PipedreamApp {
  id: string;
  name: string;
  description: string;
  logo_url?: string;
  category?: string;
  oauth_app_id?: string;
  auth_type?: string;
  is_verified?: boolean;
  tags?: string[];
}

export interface PipedreamAppResponse {
  success: boolean;
  apps: PipedreamApp[];
  page_info: {
    page: number;
    per_page: number;
    total_count: number;
    total_pages: number;
    has_next_page: boolean;
    has_prev_page: boolean;
  };
  total_count: number;
}

export interface PipedreamTool {
  name: string;
  description: string;
  app: string;
  action_type: string;
  input_schema?: any;
}

export interface PipedreamToolsResponse {
  success: boolean;
  tools: PipedreamTool[];
  count: number;
  last_updated?: string;
  cache_status?: string;
}

export interface DiscoverMCPRequest {
  app_slug?: string;
  oauth_app_id?: string;
  custom?: boolean;
}

export interface DiscoverMCPResponse {
  success: boolean;
  mcp_servers: Array<{
    name: string;
    description?: string;
    server_url: string;
    tools: Array<{
      name: string;
      description?: string;
      input_schema?: any;
    }>;
    app_slug?: string;
    oauth_app_id?: string;
  }>;
  count: number;
  error?: string;
}

// Hook that provides authenticated Pipedream API
export const usePipedreamApi = () => {
  const { getToken } = useAuth();
  const api = createClerkBackendApi(getToken);

  return {
    // Connection Methods
    async createConnectionToken(request: CreateConnectionTokenRequest): Promise<ConnectionTokenResponse> {
      const result = await api.post<ConnectionTokenResponse>(
      '/pipedream/connection-token',
      request,
      {
        errorContext: { operation: 'create connection token', resource: 'Pipedream connection' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to create connection token');
    }

    return result.data!;
  },

  async getConnections(): Promise<ConnectionResponse> {
      const result = await api.get<ConnectionResponse>(
      '/pipedream/connections',
      {
          errorContext: { operation: 'get connections', resource: 'Pipedream connections' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get connections');
    }

    return result.data!;
  },

    async getHealthCheck(): Promise<HealthCheckResponse> {
      const result = await api.get<HealthCheckResponse>(
        '/pipedream/health',
        {
          errorContext: { operation: 'health check', resource: 'Pipedream service' },
      }
    );

    if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get health status');
    }

    return result.data!;
  },

    async triggerWorkflow(request: TriggerWorkflowRequest): Promise<TriggerWorkflowResponse> {
      const result = await api.post<TriggerWorkflowResponse>(
        '/pipedream/trigger-workflow',
        request,
        {
          errorContext: { operation: 'trigger workflow', resource: 'Pipedream workflow' },
      }
    );

    if (!result.success) {
        throw new Error(result.error?.message || 'Failed to trigger workflow');
    }

    return result.data!;
  },

    // MCP Discovery Methods
    async discoverMCPServers(request: MCPDiscoveryRequest = {}): Promise<MCPDiscoveryResponse> {
      const result = await api.post<MCPDiscoveryResponse>(
        '/pipedream/mcp/discover',
      request,
      {
        errorContext: { operation: 'discover MCP servers', resource: 'Pipedream MCP' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to discover MCP servers');
    }

      return result.data!;
    },

    async discoverMCPServersForProfile(request: MCPProfileDiscoveryRequest): Promise<MCPDiscoveryResponse> {
      const result = await api.post<MCPDiscoveryResponse>(
        '/pipedream/mcp/discover-profile',
        request,
        {
          errorContext: { operation: 'discover MCP servers for profile', resource: 'Pipedream MCP profile' },
        }
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to discover MCP servers for profile');
      }

      return result.data!;
    },

    async createMCPConnection(request: MCPConnectionRequest): Promise<MCPConnectionResponse> {
      const result = await api.post<MCPConnectionResponse>(
        '/pipedream/mcp/connect',
        request,
        {
          errorContext: { operation: 'create MCP connection', resource: 'Pipedream MCP connection' },
        }
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to create MCP connection');
      }

      return result.data!;
    },

    async discoverCustomMCPTools(): Promise<DiscoverMCPResponse> {
      const result = await api.post<DiscoverMCPResponse>(
        '/pipedream/mcp/discover-custom',
        {},
        {
          errorContext: { operation: 'discover custom MCP tools', resource: 'Pipedream custom MCP' },
        }
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to discover custom MCP tools');
      }

      return result.data!;
    },

    async getAvailableTools(forceRefresh = false): Promise<PipedreamToolsResponse> {
      const queryParams = forceRefresh ? '?force_refresh=true' : '';
      const result = await api.get<PipedreamToolsResponse>(
        `/pipedream/mcp/available-tools${queryParams}`,
        {
          errorContext: { operation: 'get available tools', resource: 'Pipedream tools' },
        }
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get available tools');
      }

      return result.data!;
    },

    // App Discovery
    async getApps(
      page = 1,
      search?: string,
      category?: string
    ): Promise<PipedreamAppResponse> {
      const queryParams = new URLSearchParams({ page: page.toString() });
      if (search) queryParams.append('search', search);
      if (category) queryParams.append('category', category);

      const result = await api.get<PipedreamAppResponse>(
        `/pipedream/apps?${queryParams.toString()}`,
        {
          errorContext: { operation: 'get apps', resource: 'Pipedream apps' },
        }
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to get apps');
      }

      return result.data!;
  },

  // Credential Profile Methods
  async createProfile(request: CreateProfileRequest): Promise<PipedreamProfile> {
      const result = await api.post<PipedreamProfile>(
      '/pipedream/profiles',
      request,
      {
        errorContext: { operation: 'create profile', resource: 'Pipedream credential profile' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to create profile');
    }

    return result.data!;
  },

  async getProfiles(params?: { app_slug?: string; is_active?: boolean }): Promise<PipedreamProfile[]> {
    const queryParams = new URLSearchParams();
    if (params?.app_slug) queryParams.append('app_slug', params.app_slug);
    if (params?.is_active !== undefined) queryParams.append('is_active', params.is_active.toString());

      const result = await api.get<PipedreamProfile[]>(
      `/pipedream/profiles${queryParams.toString() ? `?${queryParams.toString()}` : ''}`,
      {
        errorContext: { operation: 'get profiles', resource: 'Pipedream credential profiles' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get profiles');
    }

    return result.data!;
  },

  async getProfile(profileId: string): Promise<PipedreamProfile> {
      const result = await api.get<PipedreamProfile>(
      `/pipedream/profiles/${profileId}`,
      {
        errorContext: { operation: 'get profile', resource: 'Pipedream credential profile' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get profile');
    }

    return result.data!;
  },

  async updateProfile(profileId: string, request: UpdateProfileRequest): Promise<PipedreamProfile> {
      const result = await api.put<PipedreamProfile>(
      `/pipedream/profiles/${profileId}`,
      request,
      {
        errorContext: { operation: 'update profile', resource: 'Pipedream credential profile' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to update profile');
    }

    return result.data!;
  },

    async deleteProfile(profileId: string): Promise<{ success: boolean; message: string }> {
      const result = await api.delete<{ success: boolean; message: string }>(
      `/pipedream/profiles/${profileId}`,
      {
        errorContext: { operation: 'delete profile', resource: 'Pipedream credential profile' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to delete profile');
    }

      return result.data!;
  },

  async connectProfile(profileId: string, app?: string): Promise<ProfileConnectionResponse> {
    const queryParams = app ? `?app=${encodeURIComponent(app)}` : '';
      const result = await api.post<ProfileConnectionResponse>(
      `/pipedream/profiles/${profileId}/connect${queryParams}`,
      {},
      {
        errorContext: { operation: 'connect profile', resource: 'Pipedream credential profile' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to connect profile');
    }

    return result.data!;
  },

  async getProfileConnections(profileId: string): Promise<ProfileConnectionsResponse> {
      const result = await api.get<ProfileConnectionsResponse>(
      `/pipedream/profiles/${profileId}/connections`,
      {
        errorContext: { operation: 'get profile connections', resource: 'Pipedream profile connections' },
      }
    );

    if (!result.success) {
      throw new Error(result.error?.message || 'Failed to get profile connections');
    }

    return result.data!;
    },
  };
};

// Legacy pipedreamApi object for backward compatibility
// This will be deprecated in favor of usePipedreamApi hook
export const pipedreamApi = {
  // Connection Methods
  async createConnectionToken(request: CreateConnectionTokenRequest): Promise<ConnectionTokenResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async getConnections(): Promise<ConnectionResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async getHealthCheck(): Promise<HealthCheckResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async triggerWorkflow(request: TriggerWorkflowRequest): Promise<TriggerWorkflowResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  // MCP Discovery Methods
  async discoverMCPServers(request: MCPDiscoveryRequest = {}): Promise<MCPDiscoveryResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async discoverMCPServersForProfile(request: MCPProfileDiscoveryRequest): Promise<MCPDiscoveryResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async createMCPConnection(request: MCPConnectionRequest): Promise<MCPConnectionResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async discoverCustomMCPTools(): Promise<DiscoverMCPResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async getAvailableTools(forceRefresh = false): Promise<PipedreamToolsResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  // App Discovery
  async getApps(
    page = 1,
    search?: string,
    category?: string
  ): Promise<PipedreamAppResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  // Credential Profile Methods
  async createProfile(request: CreateProfileRequest): Promise<PipedreamProfile> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async getProfiles(params?: { app_slug?: string; is_active?: boolean }): Promise<PipedreamProfile[]> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async getProfile(profileId: string): Promise<PipedreamProfile> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async updateProfile(profileId: string, request: UpdateProfileRequest): Promise<PipedreamProfile> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async deleteProfile(profileId: string): Promise<{ success: boolean; message: string }> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async connectProfile(profileId: string, app?: string): Promise<ProfileConnectionResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },

  async getProfileConnections(profileId: string): Promise<ProfileConnectionsResponse> {
    throw new Error('Use usePipedreamApi hook instead of pipedreamApi object');
  },
}; 