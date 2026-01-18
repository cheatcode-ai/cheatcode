'use client';

import { createQueryHook } from '@/hooks/use-query';
import { checkApiHealth } from '@/lib/api';
import { healthKeys } from '../files/keys';

export const useApiHealth = createQueryHook(
  healthKeys.api(),
  checkApiHealth,
  {
    staleTime: 5 * 60 * 1000, // 5 minutes - API health doesn't change frequently
    refetchInterval: false, // No wasteful background polling
    refetchOnWindowFocus: true, // Smart: check when user returns to tab
    retry: 1, // Reduced from 3 to 1 for faster failure (health check is non-blocking now)
  }
); 