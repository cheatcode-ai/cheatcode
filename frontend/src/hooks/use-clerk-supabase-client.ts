import { useAuth } from '@clerk/nextjs';
import { createBrowserClient } from '@supabase/ssr';
import { useMemo } from 'react';

export const useClerkSupabaseClient = () => {
  const { getToken } = useAuth();

  const supabaseClient = useMemo(() => {
    let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    // Ensure the URL is in the proper format with http/https protocol
    if (supabaseUrl && !supabaseUrl.startsWith('http')) {
      // If it's just a hostname without protocol, add http://
      supabaseUrl = `http://${supabaseUrl}`;
    }

    return createBrowserClient(supabaseUrl, supabaseAnonKey, {
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
              'apikey': supabaseAnonKey,
            },
          });
        },
      },
    });
  }, [getToken]);

  return supabaseClient;
}; 