import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { getOrCreateClerkAccount } from "./utils";
import { useAuth, useUser } from '@clerk/nextjs';

export const useClerkAccountQuery = () => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();

  return createQueryHook(
    threadKeys.clerkAccount(userId || ''),
    async () => {
      if (!userId || !user) {
        throw new Error('User not authenticated');
      }

      const token = await getToken();
      const userName = user.firstName || user.username || user.emailAddresses[0]?.emailAddress || 'User';
      const result = await getOrCreateClerkAccount(userId, userName, token || undefined);
      return result;
    },
    {
      enabled: !!userId && isLoaded && isSignedIn,
      retry: (failureCount) => {
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

      const token = await getToken();
      const userName = user.firstName || user.username || user.emailAddresses[0]?.emailAddress || 'User';
      const result = await getOrCreateClerkAccount(userId, userName, token || undefined);
      return result;
    }
  )();
}; 