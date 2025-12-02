'use client';

import { createMutationHook } from '@/hooks/use-query';
import {
  createProject,
  updateProject,
  deleteProject,
  Project
} from '@/lib/api';
import { toast } from 'sonner';
import { projectKeys, threadKeys } from './keys';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';

export const useCreateProject = () => {
  const queryClient = useQueryClient();

  return createMutationHook(
    (data: { name: string; description: string; accountId?: string }) =>
      createProject(data, data.accountId),
    {
      onSuccess: () => {
        toast.success('Project created successfully');
      },
      errorContext: {
        operation: 'create project',
        resource: 'project'
      }
    }
  )({
    // Invalidate projects list after successful creation
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
};

interface UpdateProjectVariables {
  projectId: string;
  data: Partial<Project>;
}

export const useUpdateProject = () => {
  const queryClient = useQueryClient();

  return createMutationHook(
    ({ projectId, data }: UpdateProjectVariables) =>
      updateProject(projectId, data),
    {
      onSuccess: () => {
        // toast.success('Project updated successfully');
      },
      errorContext: {
        operation: 'update project',
        resource: 'project'
      }
    }
  )({
    // Optimistic update for project
    onMutate: async ({ projectId, data }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });
      await queryClient.cancelQueries({ queryKey: projectKeys.details(projectId) });

      // Snapshot previous values
      const previousProjects = queryClient.getQueryData<Project[]>(projectKeys.lists());
      const previousProject = queryClient.getQueryData<Project>(projectKeys.details(projectId));

      // Optimistically update the projects list
      if (previousProjects) {
        queryClient.setQueryData<Project[]>(
          projectKeys.lists(),
          previousProjects.map(project =>
            project.id === projectId ? { ...project, ...data } : project
          )
        );
      }

      // Optimistically update the project detail
      if (previousProject) {
        queryClient.setQueryData<Project>(
          projectKeys.details(projectId),
          { ...previousProject, ...data }
        );
      }

      return { previousProjects, previousProject, projectId };
    },
    // Rollback on error
    onError: (_error, _variables, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
      if (context?.previousProject && context?.projectId) {
        queryClient.setQueryData(projectKeys.details(context.projectId), context.previousProject);
      }
    },
    // Always refetch after error or success
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: projectKeys.details(variables.projectId) });
    },
  });
};

export const useDeleteProject = () => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return createMutationHook(
    async ({ projectId }: { projectId: string }) => {
      const token = await getToken();
      return deleteProject(projectId, token || undefined);
    },
    {
      onSuccess: () => {
        toast.success('Project deleted successfully');
      },
      errorContext: {
        operation: 'delete project',
        resource: 'project'
      }
    }
  )({
    // Optimistic update: immediately remove project from UI
    onMutate: async ({ projectId }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });
      await queryClient.cancelQueries({ queryKey: threadKeys.lists() });

      // Snapshot previous values
      const previousProjects = queryClient.getQueryData<Project[]>(projectKeys.lists());

      // Optimistically update to remove the project
      if (previousProjects) {
        queryClient.setQueryData<Project[]>(
          projectKeys.lists(),
          previousProjects.filter(project => project.id !== projectId)
        );
      }

      return { previousProjects };
    },
    // Rollback on error
    onError: (_error, _variables, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
    },
    // Always refetch after error or success
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      queryClient.invalidateQueries({ queryKey: threadKeys.lists() });
    },
  });
}; 