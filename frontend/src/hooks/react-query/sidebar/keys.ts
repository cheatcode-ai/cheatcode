import { createQueryKeys } from "@/hooks/use-query";

export const projectKeys = createQueryKeys({
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  details: (projectId: string) => [...projectKeys.all, 'detail', projectId] as const,
  public: () => [...projectKeys.all, 'public'] as const,
});

export const threadKeys = createQueryKeys({
  all: ['threads'] as const,
  lists: () => [...threadKeys.all, 'list'] as const,
  byProject: (projectId: string) => [...threadKeys.all, 'by-project', projectId] as const,
});