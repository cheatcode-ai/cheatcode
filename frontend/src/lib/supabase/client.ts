import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Centralized Supabase configuration - import these instead of accessing process.env directly
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Create a basic Supabase client without authentication
export function createClient() {
  return createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

// Create a Supabase client with Clerk authentication
export function createClientWithToken(clerkToken: string) {
  const client = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    },
  })

  return client
}

// Simple helper to get the current user's Clerk ID from a token
export function getClerkUserIdFromToken(token: string): string | null {
  try {
    const parts = token.split('.')
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]))
      return payload.sub || null
    }
  } catch (error) {
    // Invalid JWT format
  }
  return null
}
