import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { Thread, updateThread, toggleThreadPublicStatus, deleteThread, updateThreadName } from "./utils";
import { getThreads, getThread } from "@/lib/api";
import { useAuth } from '@clerk/nextjs';

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
  
  console.log('[DEBUG] useThreadQuery - Auth State:', {
    isLoaded,
    isSignedIn,
    userId,
    threadId
  });
  
  return createQueryHook(
    threadKeys.details(threadId),
    async () => {
      console.log('[DEBUG] useThreadQuery - Fetching thread...');
      try {
        const token = await getToken();
        console.log('[DEBUG] useThreadQuery - Got token:', !!token);
        const result = await getThread(threadId, token || undefined);
        console.log('[DEBUG] useThreadQuery - Success');
        return result;
      } catch (error) {
        console.error('[DEBUG] useThreadQuery - Error:', error);
        throw error;
      }
    },
    {
      enabled: !!threadId && isLoaded,
      // Threads don't change often, cache for longer
      staleTime: 10 * 60 * 1000, // 10 minutes
      gcTime: 60 * 60 * 1000, // 1 hour
      retry: (failureCount, error) => {
        console.log('[DEBUG] useThreadQuery - Retry attempt:', failureCount, error);
        // Allow more retries for network errors
        if (isNetworkError(error)) {
          return failureCount < 5;
        }
        // Don't retry for real 404s (thread actually doesn't exist)
        if (error?.status === 404) return false;
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
  )();
};

export const useUpdateThreadMutation = () => {
  const { getToken } = useAuth();
  
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
  )();
};

export const useDeleteThreadMutation = () => {
  const { getToken } = useAuth();
  
  return createMutationHook(
    async ({ threadId }: { threadId: string }) => {
      const token = await getToken();
      return deleteThread(threadId, undefined, token || undefined);
    }
  )();
};

export const useUpdateThreadNameMutation = () => {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();

  return useMutation({
    mutationFn: async ({ threadId, name }: { threadId: string; name: string }) => {
      const token = await getToken();
      return updateThreadName(threadId, name, token || undefined);
    },
    onSuccess: (data, variables) => {
      // Invalidate and refetch thread queries
      queryClient.invalidateQueries({ queryKey: ['thread', variables.threadId] });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      queryClient.invalidateQueries({ queryKey: ['allThreads'] });
    },
    onError: (error) => {
      console.error('Failed to update thread name:', error);
    },
  });
};


export const useThreadsForProject = (projectId: string) => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  
  console.log('[DEBUG] useThreadsForProject - Auth State:', {
    isLoaded,
    isSignedIn,
    userId,
    projectId
  });
  
  return createQueryHook(
    threadKeys.byProject(projectId),
    async () => {
      console.log('[DEBUG] useThreadsForProject - Fetching threads...');
      try {
        const token = await getToken();
        console.log('[DEBUG] useThreadsForProject - Got token:', !!token);
        const result = await getThreads(projectId, token || undefined);
        console.log('[DEBUG] useThreadsForProject - Success');
        return result;
      } catch (error) {
        console.error('[DEBUG] useThreadsForProject - Error:', error);
        throw error;
      }
    },
    {
      enabled: !!projectId && isLoaded,
      retry: (failureCount, error) => {
        console.log('[DEBUG] useThreadsForProject - Retry attempt:', failureCount, error);
        return failureCount < 2;
      },
    }
  )();
};