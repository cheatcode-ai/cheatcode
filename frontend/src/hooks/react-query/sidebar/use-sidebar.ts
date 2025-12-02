'use client';

import { createMutationHook } from "@/hooks/use-query";
import { getProjects, getThreads, Project, Thread } from "@/lib/api";
import { createQueryHook } from '@/hooks/use-query';
import { threadKeys, projectKeys } from "./keys";
import { deleteThread } from "../threads/utils";
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';

export const useProjects = () => {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  
  return createQueryHook(
    projectKeys.lists(),
    async () => {
      const token = await getToken();
      const data = await getProjects(token || undefined);
      return data as Project[];
    },
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      enabled: isLoaded && isSignedIn, // Only run query when auth is loaded and user is signed in
    }
  )();
};

export const useThreads = () => {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  
  return createQueryHook(
    threadKeys.lists(),
    async () => {
      const token = await getToken();
      const data = await getThreads(undefined, token || undefined);
      return data as Thread[];
    },
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      enabled: isLoaded && isSignedIn, // Only run query when auth is loaded and user is signed in
    }
  )();
};

interface DeleteThreadVariables {
  threadId: string;
  sandboxId?: string;
  isNavigateAway?: boolean;
}

export const useDeleteThread = () => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return createMutationHook(
    async ({ threadId, sandboxId }: DeleteThreadVariables) => {
      const token = await getToken();
      return await deleteThread(threadId, sandboxId, token || undefined);
    },
    {
      onSuccess: () => {
      },
    }
  )({
    // Optimistic update: immediately remove thread from UI
    onMutate: async ({ threadId }) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: threadKeys.lists() });

      // Snapshot the previous value
      const previousThreads = queryClient.getQueryData<Thread[]>(threadKeys.lists());

      // Optimistically update to remove the thread
      if (previousThreads) {
        queryClient.setQueryData<Thread[]>(
          threadKeys.lists(),
          previousThreads.filter(thread => thread.thread_id !== threadId)
        );
      }

      // Return context with snapshot for rollback
      return { previousThreads };
    },
    // Rollback on error
    onError: (_error, _variables, context: { previousThreads?: Thread[] } | undefined) => {
      if (context?.previousThreads) {
        queryClient.setQueryData(threadKeys.lists(), context.previousThreads);
      }
    },
    // Always refetch after error or success to ensure consistency
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
    },
  });
};

interface DeleteMultipleThreadsVariables {
  threadIds: string[];
  threadSandboxMap?: Record<string, string>;
  onProgress?: (completed: number, total: number) => void;
}

export const useDeleteMultipleThreads = () => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return createMutationHook(
    async ({ threadIds, threadSandboxMap, onProgress }: DeleteMultipleThreadsVariables) => {
      const token = await getToken();
      let completedCount = 0;
      const results = await Promise.all(
        threadIds.map(async (threadId) => {
          try {
            const sandboxId = threadSandboxMap?.[threadId];
            const result = await deleteThread(threadId, sandboxId, token || undefined);
            completedCount++;
            onProgress?.(completedCount, threadIds.length);
            return { success: true, threadId };
          } catch (error) {
            return { success: false, threadId, error };
          }
        })
      );

      return {
        successful: results.filter(r => r.success).map(r => r.threadId),
        failed: results.filter(r => !r.success).map(r => r.threadId),
      };
    },
    {
      onSuccess: () => {
      },
    }
  )({
    // Optimistic update: immediately remove all threads from UI
    onMutate: async ({ threadIds }) => {
      await queryClient.cancelQueries({ queryKey: threadKeys.lists() });

      const previousThreads = queryClient.getQueryData<Thread[]>(threadKeys.lists());

      if (previousThreads) {
        const threadIdsSet = new Set(threadIds);
        queryClient.setQueryData<Thread[]>(
          threadKeys.lists(),
          previousThreads.filter(thread => !threadIdsSet.has(thread.thread_id))
        );
      }

      return { previousThreads };
    },
    onError: (_error, _variables, context: { previousThreads?: Thread[] } | undefined) => {
      if (context?.previousThreads) {
        queryClient.setQueryData(threadKeys.lists(), context.previousThreads);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
    },
  });
};

export type ThreadWithProject = {
  threadId: string;
  projectId: string;
  projectName: string;
  appType?: string;
  url: string;
  updatedAt: string;
};

export const processThreadsWithProjects = (
  threads: Thread[],
  projects: Project[]
): ThreadWithProject[] => {
  const projectsById = new Map<string, Project>();
  projects.forEach((project) => {
    projectsById.set(project.id, project);
  });

  const threadsWithProjects: ThreadWithProject[] = [];

  for (const thread of threads) {
    const projectId = thread.project_id;
    if (!projectId) continue;

    const project = projectsById.get(projectId);
    if (!project) {
      console.log(
        `❌ Thread ${thread.thread_id} has project_id=${projectId} but no matching project found`,
      );
      continue;
    }
    
    // For project listings, prioritize project name over thread name
    // This ensures users see meaningful project titles like "Bakery Landing Page" 
    // rather than thread names derived from prompts
    const displayName = project.name || thread.metadata?.name || 'Unnamed Project';

    threadsWithProjects.push({
      threadId: thread.thread_id,
      projectId: projectId,
      projectName: displayName,
      appType: project.app_type || 'web',
      url: `/projects/${projectId}/thread/${thread.thread_id}`,
      updatedAt:
        thread.updated_at || project.updated_at || new Date().toISOString(),
    });
  }

  return sortThreads(threadsWithProjects);
};

export const sortThreads = (
  threadsList: ThreadWithProject[],
): ThreadWithProject[] => {
  return [...threadsList].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
};