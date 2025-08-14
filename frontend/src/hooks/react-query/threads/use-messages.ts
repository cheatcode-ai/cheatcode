import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { addUserMessage, getMessages } from "@/lib/api";
import { useAuth } from '@clerk/nextjs';

export const useMessagesQuery = (threadId: string) => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  
  return createQueryHook(
    threadKeys.messages(threadId),
    async () => {
      const token = await getToken();
      const result = await getMessages(threadId, token || undefined);
      return result;
    },
    {
      enabled: !!threadId && isLoaded && isSignedIn,
      retry: (failureCount, error) => {
        return failureCount < 2;
      },
      staleTime: 1000 * 30, // Consider data fresh for 30 seconds
      refetchOnWindowFocus: false, // Don't refetch on every window focus
    }
  )();
};

export const useAddUserMessageMutation = () => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  
  return createMutationHook(
    async ({
      threadId,
      message,
    }: {
      threadId: string;
      message: string;
    }) => {
      const token = await getToken();
      const result = await addUserMessage(threadId, message, token || undefined);
      return result;
    }
  )();
};
