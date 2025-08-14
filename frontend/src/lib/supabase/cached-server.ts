import 'server-only';
import { cache } from 'react';
import { auth } from '@clerk/nextjs/server';
import { createClientWithToken } from '@/lib/supabase/server';

// Cached types for better type safety
export interface PersonalAccount {
  id: string;
  name: string;
  personal_account: boolean;
  primary_owner_user_id: string;
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
      console.log('[CACHED_AUTH] No user ID found');
      return null;
    }

    const supabaseToken = await getToken();
    if (!supabaseToken) {
      console.log('[CACHED_AUTH] No Supabase token found');
      return null;
    }

    const supabaseClient = createClientWithToken(supabaseToken);

    console.log('[CACHED_AUTH] Successfully created cached auth for user:', userId);
    
    return {
      userId,
      token: supabaseToken,
      supabaseClient,
    };
  } catch (error) {
    console.error('[CACHED_AUTH] Error in getCachedAuth:', error);
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
    console.log('[CACHED_SERVER] Starting getPersonalAccount...');
    
    const authResult = await getCachedAuth();
    if (!authResult) {
      return {
        account: null,
        error: 'Authentication required. Please sign in to continue.',
      };
    }

    const { userId, supabaseClient } = authResult;

    console.log('[CACHED_SERVER] Fetching personal account for user:', userId);

    const { data: accounts, error } = await supabaseClient
      .schema('basejump')
      .from('accounts')
      .select('id, name, personal_account, primary_owner_user_id, created_at, updated_at')
      .eq('id', userId)
      .eq('personal_account', true)
      .single();

    if (error) {
      console.error('[CACHED_SERVER] Database error:', error);
      return {
        account: null,
        error: 'Unable to load account information. Please try again later.',
      };
    }

    if (!accounts) {
      console.log('[CACHED_SERVER] No personal account found for user:', userId);
      return {
        account: null,
        error: 'No personal account found.',
      };
    }

    console.log('[CACHED_SERVER] Successfully retrieved personal account:', accounts.id);
    
    return {
      account: accounts as PersonalAccount,
      error: null,
    };
  } catch (error) {
    console.error('[CACHED_SERVER] Unexpected error in getPersonalAccount:', error);
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
