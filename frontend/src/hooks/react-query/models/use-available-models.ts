'use client';

import { createQueryHook } from '@/hooks/use-query';
import { getAvailableModels, ModelsResponse } from '@/lib/api/models';

export const modelKeys = {
  all: ['models'] as const,
  available: ['models', 'available'] as const,
};

export const useAvailableModelsQuery = (enabled = true) => {
  return createQueryHook<ModelsResponse>(
    modelKeys.available,
    async () => {
      return getAvailableModels();
    },
    {
      enabled,
      retry: 1,
      staleTime: 1000 * 60 * 30, // 30 minutes (models don't change often)
      gcTime: 1000 * 60 * 60,    // 1 hour
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
    }
  )();
};
