import { createQueryKeys } from '@/hooks/use-query';

export const subscriptionKeys = createQueryKeys({
  all: ['subscription'] as const,
  details: () => [...subscriptionKeys.all, 'details'] as const,
});



export const usageKeys = createQueryKeys({
  all: ['usage'] as const,
  logs: (days?: number) => [...usageKeys.all, 'logs', { days }] as const,
});