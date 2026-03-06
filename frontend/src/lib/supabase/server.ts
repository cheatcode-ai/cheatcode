import { createServerClient } from '@supabase/ssr';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './client';

// Create a client with a JWT token for user-authenticated requests
export const createClientWithToken = (token: string) => {
  let supabaseUrl = SUPABASE_URL;

  // Ensure the URL is in the proper format with http/https protocol
  if (supabaseUrl && !supabaseUrl.startsWith('http')) {
    supabaseUrl = `http://${supabaseUrl}`;
  }

  return createServerClient(supabaseUrl, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // No cookies needed when using JWT token
      },
    },
  });
};
