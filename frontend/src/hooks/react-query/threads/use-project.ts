import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { getProject, getPublicProjects, Project, updateProject } from "./utils";
import { useAuth } from '@clerk/nextjs';

export const useProjectQuery = (projectId: string) => {
  const { getToken, isLoaded } = useAuth();

  return createQueryHook(
    threadKeys.project(projectId),
    async () => {
      const token = await getToken();
      const result = await getProject(projectId, token || undefined);
      return result;
    },
    {
      enabled: !!projectId && isLoaded,
      retry: (failureCount) => {
        return failureCount < 2;
      },
      staleTime: 10 * 60 * 1000, // 10 minutes - project data rarely changes
      gcTime: 60 * 60 * 1000, // 1 hour cache
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  )();
};

export const useUpdateProjectMutation = () => {
  const { getToken } = useAuth();
  
  return createMutationHook(
    async ({
      projectId,
      data,
    }: {
      projectId: string;
      data: Partial<Project>;
    }) => {
      const token = await getToken();
      return updateProject(projectId, data, token || undefined);
    }
  )();
};

export const usePublicProjectsQuery = () => {
  const { getToken } = useAuth();
  
  return createQueryHook(
    threadKeys.publicProjects(),
    async () => {
      const token = await getToken();
      return getPublicProjects(token || undefined);
    },
    {
      retry: 1,
    }
  )();
};