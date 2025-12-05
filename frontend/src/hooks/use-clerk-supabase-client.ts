import { useAuth } from '@clerk/nextjs';
import { createBrowserClient } from '@supabase/ssr';
import { useMemo } from 'react';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase/client';

// Create a singleton client instance to prevent multiple instances
let globalSupabaseClient: ReturnType<typeof createBrowserClient> | null = null;

export const useClerkSupabaseClient = () => {
  const { getToken } = useAuth();

  const supabaseClient = useMemo(() => {
    // Return existing global client if available
    if (globalSupabaseClient) {
      return globalSupabaseClient;
    }

    let supabaseUrl = SUPABASE_URL;

    // Ensure the URL is in the proper format with http/https protocol
    if (supabaseUrl && !supabaseUrl.startsWith('http')) {
      // If it's just a hostname without protocol, add http://
      supabaseUrl = `http://${supabaseUrl}`;
    }

    globalSupabaseClient = createBrowserClient(supabaseUrl, SUPABASE_ANON_KEY, {
      auth: {
        // Disable Supabase's built-in auth for third-party auth
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async (url, options: RequestInit = {}) => {
          const clerkToken = await getToken();
          
          return fetch(url, {
            ...options,
            headers: {
              ...(options.headers || {}),
              Authorization: clerkToken ? `Bearer ${clerkToken}` : '',
              // Supabase-postgrest treats text/plain body as a positional text arg.
              // Ensure JSON so 0-arg RPCs are resolved correctly.
              'Content-Type': 'application/json',
              // Remove any existing authorization header that might conflict
              'apikey': SUPABASE_ANON_KEY,
            },
          });
        },
      },
    });

    return globalSupabaseClient;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- Using singleton pattern to prevent multiple Supabase clients

  return supabaseClient;
}; 