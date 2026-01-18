export const subscriptionKeys = {
  all: ['subscription'] as const,
  details: () => [...subscriptionKeys.all, 'details'] as const,
};



export const usageKeys = {
  all: ['usage'] as const,
  logs: (days?: number) => [...usageKeys.all, 'logs', { days }] as const,
};