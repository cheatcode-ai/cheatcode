import 'server-only';
import { cache } from 'react';
import { getCachedAuth } from './cached-server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// Types for OpenRouter key status
export interface OpenRouterKeyStatus {
  has_key: boolean;
  key_configured: boolean;
  display_name?: string;
  last_used_at?: string;
  created_at?: string;
  error?: string;
}

// Types for Pipedream profiles  
export interface PipedreamProfile {
  profile_id: string;
  account_id: string;
  mcp_qualified_name: string;
  profile_name: string;
  display_name: string;
  is_active: boolean;
  is_default: boolean;
  is_default_for_dashboard: boolean;
  enabled_tools: string[];
  app_slug: string;
  app_name: string;
  is_connected: boolean;
}

/**
 * Server-side cached function to fetch OpenRouter key status
 * Uses cached auth and makes authenticated backend call
 */
export const getOpenRouterKeyStatus = cache(async (): Promise<OpenRouterKeyStatus> => {
  console.log('[SERVER] Fetching OpenRouter key status');
  
  try {
    const authResult = await getCachedAuth();
    if (!authResult) {
      console.log('[SERVER] No auth available for OpenRouter key status');
      return {
        has_key: false,
        key_configured: false,
        error: 'Authentication required'
      };
    }

    const { userId, token } = authResult;
    
    // Make authenticated call to backend API
    const url = new URL('/api/billing/openrouter-key/status', BACKEND_URL);
    // Note: user_id is extracted from JWT token by the backend, no need to pass as param
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.log(`[SERVER] OpenRouter key status fetch failed: ${response.status}`);
      // Return safe defaults instead of throwing
      return {
        has_key: false,
        key_configured: false,
        error: `Backend unavailable (${response.status})`
      };
    }

    const data = await response.json();
    console.log('[SERVER] OpenRouter key status fetched successfully');
    return data;

  } catch (error) {
    console.error('[SERVER] Error fetching OpenRouter key status:', error);
    // Return safe defaults instead of throwing
    return {
      has_key: false,
      key_configured: false,
      error: 'Service temporarily unavailable'
    };
  }
});

/**
 * Server-side cached function to fetch Pipedream profiles
 * Uses cached auth and makes authenticated backend call
 */
export const getPipedreamProfiles = cache(async (): Promise<PipedreamProfile[]> => {
  console.log('[SERVER] Fetching Pipedream profiles');
  
  try {
    const authResult = await getCachedAuth();
    if (!authResult) {
      console.log('[SERVER] No auth available for Pipedream profiles');
      return [];
    }

    const { userId, token } = authResult;
    
    // Make authenticated call to backend API
    const url = new URL('/api/pipedream/profiles', BACKEND_URL);
    // Note: user_id is extracted from JWT token by the backend, no need to pass as param
    
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      console.log(`[SERVER] Pipedream profiles fetch failed: ${response.status}`);
      // Return empty array instead of throwing
      return [];
    }

    const responseData = await response.json();
    const profiles = responseData.data || responseData || [];
    
    console.log(`[SERVER] Pipedream profiles fetched successfully: ${profiles.length} profiles`);
    return profiles;

  } catch (error) {
    console.error('[SERVER] Error fetching Pipedream profiles:', error);
    // Return empty array instead of throwing
    return [];
  }
});
