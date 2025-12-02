import { createQueryKeys } from "@/hooks/use-query";

export const agentKeys = createQueryKeys({
  all: ['agents'] as const,
  // Only initiate key is actively used - others removed with agents table
  initiate: () => [...agentKeys.all, 'initiate'] as const,
});