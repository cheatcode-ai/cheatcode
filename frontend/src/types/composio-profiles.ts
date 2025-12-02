/**
 * TypeScript types for Composio integration profiles.
 * Mirrors the backend Composio profile models.
 */

export interface ComposioProfile {
  profile_id: string;
  user_id: string;
  toolkit_slug: string;
  profile_name: string;
  display_name: string;
  connected_account_id: string;
  mcp_qualified_name: string;
  is_active: boolean;
  is_default: boolean;
  is_default_for_dashboard: boolean;
  is_connected: boolean;  // Mirrors is_active - Composio manages actual connection state
  enabled_tools: string[];
  created_at?: string | null;
  updated_at?: string | null;
  last_used_at?: string | null;
}

export interface CreateComposioProfileRequest {
  toolkit_slug: string;
  profile_name: string;
  display_name?: string;
  redirect_url?: string;
  initiation_params?: Record<string, any>;
  use_custom_auth?: boolean;
  custom_auth_config?: Record<string, any>;
}

export interface CreateComposioProfileResponse {
  success: boolean;
  profile_id: string;
  redirect_url?: string;
  connection_id?: string;
  message: string;
}

export interface UpdateComposioProfileRequest {
  profile_name?: string;
  display_name?: string;
  is_active?: boolean;
  is_default?: boolean;
  is_default_for_dashboard?: boolean;
  enabled_tools?: string[];
}

export interface ComposioToolkit {
  slug: string;
  name: string;
  description: string;
  icon_url?: string;
  categories: string[];
  auth_schemes: string[];
  supported_auth_type: string;
  enabled: boolean;
  tool_count: number;
  custom_auth_supported: boolean;
  initiation_fields: ComposioInitiationField[];
}

export interface ComposioInitiationField {
  name: string;
  display_name: string;
  description: string;
  field_type: string;
  required: boolean;
  default_value?: string;
}

export interface ComposioTool {
  name: string;
  description?: string;
  input_schema: Record<string, any>;
  enabled: boolean;
}

export interface ComposioConnectionStatus {
  id: string;
  status: string;
  connected_account_id?: string;
  error?: string;
}

export interface ComposioMCPConfig {
  mcp_url: string;
  app_name: string;
  enabled_tools: string[];
}

export interface ToolkitWithProfiles {
  toolkit_slug: string;
  toolkit_name: string;
  profiles: ComposioProfile[];
  profile_count: number;
}

export interface CredentialProfilesResponse {
  success: boolean;
  toolkits: ToolkitWithProfiles[];
  total_profiles: number;
}

export interface MCPUrlResponse {
  success: boolean;
  mcp_url: string;
  profile_id: string;
  profile_name: string;
  toolkit_slug: string;
}
