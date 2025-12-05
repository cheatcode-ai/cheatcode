import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './client';

export const createClerkSupabaseServerClient = async () => {
  const cookieStore = await cookies();
  const { getToken } = await auth();

  let supabaseUrl = SUPABASE_URL;

  // Ensure the URL is in the proper format with http/https protocol
  if (supabaseUrl && !supabaseUrl.startsWith('http')) {
    // If it's just a hostname without protocol, add http://
    supabaseUrl = `http://${supabaseUrl}`;
  }

  return createServerClient(supabaseUrl, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set({ name, value, ...options }),
          );
        } catch (error) {
          // The `set` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
    global: {
      fetch: async (url, options: RequestInit = {}) => {
        const clerkToken = await getToken();
        
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