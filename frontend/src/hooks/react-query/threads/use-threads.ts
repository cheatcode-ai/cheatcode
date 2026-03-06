import { createQueryHook } from '@/hooks/use-query';
import { threadKeys } from './keys';
import { getThread } from '@/lib/api';
import { useAuth } from '@clerk/nextjs';
import { createLogger } from '@/lib/logger';

const logger = createLogger('threads');

// Helper function to detect network errors vs real API errors
function isNetworkError(error: unknown): boolean {
  const err = error as Record<string, unknown> | null | undefined;
  return (
    !err?.status ||
    (typeof err?.message === 'string' &&
      err.message.includes('Network error')) ||
    (typeof err?.message === 'string' &&
      err.message.includes('Failed to fetch')) ||
    err?.name === 'NetworkError' ||
    err?.code === 'NETWORK_ERROR'
  );
}

export const useThreadQuery = (threadId: string) => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();

  logger.debug('useThreadQuery - Auth State:', {
    isLoaded,
    isSignedIn,
    userId,
    threadId,
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
        if ((error as unknown as Record<string, unknown>)?.status === 404)
          return false;
        return failureCount < 2;
      },
      // Keep showing cached thread while refetching
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  )();
};
