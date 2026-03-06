import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_URL,
} from '@/lib/env';

// Centralized Supabase configuration - validated at startup via env.ts
export const SUPABASE_URL = NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Create a basic Supabase client without authentication
export function createClient() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Create a Supabase client with Clerk authentication
export function createClientWithToken(clerkToken: string) {
  const client = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    },
  });

  return client;
}
