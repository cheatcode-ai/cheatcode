export interface PipedreamProfile {
  profile_id: string;
  account_id: string;
  mcp_qualified_name: string;
  profile_name: string;
  display_name: string;
  encrypted_config: string;
  config_hash: string;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  last_used_at?: string;
  app_slug: string;
  app_name: string;
  external_user_id: string;
  is_connected: boolean;
  enabled_tools: string[];
}

export interface CreateProfileRequest {
  profile_name: string;
  app_slug: string;
  app_name: string;
  description?: string;
  is_default?: boolean;
  oauth_app_id?: string;
  enabled_tools?: string[];
}

export interface UpdateProfileRequest {
  profile_name?: string;
  display_name?: string;
  is_active?: boolean;
  is_default?: boolean;
  enabled_tools?: string[];
}

export interface ProfileConnectionResponse {
  success: boolean;
  link?: string;
  token?: string;
  profile_id: string;
  external_user_id: string;
  app: string;
}

export interface ProfileConnectionsResponse {
  success: boolean;
  connections: any[];
  count: number;
} 