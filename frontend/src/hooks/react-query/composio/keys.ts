/**
 * React Query keys for Composio integration.
 */

export const composioKeys = {
  all: ['composio'] as const,
  health: () => [...composioKeys.all, 'health'] as const,
  categories: () => [...composioKeys.all, 'categories'] as const,
  toolkits: (page?: number, search?: string, category?: string) =>
    [...composioKeys.all, 'toolkits', page || 1, search || '', category || ''] as const,
  toolkitDetails: (slug: string) => [...composioKeys.all, 'toolkit', slug] as const,
  toolkitIcon: (slug: string) => [...composioKeys.all, 'toolkit-icon', slug] as const,
  tools: (toolkitSlug: string) => [...composioKeys.all, 'tools', toolkitSlug] as const,
  connections: (appName?: string) => [...composioKeys.all, 'connections', appName || ''] as const,
  connectionStatus: (connectionId: string) => [...composioKeys.all, 'connection-status', connectionId] as const,

  profiles: {
    all: () => [...composioKeys.all, 'profiles'] as const,
    list: (params?: { toolkit_slug?: string; active_only?: boolean }) =>
      [...composioKeys.profiles.all(), 'list', params?.toolkit_slug || '', params?.active_only ?? ''] as const,
    detail: (profileId: string) => [...composioKeys.profiles.all(), 'detail', profileId] as const,
    mcpConfig: (profileId: string) => [...composioKeys.profiles.all(), 'mcp-config', profileId] as const,
    grouped: () => [...composioKeys.profiles.all(), 'grouped'] as const,
  },

  secure: {
    all: () => [...composioKeys.all, 'secure'] as const,
    composioProfiles: () => [...composioKeys.secure.all(), 'composio-profiles'] as const,
    mcpUrl: (profileId: string) => [...composioKeys.secure.all(), 'mcp-url', profileId] as const,
    dashboardProfiles: () => [...composioKeys.secure.all(), 'dashboard-profiles'] as const,
    dashboardMcpUrls: () => [...composioKeys.secure.all(), 'dashboard-mcp-urls'] as const,
  },
};
