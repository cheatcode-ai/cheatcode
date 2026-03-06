'use client';

import { useState } from 'react';
import {
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from '@tanstack/react-query';
import { handleApiError } from '@/lib/error-handler';

export function ReactQueryProvider({
  children,
  dehydratedState,
}: {
  children: React.ReactNode;
  dehydratedState?: DehydratedState;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Increase stale time to 5 minutes for better offline experience
            staleTime: 5 * 60 * 1000,
            // Keep data in cache for 30 minutes
            gcTime: 30 * 60 * 1000,
            retry: (failureCount, error: unknown) => {
              const err = error as Record<string, unknown> | null;
              // Don't retry on authentication or permission errors
              if (err?.status === 401 || err?.status === 403) return false;
              // Don't retry on real 404s (but allow retries for network errors that appear as 404s)
              // eslint-disable-next-line react-hooks/immutability
              if (err?.status === 404 && !isNetworkError(err)) return false;
              // Retry up to 3 times for network errors
              return failureCount < 3;
            },
            // Reduce aggressive refetching for better offline experience
            refetchOnMount: false,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            // React Query serves cached data while refetching by default
          },
          mutations: {
            retry: (failureCount, error: unknown) => {
              const err = error as Record<string, unknown> | null;
              // Don't retry client errors except network issues
              if (
                (err?.status as number) >= 400 &&
                (err?.status as number) < 500 &&
                !isNetworkError(err)
              )
                return false;
              return failureCount < 2;
            },
            onError: (error: Error, _variables: unknown, _context: unknown) => {
              // Only show error toasts for non-network errors
              if (!isNetworkError(error)) {
                handleApiError(error, {
                  operation: 'perform action',
                  silent: false,
                });
              }
            },
          },
        },
      }),
  );

  // Helper function to detect network errors vs real API errors
  function isNetworkError(error: unknown): boolean {
    const err = error as Record<string, unknown> | null;
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

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>
        {children}
        {/* {process.env.NODE_ENV !== 'production' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )} */}
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
