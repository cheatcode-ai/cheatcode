import { createClient as createSupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey)

// Default client function for backward compatibility
export function createClient() {
  return createSupabaseClient(supabaseUrl, supabaseAnonKey)
}

// Create a Supabase client with Clerk authentication
export function createClientWithToken(clerkToken: string) {
  console.log('Creating Supabase client with Clerk token:', clerkToken ? 'present' : 'missing')
  
  const client = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    },
  })
  
  // Add debug logging for JWT parsing
  if (clerkToken) {
    try {
      const parts = clerkToken.split('.')
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]))
        console.log('JWT payload:', payload)
        console.log('Clerk user ID from JWT:', payload.sub)
      }
    } catch (error) {
      console.error('Error parsing JWT:', error)
    }
  }
  
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
    console.error('Error parsing JWT for user ID:', error)
  }
  return null
}
