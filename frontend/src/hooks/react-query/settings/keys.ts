/**
 * TanStack React Query key factory for settings-related queries
 * Provides consistent, hierarchical query keys for all settings data
 *
 * Key Structure:
 * - ['settings'] - Root scope for all settings
 * - ['settings', 'account'] - Account-related data
 * - ['settings', 'byok'] - Bring Your Own Key data
 * - ['settings', 'integrations'] - Integration/Composio data
 * - ['settings', 'preferences'] - User preferences
 */

// Root settings key
const SETTINGS_SCOPE = 'settings' as const;

/**
 * Settings query key factory
 * Provides type-safe, consistent query keys for all settings operations
 */
export const settingsKeys = {
  // Root key for all settings queries
  all: [SETTINGS_SCOPE] as const,

  // Account-related keys
  account: {
    all: [SETTINGS_SCOPE, 'account'] as const,
    personal: () => [SETTINGS_SCOPE, 'account', 'personal'] as const,
    billing: () => [SETTINGS_SCOPE, 'account', 'billing'] as const,
    usage: () => [SETTINGS_SCOPE, 'account', 'usage'] as const,
    usageLogs: (days?: number) =>
      [SETTINGS_SCOPE, 'account', 'usage-logs', { days }] as const,
    plans: () => [SETTINGS_SCOPE, 'account', 'plans'] as const,
  },

  // BYOK (Bring Your Own Key) related keys
  byok: {
    all: [SETTINGS_SCOPE, 'byok'] as const,
    openrouter: {
      all: [SETTINGS_SCOPE, 'byok', 'openrouter'] as const,
      status: () => [SETTINGS_SCOPE, 'byok', 'openrouter', 'status'] as const,
      test: (apiKey: string) =>
        [SETTINGS_SCOPE, 'byok', 'openrouter', 'test', { apiKey }] as const,
    },
    // Future: anthropic, openai, etc.
    anthropic: {
      all: [SETTINGS_SCOPE, 'byok', 'anthropic'] as const,
      status: () => [SETTINGS_SCOPE, 'byok', 'anthropic', 'status'] as const,
    },
  },

  // Integrations/Composio related keys
  integrations: {
    all: [SETTINGS_SCOPE, 'integrations'] as const,
    composio: {
      all: [SETTINGS_SCOPE, 'integrations', 'composio'] as const,
      profiles: () =>
        [SETTINGS_SCOPE, 'integrations', 'composio', 'profiles'] as const,
      profile: (profileId: string) =>
        [
          SETTINGS_SCOPE,
          'integrations',
          'composio',
          'profile',
          profileId,
        ] as const,
      apps: () => [SETTINGS_SCOPE, 'integrations', 'composio', 'apps'] as const,
      registry: () =>
        [SETTINGS_SCOPE, 'integrations', 'composio', 'registry'] as const,
      credentials: (appSlug?: string) =>
        [
          SETTINGS_SCOPE,
          'integrations',
          'composio',
          'credentials',
          { appSlug },
        ] as const,
    },
    mcp: {
      all: [SETTINGS_SCOPE, 'integrations', 'mcp'] as const,
      servers: () =>
        [SETTINGS_SCOPE, 'integrations', 'mcp', 'servers'] as const,
      server: (serverId: string) =>
        [SETTINGS_SCOPE, 'integrations', 'mcp', 'server', serverId] as const,
    },
  },

  // User preferences and settings
  preferences: {
    all: [SETTINGS_SCOPE, 'preferences'] as const,
    theme: () => [SETTINGS_SCOPE, 'preferences', 'theme'] as const,
    notifications: () =>
      [SETTINGS_SCOPE, 'preferences', 'notifications'] as const,
    privacy: () => [SETTINGS_SCOPE, 'preferences', 'privacy'] as const,
  },

  // Real-time/live data keys
  live: {
    all: [SETTINGS_SCOPE, 'live'] as const,
    apiHealth: () => [SETTINGS_SCOPE, 'live', 'api-health'] as const,
    connectionStatus: () =>
      [SETTINGS_SCOPE, 'live', 'connection-status'] as const,
  },
} as const;

/**
 * Predefined query options for common settings queries
 * Provides consistent caching behavior across the application
 */
export const settingsQueryOptions = {
  // Standard options for most settings data
  default: {
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: true,
  },

  // Options for frequently changing data (like API status)
  live: {
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 2 * 60 * 1000, // 2 minutes
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchInterval: 60 * 1000, // Refresh every minute
  },

  // Options for rarely changing data (like plans, apps)
  static: {
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 2 * 60 * 60 * 1000, // 2 hours
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  },

  // Options for user-specific data that should be fresh
  user: {
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
    refetchOnWindowFocus: true,
    refetchOnMount: false,
    refetchOnReconnect: true,
  },

  // Context-aware options that respect RefetchControlContext
  contextAware: (refetchControl?: {
    disableWindowFocus?: boolean;
    disableMount?: boolean;
    disableReconnect?: boolean;
    disableInterval?: boolean;
  }) => ({
    staleTime: 30 * 1000,
    gcTime: 2 * 60 * 1000,
    refetchOnWindowFocus: !refetchControl?.disableWindowFocus,
    refetchOnMount: !refetchControl?.disableMount,
    refetchOnReconnect: !refetchControl?.disableReconnect,
    refetchInterval: refetchControl?.disableInterval ? false : 60 * 1000,
  }),
} as const;

/**
 * Example usage:
 *
 * // Query keys
 * const accountQuery = useQuery({
 *   queryKey: settingsKeys.account.personal(),
 *   queryFn: fetchPersonalAccount,
 *   ...settingsQueryOptions.user
 * });
 *
 * // Invalidation
 * queryClient.invalidateQueries({ queryKey: settingsKeys.byok.all });
 *
 * // Mutations
 * const saveKeyMutation = useMutation({
 *   mutationKey: [settingsMutationKeys.byok.saveKey],
 *   mutationFn: saveApiKey,
 *   onSuccess: () => {
 *     queryClient.invalidateQueries({ queryKey: settingsKeys.byok.all });
 *   }
 * });
 */
