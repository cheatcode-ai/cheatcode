import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { getProject, getPublicProjects, Project, updateProject } from "./utils";
import { useAuth } from '@clerk/nextjs';

export const useProjectQuery = (projectId: string) => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  
  console.log('[DEBUG] useProjectQuery - Auth State:', {
    isLoaded,
    isSignedIn,
    userId,
    projectId
  });
  
  return createQueryHook(
    threadKeys.project(projectId),
    async () => {
      console.log('[DEBUG] useProjectQuery - Fetching project...');
      try {
        const token = await getToken();
        console.log('[DEBUG] useProjectQuery - Got token:', !!token);
        const result = await getProject(projectId, token || undefined);
        console.log('[DEBUG] useProjectQuery - Success');
        return result;
      } catch (error) {
        console.error('[DEBUG] useProjectQuery - Error:', error);
        throw error;
      }
    },
    {
      enabled: !!projectId && isLoaded,
      retry: (failureCount, error) => {
        console.log('[DEBUG] useProjectQuery - Retry attempt:', failureCount, error);
        return failureCount < 2;
      },
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