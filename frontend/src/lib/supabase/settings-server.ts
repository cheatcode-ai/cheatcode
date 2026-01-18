import 'server-only';
import { cache } from 'react';
import { getCachedAuth } from './cached-server';
import type { ComposioProfile } from '@/types/composio-profiles';
import { BACKEND_URL } from '@/lib/api/server-config';

// Re-export ComposioProfile type for consumers
export type { ComposioProfile };

// Types for OpenRouter key status
export interface OpenRouterKeyStatus {
  has_key: boolean;
  key_configured: boolean;
  display_name?: string;
  last_used_at?: string;
  created_at?: string;
  error?: string;
}

/**
 * Server-side cached function to fetch OpenRouter key status
 * Uses cached auth and makes authenticated backend call
 */
export const getOpenRouterKeyStatus = cache(async (): Promise<OpenRouterKeyStatus> => {
  try {
    const authResult = await getCachedAuth();
    if (!authResult) {
      return {
        has_key: false,
        key_configured: false,
        error: 'Authentication required'
      };
    }

    const { token } = authResult;

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
      // Return safe defaults instead of throwing
      return {
        has_key: false,
        key_configured: false,
        error: `Backend unavailable (${response.status})`
      };
    }

    const data = await response.json();
    return data;

  } catch (error) {
    // Return safe defaults instead of throwing
    return {
      has_key: false,
      key_configured: false,
      error: 'Service temporarily unavailable'
    };
  }
});

/**
 * Server-side cached function to fetch Composio profiles
 * Uses cached auth and makes authenticated backend call
 */
export const getComposioProfiles = cache(async (): Promise<ComposioProfile[]> => {
  try {
    const authResult = await getCachedAuth();
    if (!authResult) {
      return [];
    }

    const { token } = authResult;

    // Make authenticated call to backend API
    const url = new URL('/api/composio/profiles', BACKEND_URL);
    // Note: user_id is extracted from JWT token by the backend, no need to pass as param

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      // Return empty array instead of throwing
      return [];
    }

    const responseData = await response.json();
    // Backend returns { success: true, profiles: [...], count: number }
    const profiles = responseData.profiles || [];
    return profiles;

  } catch (error) {
    // Return empty array instead of throwing
    return [];
  }
});
