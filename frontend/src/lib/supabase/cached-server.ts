import 'server-only';
import { cache } from 'react';
import { auth } from '@clerk/nextjs/server';
import { createClientWithToken } from '@/lib/supabase/server';

// Cached types for better type safety
export interface PersonalAccount {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

export interface CachedAuthResult {
  userId: string;
  token: string;
  supabaseClient: ReturnType<typeof createClientWithToken>;
}

export interface PersonalAccountResult {
  account: PersonalAccount | null;
  error: string | null;
}

/**
 * Cached authentication and Supabase client creation
 * This function is memoized for the duration of a single server request
 */
export const getCachedAuth = cache(async (): Promise<CachedAuthResult | null> => {
  try {
    const { getToken, userId } = await auth();

    if (!userId) {
      return null;
    }

    const supabaseToken = await getToken();
    if (!supabaseToken) {
      return null;
    }

    const supabaseClient = createClientWithToken(supabaseToken);

    return {
      userId,
      token: supabaseToken,
      supabaseClient,
    };
  } catch (error) {
    return null;
  }
});

/**
 * Cached personal account fetching
 * This function eliminates duplicate database calls across server components
 * Uses React cache() to memoize the result for the duration of a single request
 */
export const getPersonalAccount = cache(async (): Promise<PersonalAccountResult> => {
  try {
    const authResult = await getCachedAuth();
    if (!authResult) {
      return {
        account: null,
        error: 'Authentication required. Please sign in to continue.',
      };
    }

    const { userId, supabaseClient } = authResult;

    const { data: accounts, error } = await supabaseClient
      .from('users')
      .select('id, name, email, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error) {
      return {
        account: null,
        error: 'Unable to load account information. Please try again later.',
      };
    }

    if (!accounts) {
      return {
        account: null,
        error: 'No personal account found.',
      };
    }

    return {
      account: accounts as PersonalAccount,
      error: null,
    };
  } catch (error) {
    return {
      account: null,
      error: 'An unexpected error occurred. Please try again.',
    };
  }
});

/**
 * Cached Supabase client getter
 * Useful for components that need the client but not necessarily the account data
 */
export const getCachedSupabaseClient = cache(async () => {
  const authResult = await getCachedAuth();
  return authResult?.supabaseClient || null;
});

/**
 * Cached user ID getter
 * Useful for components that only need the user ID
 */
export const getCachedUserId = cache(async (): Promise<string | null> => {
  const authResult = await getCachedAuth();
  return authResult?.userId || null;
});



// Types are already exported via 'export interface' declarations above
