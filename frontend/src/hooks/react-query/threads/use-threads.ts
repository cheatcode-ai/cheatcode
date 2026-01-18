import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { Thread, updateThread, toggleThreadPublicStatus, deleteThread, updateThreadName } from "./utils";
import { getThreads, getThread } from "@/lib/api";
import { useAuth } from '@clerk/nextjs';
import { createLogger } from '@/lib/logger';

const logger = createLogger('threads');

// Helper function to detect network errors vs real API errors
function isNetworkError(error: any): boolean {
  return (
    !error?.status ||
    error?.message?.includes('Network error') ||
    error?.message?.includes('Failed to fetch') ||
    error?.name === 'NetworkError' ||
    error?.code === 'NETWORK_ERROR'
  );
}

export const useThreadQuery = (threadId: string) => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();

  logger.debug('useThreadQuery - Auth State:', {
    isLoaded,
    isSignedIn,
    userId,
    threadId
  });

  return createQueryHook(
    threadKeys.details(threadId),
    async () => {
      logger.debug('useThreadQuery - Fetching thread...');
      try {
        const token = await getToken();
        logger.debug('useThreadQuery - Got token:', !!token);
        const result = await getThread(threadId, token || undefined);
        logger.debug('useThreadQuery - Success');
        return result;
      } catch (error) {
        logger.error('useThreadQuery - Error:', error);
        throw error;
      }
    },
    {
      enabled: !!threadId && isLoaded,
      // Threads don't change often, cache for longer
      staleTime: 10 * 60 * 1000, // 10 minutes
      gcTime: 60 * 60 * 1000, // 1 hour
      retry: (failureCount, error) => {
        logger.debug('useThreadQuery - Retry attempt:', failureCount, error);
        // Allow more retries for network errors
        if (isNetworkError(error)) {
          return failureCount < 5;
        }
        // Don't retry for real 404s (thread actually doesn't exist)
        if ((error as any)?.status === 404) return false;
        return failureCount < 2;
      },
      // Keep showing cached thread while refetching
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  )();
};

export const useToggleThreadPublicStatus = () => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return createMutationHook(
    async ({
      threadId,
      isPublic,
    }: {
      threadId: string;
      isPublic: boolean;
    }) => {
      const token = await getToken();
      return toggleThreadPublicStatus(threadId, isPublic, token || undefined);
    }
  )({
    // Optimistic update for toggling public status
    onMutate: async ({ threadId, isPublic }) => {
      await queryClient.cancelQueries({ queryKey: threadKeys.details(threadId) });

      const previousThread = queryClient.getQueryData<Thread>(threadKeys.details(threadId));

      if (previousThread) {
        queryClient.setQueryData<Thread>(
          threadKeys.details(threadId),
          { ...previousThread, is_public: isPublic }
        );
      }

      return { previousThread, threadId };
    },
    onError: (_error, _variables, onMutateResult, _context) => {
      const result = onMutateResult as { previousThread?: Thread; threadId?: string } | undefined;
      if (result?.previousThread && result?.threadId) {
        queryClient.setQueryData(threadKeys.details(result.threadId), result.previousThread);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: threadKeys.details(variables.threadId) });
    },
  });
};

export const useUpdateThreadMutation = () => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return createMutationHook(
    async ({
      threadId,
      data,
    }: {
      threadId: string;
      data: Partial<Thread>,
    }) => {
      const token = await getToken();
      return updateThread(threadId, data, token || undefined);
    }
  )({
    // Optimistic update for thread data
    onMutate: async ({ threadId, data }) => {
      await queryClient.cancelQueries({ queryKey: threadKeys.details(threadId) });

      const previousThread = queryClient.getQueryData<Thread>(threadKeys.details(threadId));

      if (previousThread) {
        queryClient.setQueryData<Thread>(
          threadKeys.details(threadId),
          { ...previousThread, ...data }
        );
      }

      return { previousThread, threadId };
    },
    onError: (_error, _variables, onMutateResult, _context) => {
      const result = onMutateResult as { previousThread?: Thread; threadId?: string } | undefined;
      if (result?.previousThread && result?.threadId) {
        queryClient.setQueryData(threadKeys.details(result.threadId), result.previousThread);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: threadKeys.details(variables.threadId) });
    },
  });
};

export const useDeleteThreadMutation = () => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return createMutationHook(
    async ({ threadId }: { threadId: string }) => {
      const token = await getToken();
      return deleteThread(threadId, undefined, token || undefined);
    }
  )({
    // Optimistic update: immediately remove thread from lists
    onMutate: async ({ threadId }) => {
      await queryClient.cancelQueries({ queryKey: ['threads'] });

      // We don't have direct access to the threads list type here
      // So we'll just invalidate on settlement
      return { threadId };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      queryClient.invalidateQueries({ queryKey: ['allThreads'] });
    },
  });
};

export const useUpdateThreadNameMutation = () => {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async ({ threadId, name }: { threadId: string; name: string }) => {
      const token = await getToken();
      return updateThreadName(threadId, name, token || undefined);
    },
    // Optimistic update: immediately show new name
    onMutate: async ({ threadId, name }) => {
      await queryClient.cancelQueries({ queryKey: ['thread', threadId] });
      await queryClient.cancelQueries({ queryKey: ['threads'] });

      const previousThread = queryClient.getQueryData<Thread>(['thread', threadId]);

      if (previousThread) {
        queryClient.setQueryData<Thread>(
          ['thread', threadId],
          {
            ...previousThread,
            metadata: { ...previousThread.metadata, name }
          }
        );
      }

      return { previousThread, threadId };
    },
    onError: (error, _variables, context) => {
      logger.error('Failed to update thread name:', error);
      if (context?.previousThread && context?.threadId) {
        queryClient.setQueryData(['thread', context.threadId], context.previousThread);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['thread', variables.threadId] });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      queryClient.invalidateQueries({ queryKey: ['allThreads'] });
    },
  });
};


export const useThreadsForProject = (projectId: string) => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();

  logger.debug('useThreadsForProject - Auth State:', {
    isLoaded,
    isSignedIn,
    userId,
    projectId
  });

  return createQueryHook(
    threadKeys.byProject(projectId),
    async () => {
      logger.debug('useThreadsForProject - Fetching threads...');
      try {
        const token = await getToken();
        logger.debug('useThreadsForProject - Got token:', !!token);
        const result = await getThreads(projectId, token || undefined);
        logger.debug('useThreadsForProject - Success');
        return result;
      } catch (error) {
        logger.error('useThreadsForProject - Error:', error);
        throw error;
      }
    },
    {
      enabled: !!projectId && isLoaded,
      retry: (failureCount, error) => {
        logger.debug('useThreadsForProject - Retry attempt:', failureCount, error);
        return failureCount < 2;
      },
    }
  )();
};