'use client';

import React, { createContext, useContext, useCallback, useRef } from 'react';
import { useAuth, useUser } from '@clerk/nextjs';

interface AuthTokenContextType {
  getCachedToken: () => Promise<string | null>;
  invalidateTokenCache: () => void;
  isTokenCached: () => boolean;
}

interface TokenCacheEntry {
  token: string;
  timestamp: number;
  expiresAt: number;
}

const AuthTokenContext = createContext<AuthTokenContextType | undefined>(undefined);

// Token cache configuration
const TOKEN_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const TOKEN_REFRESH_THRESHOLD = 60 * 1000;   // Refresh if expires within 1 minute

interface AuthTokenProviderProps {
  children: React.ReactNode;
}

export function AuthTokenProvider({ children }: AuthTokenProviderProps) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const tokenCacheRef = useRef<TokenCacheEntry | null>(null);

  /**
   * Get a cached token or fetch a fresh one if needed
   * Implements smart caching with automatic refresh
   */
  const getCachedToken = useCallback(async (): Promise<string | null> => {
    try {
      // Check if user is properly authenticated
      if (!isLoaded || !isSignedIn) {
        console.log('[AUTH_TOKEN] User not authenticated');
        return null;
      }

      const now = Date.now();
      const cached = tokenCacheRef.current;

      // Check if we have a valid cached token
      if (cached) {
        const timeUntilExpiry = cached.expiresAt - now;
        
        // If token is still valid and not close to expiring, return it
        if (timeUntilExpiry > TOKEN_REFRESH_THRESHOLD) {
          console.log('[AUTH_TOKEN] Returning cached token (expires in', Math.round(timeUntilExpiry / 1000), 'seconds)');
          return cached.token;
        }
        
        // Token is close to expiring, log it
        if (timeUntilExpiry > 0) {
          console.log('[AUTH_TOKEN] Token expires soon, fetching fresh token');
        } else {
          console.log('[AUTH_TOKEN] Token expired, fetching fresh token');
        }
      }

      // Fetch fresh token
      console.log('[AUTH_TOKEN] Fetching fresh token from Clerk');
      const freshToken = await getToken();
      
      if (!freshToken) {
        console.log('[AUTH_TOKEN] Failed to get fresh token');
        tokenCacheRef.current = null;
        return null;
      }

      // Cache the new token
      tokenCacheRef.current = {
        token: freshToken,
        timestamp: now,
        expiresAt: now + TOKEN_CACHE_DURATION,
      };

      console.log('[AUTH_TOKEN] Successfully cached fresh token');
      return freshToken;
    } catch (error) {
      console.error('[AUTH_TOKEN] Error getting token:', error);
      tokenCacheRef.current = null;
      return null;
    }
  }, [getToken, isLoaded, isSignedIn]);

  /**
   * Manually invalidate the token cache
   * Useful for logout scenarios or when token becomes invalid
   */
  const invalidateTokenCache = useCallback(() => {
    console.log('[AUTH_TOKEN] Manually invalidating token cache');
    tokenCacheRef.current = null;
  }, []);

  /**
   * Check if we currently have a cached token
   */
  const isTokenCached = useCallback((): boolean => {
    const cached = tokenCacheRef.current;
    if (!cached) return false;

    const now = Date.now();
    const isValid = cached.expiresAt > now;
    
    return isValid;
  }, []);

  // Auto-invalidate cache when user signs out
  React.useEffect(() => {
    if (!isSignedIn) {
      invalidateTokenCache();
    }
  }, [isSignedIn, invalidateTokenCache]);

  const value: AuthTokenContextType = {
    getCachedToken,
    invalidateTokenCache,
    isTokenCached,
  };

  return (
    <AuthTokenContext.Provider value={value}>
      {children}
    </AuthTokenContext.Provider>
  );
}

/**
 * Hook to use the cached auth token
 * Provides smart token caching and automatic refresh
 */
export function useCachedAuth() {
  const context = useContext(AuthTokenContext);
  if (context === undefined) {
    throw new Error('useCachedAuth must be used within an AuthTokenProvider');
  }
  return context;
}

/**
 * Hook that combines Clerk auth with token caching
 * Drop-in replacement for useAuth() with caching benefits
 */
export function useOptimizedAuth() {
  const { isLoaded, isSignedIn, ...clerkAuth } = useAuth();
  const { user } = useUser();
  const { getCachedToken, invalidateTokenCache, isTokenCached } = useCachedAuth();

  return {
    ...clerkAuth,
    isLoaded,
    isSignedIn,
    user,
    getToken: getCachedToken,
    invalidateTokenCache,
    isTokenCached,
  };
}

/**
 * Higher-order component to wrap components that need cached auth
 */
export function withCachedAuth<P extends object>(
  Component: React.ComponentType<P>
) {
  return function CachedAuthWrapper(props: P) {
    return (
      <AuthTokenProvider>
        <Component {...props} />
      </AuthTokenProvider>
    );
  };
}

export default AuthTokenContext;
