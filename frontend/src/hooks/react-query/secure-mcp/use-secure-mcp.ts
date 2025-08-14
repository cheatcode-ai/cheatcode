import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@clerk/nextjs';

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';

// =====================================================
// TYPES
// =====================================================

export interface MCPCredential {
  credential_id: string;
  mcp_qualified_name: string;
  display_name: string;
  config_keys: string[];
  is_active: boolean;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export interface StoreCredentialRequest {
  mcp_qualified_name: string;
  display_name: string;
  config: Record<string, any>;
}

export interface TestCredentialResponse {
  success: boolean;
  message: string;
  error_details?: string;
}



export interface MCPRequirement {
  qualified_name: string;
  display_name: string;
  enabled_tools: string[];
  required_config: string[];
  custom_type?: 'sse' | 'http'; // For custom MCP servers
}







// =====================================================
// CREDENTIAL MANAGEMENT HOOKS
// =====================================================

export function useUserCredentials() {
  const { getToken } = useAuth();
  
  return useQuery({
    queryKey: ['secure-mcp', 'credentials'],
    queryFn: async (): Promise<MCPCredential[]> => {
      const token = await getToken();

      if (!token) {
        throw new Error('You must be logged in to view credentials');
      }

      const response = await fetch(`${API_URL}/secure-mcp/credentials`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    },
  });
}

export function useStoreCredential() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (request: StoreCredentialRequest): Promise<MCPCredential> => {
      const token = await getToken();

      if (!token) {
        throw new Error('You must be logged in to store credentials');
      }

      const response = await fetch(`${API_URL}/secure-mcp/credentials`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secure-mcp', 'credentials'] });
    },
  });
}

export function useDeleteCredential() {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async (mcp_qualified_name: string): Promise<void> => {
      const token = await getToken();

      if (!token) {
        throw new Error('You must be logged in to delete credentials');
      }

      const response = await fetch(`${API_URL}/secure-mcp/credentials/${encodeURIComponent(mcp_qualified_name)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secure-mcp', 'credentials'] });
    },
  });
}















 