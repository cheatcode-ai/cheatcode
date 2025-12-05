/**
 * Centralized hook for authentication token management.
 * Use this hook in React Query hooks to reduce duplication.
 */

import { useAuth } from '@clerk/nextjs';

export interface AuthTokenResult {
  /** Get the authentication token */
  getToken: () => Promise<string | null>;
  /** Whether the auth state is loaded and user is signed in */
  isReady: boolean;
  /** Convenience flag for React Query's `enabled` option */
  shouldFetch: boolean;
}

/**
 * Hook for managing authentication state in data fetching.
 *
 * @param enabled - Optional flag to conditionally enable fetching (default: true)
 * @returns Authentication state and token getter
 *
 * @example
 * ```tsx
 * const { getToken, shouldFetch } = useAuthToken(enabled);
 *
 * const query = useQuery({
 *   queryKey: ['data'],
 *   queryFn: async () => {
 *     const token = await getToken();
 *     return fetchData(token);
 *   },
 *   enabled: shouldFetch,
 * });
 * ```
 */
export function useAuthToken(enabled = true): AuthTokenResult {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  return {
    getToken,
    isReady: isLoaded && !!isSignedIn,
    shouldFetch: enabled && isLoaded && !!isSignedIn,
  };
}
