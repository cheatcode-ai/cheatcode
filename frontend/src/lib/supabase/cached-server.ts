import 'server-only';
import { cache } from 'react';
import { auth } from '@clerk/nextjs/server';
import { createClientWithToken } from '@/lib/supabase/server';

// Cached types for better type safety
interface PersonalAccount {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string;
}

interface CachedAuthResult {
  userId: string;
  token: string;
  supabaseClient: ReturnType<typeof createClientWithToken>;
}

interface PersonalAccountResult {
  account: PersonalAccount | null;
  error: string | null;
}

/**
 * Cached authentication and Supabase client creation
 * This function is memoized for the duration of a single server request
 */
const getCachedAuth = cache(async (): Promise<CachedAuthResult | null> => {
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
  } catch {
    return null;
  }
});

/**
 * Cached personal account fetching
 * This function eliminates duplicate database calls across server components
 * Uses React cache() to memoize the result for the duration of a single request
 */
export const getPersonalAccount = cache(
  async (): Promise<PersonalAccountResult> => {
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
    } catch {
      return {
        account: null,
        error: 'An unexpected error occurred. Please try again.',
      };
    }
  },
);

// Types are already exported via 'export interface' declarations above
