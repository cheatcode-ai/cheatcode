export const pipedreamKeys = {
  all: ['pipedream'] as const,
  connections: () => [...pipedreamKeys.all, 'connections'] as const,
  // connectionToken removed - single-use tokens should not be cached
  health: () => [...pipedreamKeys.all, 'health'] as const,
  config: () => [...pipedreamKeys.all, 'config'] as const,
  workflows: () => [...pipedreamKeys.all, 'workflows'] as const,
  workflowRuns: (workflowId: string) => [...pipedreamKeys.all, 'workflow-runs', workflowId] as const,
  apps: (page: number, search?: string, category?: string) => [...pipedreamKeys.all, 'apps', page, search || '', category || ''] as const,
  appsSearch: (query: string, page: number, category?: string) => [...pipedreamKeys.all, 'apps', 'search', query, page, category || ''] as const,
  availableTools: () => [...pipedreamKeys.all, 'available-tools'] as const,
  mcpDiscovery: (options?: { app_slug?: string; oauth_app_id?: string; custom?: boolean }) => 
    [...pipedreamKeys.all, 'mcp-discovery', options?.app_slug, options?.oauth_app_id, options?.custom] as const,
  
  profiles: {
    all: () => [...pipedreamKeys.all, 'profiles'] as const,
    list: (params?: { app_slug?: string; is_active?: boolean }) => 
      [...pipedreamKeys.profiles.all(), 'list', params?.app_slug || '', params?.is_active ?? ''] as const,
    detail: (profileId: string) => [...pipedreamKeys.profiles.all(), 'detail', profileId] as const,
    connections: (profileId: string) => [...pipedreamKeys.profiles.all(), 'connections', profileId] as const,
  }
}; 