import { createQueryKeys } from "@/hooks/use-query";

export const agentKeys = createQueryKeys({
  all: ['agents'] as const,
  lists: () => [...agentKeys.all, 'list'] as const,
  list: (filters?: Record<string, any>) => [...agentKeys.lists(), filters] as const,
  details: () => [...agentKeys.all, 'detail'] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
  threadAgents: () => [...agentKeys.all, 'thread-agent'] as const,
  threadAgent: (threadId: string) => [...agentKeys.threadAgents(), threadId] as const,
  // Removed builderChatHistory - agent builder functionality no longer supported
  initiate: () => [...agentKeys.all, 'initiate'] as const,
});