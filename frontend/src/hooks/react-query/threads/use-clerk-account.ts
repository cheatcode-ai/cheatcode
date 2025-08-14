import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { getOrCreateClerkAccount } from "./utils";
import { useAuth, useUser } from '@clerk/nextjs';

export const useClerkAccountQuery = () => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();
  
  console.log('[DEBUG] useClerkAccountQuery - Auth State:', {
    isLoaded,
    isSignedIn,
    userId,
    userName: user?.firstName || user?.username || 'Unknown'
  });
  
  return createQueryHook(
    threadKeys.clerkAccount(userId || ''),
    async () => {
      if (!userId || !user) {
        throw new Error('User not authenticated');
      }
      
      console.log('[DEBUG] useClerkAccountQuery - Creating/getting account...');
      try {
        const token = await getToken();
        console.log('[DEBUG] useClerkAccountQuery - Got token:', !!token);
        
        const userName = user.firstName || user.username || user.emailAddresses[0]?.emailAddress || 'User';
        const result = await getOrCreateClerkAccount(userId, userName, token || undefined);
        console.log('[DEBUG] useClerkAccountQuery - Success');
        return result;
      } catch (error) {
        console.error('[DEBUG] useClerkAccountQuery - Error:', error);
        throw error;
      }
    },
    {
      enabled: !!userId && isLoaded && isSignedIn,
      retry: (failureCount, error) => {
        console.log('[DEBUG] useClerkAccountQuery - Retry attempt:', failureCount, error);
        return failureCount < 2;
      },
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  )();
};

export const useCreateClerkAccountMutation = () => {
  const { getToken, userId } = useAuth();
  const { user } = useUser();
  
  return createMutationHook(
    async () => {
      if (!userId || !user) {
        throw new Error('User not authenticated');
      }
      
      console.log('[DEBUG] useCreateClerkAccountMutation - Creating account...');
      try {
        const token = await getToken();
        console.log('[DEBUG] useCreateClerkAccountMutation - Got token:', !!token);
        
        const userName = user.firstName || user.username || user.emailAddresses[0]?.emailAddress || 'User';
        const result = await getOrCreateClerkAccount(userId, userName, token || undefined);
        console.log('[DEBUG] useCreateClerkAccountMutation - Success');
        return result;
      } catch (error) {
        console.error('[DEBUG] useCreateClerkAccountMutation - Error:', error);
        throw error;
      }
    }
  )();
}; 