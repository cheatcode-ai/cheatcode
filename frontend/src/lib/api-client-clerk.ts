import { createBrowserClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/client';
import { API_URL } from '@/lib/api/config';

// Create a Supabase client that can accept Clerk tokens
export const createClerkSupabaseClient = (clerkToken: string | null) => {
  let supabaseUrl = SUPABASE_URL;

  // Ensure the URL is in the proper format with http/https protocol
  if (supabaseUrl && !supabaseUrl.startsWith('http')) {
    supabaseUrl = `http://${supabaseUrl}`;
  }

  return createBrowserClient(supabaseUrl, SUPABASE_ANON_KEY, {
    global: {
      fetch: async (url, options: RequestInit = {}) => {
        return fetch(url, {
          ...options,
          headers: {
            ...(options.headers || {}),
            Authorization: clerkToken ? `Bearer ${clerkToken}` : '',
          },
        });
      },
    },
  });
};

// API client for making authenticated requests to your backend
export const createClerkApiClient = (clerkToken: string | null) => {
  
  return {
    async fetch(endpoint: string, options: RequestInit = {}) {
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
          Authorization: clerkToken ? `Bearer ${clerkToken}` : '',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    }
  };
}; 