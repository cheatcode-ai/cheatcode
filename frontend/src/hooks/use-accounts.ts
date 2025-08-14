import useSWR, { SWRConfiguration } from 'swr';
import { useClerkSupabaseClient } from './use-clerk-supabase-client';
import { useAuth } from '@clerk/nextjs';

type Account = {
  id: string;
  account_id: string;
  name: string;
  slug: string;
  personal_account: boolean;
  created_at: string;
  updated_at: string;
  primary_owner_user_id: string;
  public_metadata?: any;
  private_metadata?: any;
};

type GetAccountsResponse = Account[];

export const useAccounts = (options?: SWRConfiguration) => {
  const { isLoaded, isSignedIn } = useAuth();
  const supabaseClient = useClerkSupabaseClient();
  
  return useSWR<GetAccountsResponse>(
    isLoaded && isSignedIn ? ['accounts'] : null,
    async () => {
      const { data, error } = await supabaseClient.rpc('get_accounts', {});

      if (error) {
        throw new Error(error.message);
      }

      return data;
    },
    {
      ...options,
      // Only fetch when user is authenticated
      revalidateIfStale: isLoaded && isSignedIn,
      revalidateOnMount: isLoaded && isSignedIn,
    },
  );
};
