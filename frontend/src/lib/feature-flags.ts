import React from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { API_URL } from './api/config';

export interface FeatureFlag {
  flag_name: string;
  enabled: boolean;
  details?: {
    description?: string;
    updated_at?: string;
  } | null;
}

export interface FeatureFlagsResponse {
  flags: Record<string, boolean>;
}

const flagCache = new Map<string, { value: boolean; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000;

let globalFlagsCache: { flags: Record<string, boolean>; timestamp: number } | null = null;

export class FeatureFlagManager {
  private static instance: FeatureFlagManager;
  
  private constructor() {}
  
  static getInstance(): FeatureFlagManager {
    if (!FeatureFlagManager.instance) {
      FeatureFlagManager.instance = new FeatureFlagManager();
    }
    return FeatureFlagManager.instance;
  }

  async isEnabled(flagName: string): Promise<boolean> {
    try {
      const cached = flagCache.get(flagName);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.value;
      }
      const response = await fetch(`${API_URL}/feature-flags/${flagName}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        console.warn(`Failed to fetch feature flag ${flagName}: ${response.status}`);
        return false;
      }
      
      const data: FeatureFlag = await response.json();
      
      flagCache.set(flagName, {
        value: data.enabled,
        timestamp: Date.now(),
      });
      
      return data.enabled;
    } catch (error) {
      console.error(`Error checking feature flag ${flagName}:`, error);
      return false;
    }
  }
  
  async getFlagDetails(flagName: string): Promise<FeatureFlag | null> {
    try {
      const response = await fetch(`${API_URL}/feature-flags/${flagName}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        console.warn(`Failed to fetch feature flag details for ${flagName}: ${response.status}`);
        return null;
      }
      
      const data: FeatureFlag = await response.json();
      return data;
    } catch (error) {
      console.error(`Error fetching feature flag details for ${flagName}:`, error);
      return null;
    }
  }
  
  async getAllFlags(): Promise<Record<string, boolean>> {
    try {
      if (globalFlagsCache && Date.now() - globalFlagsCache.timestamp < CACHE_DURATION) {
        return globalFlagsCache.flags;
      }
      
      const response = await fetch(`${API_URL}/feature-flags`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (!response.ok) {
        console.warn(`Failed to fetch all feature flags: ${response.status}`);
        return {};
      }
      
      const data: FeatureFlagsResponse = await response.json();
      globalFlagsCache = {
        flags: data.flags,
        timestamp: Date.now(),
      };
      
      Object.entries(data.flags).forEach(([flagName, enabled]) => {
        flagCache.set(flagName, {
          value: enabled,
          timestamp: Date.now(),
        });
      });
      
      return data.flags;
    } catch (error) {
      console.error('Error fetching all feature flags:', error);
      return {};
    }
  }

  clearCache(): void {
    flagCache.clear();
    globalFlagsCache = null;
  }

  async preloadFlags(flagNames: string[]): Promise<void> {
    try {
      const promises = flagNames.map(flagName => this.isEnabled(flagName));
      await Promise.all(promises);
    } catch (error) {
      console.error('Error preloading feature flags:', error);
    }
  }
}

const featureFlagManager = FeatureFlagManager.getInstance();

export const isEnabled = (flagName: string): Promise<boolean> => {
  // Short-circuit if feature flags are disabled globally
  const flagsEnabled = process.env.NEXT_PUBLIC_FEATURE_FLAGS_ENABLED === 'true';
  if (!flagsEnabled) {
    return Promise.resolve(false);
  }
  
  return featureFlagManager.isEnabled(flagName);
};

export const isFlagEnabled = isEnabled;

export const getFlagDetails = (flagName: string): Promise<FeatureFlag | null> => {
  // Short-circuit if feature flags are disabled globally
  const flagsEnabled = process.env.NEXT_PUBLIC_FEATURE_FLAGS_ENABLED === 'true';
  if (!flagsEnabled) {
    return Promise.resolve(null);
  }
  
  return featureFlagManager.getFlagDetails(flagName);
};

export const getAllFlags = (): Promise<Record<string, boolean>> => {
  // Short-circuit if feature flags are disabled globally
  const flagsEnabled = process.env.NEXT_PUBLIC_FEATURE_FLAGS_ENABLED === 'true';
  if (!flagsEnabled) {
    return Promise.resolve({});
  }
  
  return featureFlagManager.getAllFlags();
};

export const clearFlagCache = (): void => {
  featureFlagManager.clearCache();
};

export const preloadFlags = (flagNames: string[]): Promise<void> => {
  return featureFlagManager.preloadFlags(flagNames);
};

// React Query key factories
export const featureFlagKeys = {
  all: ['feature-flags'] as const,
  flag: (flagName: string) => [...featureFlagKeys.all, 'flag', flagName] as const,
  flagDetails: (flagName: string) => [...featureFlagKeys.all, 'details', flagName] as const,
  allFlags: () => [...featureFlagKeys.all, 'allFlags'] as const,
};

// Query functions
const fetchFeatureFlag = async (flagName: string): Promise<boolean> => {
  const response = await fetch(`${API_URL}/feature-flags/${flagName}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch feature flag ${flagName}: ${response.status}`);
  }
  
  const data: FeatureFlag = await response.json();
  return data.enabled;
};

const fetchFeatureFlagDetails = async (flagName: string): Promise<FeatureFlag> => {
  const response = await fetch(`${API_URL}/feature-flags/${flagName}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch feature flag details for ${flagName}: ${response.status}`);
  }
  
  const data: FeatureFlag = await response.json();
  return data;
};

const fetchAllFeatureFlags = async (): Promise<Record<string, boolean>> => {
  const response = await fetch(`${API_URL}/feature-flags`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch all feature flags: ${response.status}`);
  }
  
  const data: FeatureFlagsResponse = await response.json();
  return data.flags;
};

// React Query Hooks
export const useFeatureFlag = (flagName: string, options?: {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  refetchOnWindowFocus?: boolean;
}) => {
  // Check if feature flags are disabled globally
  const flagsEnabled = process.env.NEXT_PUBLIC_FEATURE_FLAGS_ENABLED === 'true';

  const query = useQuery({
    queryKey: featureFlagKeys.flag(flagName),
    queryFn: () => fetchFeatureFlag(flagName),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5 minutes
    gcTime: options?.gcTime ?? 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? false,
    enabled: flagsEnabled && (options?.enabled ?? true), // Disable query if flags are globally disabled
    retry: (failureCount, error) => {
      // Don't retry on 4xx errors, but retry on network errors
      if (error instanceof Error && error.message.includes('4')) {
        return false;
      }
      return failureCount < 3;
    },
    meta: {
      errorMessage: `Failed to fetch feature flag: ${flagName}`,
    },
  });

  // If feature flags are disabled globally, return a static disabled state
  if (!flagsEnabled) {
    return {
      enabled: false, // Always return false if the system is off
      loading: false,
      error: null,
      // Add React Query properties to maintain the same interface shape
      data: false,
      isSuccess: true,
      isError: false,
      isLoading: false,
      isFetching: false,
      isRefetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      errorUpdatedAt: 0,
      failureCount: 0,
      failureReason: null,
      fetchStatus: 'idle' as const,
      status: 'success' as const,
    };
  }

  return {
    enabled: query.data ?? false,
    loading: query.isLoading,
    error: query.error?.message ?? null,
    ...query,
  };
};

export const useFeatureFlagDetails = (flagName: string, options?: {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
}) => {
  // Check if feature flags are disabled globally
  const flagsEnabled = process.env.NEXT_PUBLIC_FEATURE_FLAGS_ENABLED === 'true';

  const query = useQuery({
    queryKey: featureFlagKeys.flagDetails(flagName),
    queryFn: () => fetchFeatureFlagDetails(flagName),
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5 minutes
    gcTime: options?.gcTime ?? 10 * 60 * 1000, // 10 minutes
    enabled: flagsEnabled && (options?.enabled ?? true), // Disable query if flags are globally disabled
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('4')) {
        return false;
      }
      return failureCount < 3;
    },
  });

  // If feature flags are disabled globally, return a static disabled state
  if (!flagsEnabled) {
    return {
      data: null,
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
      isFetching: false,
      isRefetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      errorUpdatedAt: 0,
      failureCount: 0,
      failureReason: null,
      fetchStatus: 'idle' as const,
      status: 'success' as const,
    };
  }

  return query;
};

export const useAllFeatureFlags = (options?: {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
}) => {
  // Check if feature flags are disabled globally
  const flagsEnabled = process.env.NEXT_PUBLIC_FEATURE_FLAGS_ENABLED === 'true';

  const query = useQuery({
    queryKey: featureFlagKeys.allFlags(),
    queryFn: fetchAllFeatureFlags,
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5 minutes
    gcTime: options?.gcTime ?? 10 * 60 * 1000, // 10 minutes
    enabled: flagsEnabled && (options?.enabled ?? true), // Disable query if flags are globally disabled
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('4')) {
        return false;
      }
      return failureCount < 3;
    },
  });

  // If feature flags are disabled globally, return a static disabled state
  if (!flagsEnabled) {
    return {
      data: {},
      isLoading: false,
      isError: false,
      error: null,
      isSuccess: true,
      isFetching: false,
      isRefetching: false,
      isStale: false,
      dataUpdatedAt: Date.now(),
      errorUpdatedAt: 0,
      failureCount: 0,
      failureReason: null,
      fetchStatus: 'idle' as const,
      status: 'success' as const,
    };
  }

  return query;
};

export const useFeatureFlags = (flagNames: string[], options?: {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
}) => {
  // Check if feature flags are disabled globally
  const flagsEnabled = process.env.NEXT_PUBLIC_FEATURE_FLAGS_ENABLED === 'true';

  const queries = useQueries({
    queries: flagNames.map((flagName) => ({
      queryKey: featureFlagKeys.flag(flagName),
      queryFn: () => fetchFeatureFlag(flagName),
      staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5 minutes
      gcTime: options?.gcTime ?? 10 * 60 * 1000, // 10 minutes
      enabled: flagsEnabled && (options?.enabled ?? true), // Disable queries if flags are globally disabled
      retry: (failureCount: number, error: Error) => {
        if (error.message.includes('4')) {
          return false;
        }
        return failureCount < 3;
      },
    })),
  });

  // Transform the results into a more convenient format
  const flags = React.useMemo(() => {
    if (!flagsEnabled) {
      // Create a flags object where every requested flag is set to false
      return flagNames.reduce((acc, name) => {
        acc[name] = false;
        return acc;
      }, {} as Record<string, boolean>);
    }

    const result: Record<string, boolean> = {};
    flagNames.forEach((flagName, index) => {
      const query = queries[index];
      result[flagName] = query.data ?? false;
    });
    return result;
  }, [queries, flagNames, flagsEnabled]);

  const loading = queries.some(query => query.isLoading);
  const error = queries.find(query => query.error)?.error?.message ?? null;

  return { flags, loading, error };
};
