import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { addUserMessage, getMessages, Message } from "@/lib/api";
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';

export const useMessagesQuery = (threadId: string) => {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  return createQueryHook(
    threadKeys.messages(threadId),
    async () => {
      const token = await getToken();
      const result = await getMessages(threadId, token || undefined);
      return result;
    },
    {
      enabled: !!threadId && isLoaded && isSignedIn,
      retry: (failureCount) => {
        return failureCount < 2;
      },
      staleTime: 1000 * 30, // Consider data fresh for 30 seconds
      refetchOnWindowFocus: false, // Don't refetch on every window focus
    }
  )();
};

interface AddUserMessageVariables {
  threadId: string;
  message: string;
}

export const useAddUserMessageMutation = () => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return createMutationHook(
    async ({ threadId, message }: AddUserMessageVariables) => {
      const token = await getToken();
      const result = await addUserMessage(threadId, message, token || undefined);
      return result;
    }
  )({
    // Optimistic update: immediately show user message in UI
    onMutate: async ({ threadId, message }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: threadKeys.messages(threadId) });

      // Snapshot previous messages
      const previousMessages = queryClient.getQueryData<Message[]>(threadKeys.messages(threadId));

      // Create optimistic user message
      const optimisticMessage: Message = {
        role: 'user',
        content: message,
        type: 'user',
      };

      // Optimistically add the user message
      if (previousMessages) {
        queryClient.setQueryData<Message[]>(
          threadKeys.messages(threadId),
          [...previousMessages, optimisticMessage]
        );
      }

      return { previousMessages, threadId };
    },
    // Rollback on error
    onError: (_error, _variables, context: { previousMessages?: Message[]; threadId?: string } | undefined) => {
      if (context?.previousMessages && context?.threadId) {
        queryClient.setQueryData(
          threadKeys.messages(context.threadId),
          context.previousMessages
        );
      }
    },
    // Always refetch after error or success to get server state
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: threadKeys.messages(variables.threadId) });
    },
  });
};
