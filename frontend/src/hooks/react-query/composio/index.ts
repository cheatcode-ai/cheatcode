/**
 * Composio integration hooks - exports all hooks and utilities.
 */

// Keys
export { composioKeys } from './keys';

// Utils
export { useComposioApi } from './utils';
export type {
  HealthCheckResponse,
  CategoriesResponse,
  ToolkitsResponse,
  ToolkitDetailsResponse,
  ProfilesListResponse,
  ProfileResponse,
  ToolsResponse,
  ConnectionsResponse,
  DiscoverToolsResponse,
} from './utils';

// Main hooks
export {
  useComposioHealthCheck,
  useComposioCategories,
  useComposioToolkits,
  useComposioToolkitDetails,
  useComposioToolkitIcon,
  useComposioTools,
  useComposioConnections,
  useComposioConnectionStatus,
  useCreateComposioProfile,
  useDeleteComposioConnection,
  useDiscoverComposioTools,
  useUpdateComposioEnabledTools,
} from './use-composio';

// Profile hooks
export {
  useComposioProfiles,
  useComposioProfile,
  useComposioProfileMCPConfig,
  useUpdateComposioProfile,
  useDeleteComposioProfile,
  useComposioCredentialProfiles,
  useComposioProfileMCPUrl,
  useDeleteComposioCredentialProfile,
  useBulkDeleteComposioProfiles,
  useSetComposioDefaultProfile,
  useSetCompositoDashboardDefaultProfile,
  useToggleComposioProfileActive,
  useCompositoDashboardProfiles,
  useCompositoDashboardMCPUrls,
  useUpdateCompositoDashboardDefault,
} from './use-composio-profiles';

// MCP Profile hooks (for navbar/header)
export {
  useMCPProfiles,
  useIntegrationToggle,
  useMCPProfilesWithToggle,
  mcpProfileKeys,
  type MCPCredentialProfile,
} from './use-mcp-profiles';
