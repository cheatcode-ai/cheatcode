import { useState, useEffect, useRef } from 'react';
import { Project } from '@/lib/api';
import { useThreadQuery } from '@/hooks/react-query/threads/use-threads';
import { useProjectQuery } from '@/hooks/react-query/threads/use-project';

interface UseThreadMetadataReturn {
  project: Project | null;
  sandboxId: string | null;
  projectName: string;
  isLoading: boolean;
  error: string | null;
  threadQuery: ReturnType<typeof useThreadQuery>;
  projectQuery: ReturnType<typeof useProjectQuery>;
}

/**
 * Hook for thread and project metadata
 * Handles project data fetching and sandbox ID extraction
 */
export function useThreadMetadata(threadId: string, projectId: string): UseThreadMetadataReturn {
  const [project, setProject] = useState<Project | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const initialLoadCompleted = useRef(false);

  const threadQuery = useThreadQuery(threadId);
  const projectQuery = useProjectQuery(projectId);

  // Handle thread error
  useEffect(() => {
    if (threadQuery.isError) {
      const errorMessage = threadQuery.error instanceof Error
        ? threadQuery.error.message
        : JSON.stringify(threadQuery.error);
      setError('Failed to load thread data: ' + errorMessage);
      setIsLoading(false);
    }
  }, [threadQuery.isError, threadQuery.error]);

  // Handle project data
  useEffect(() => {
    if (projectQuery.data) {
      const projectData = {
        ...projectQuery.data,
        id: projectQuery.data.project_id || (projectQuery.data as { id?: string }).id || projectId
      };
      setProject(projectData);

      // Extract sandbox ID
      if (typeof projectQuery.data.sandbox === 'string') {
        setSandboxId(projectQuery.data.sandbox);
      } else if (projectQuery.data.sandbox?.id) {
        setSandboxId(projectQuery.data.sandbox.id);
      }

      setProjectName(projectQuery.data.name || '');
    }
  }, [projectQuery.data, projectId]);

  // Track query states for dependency stability
  const threadIsError = threadQuery.isError;
  const threadIsLoading = threadQuery.isLoading;
  const projectIsError = projectQuery.isError;
  const projectIsLoading = projectQuery.isLoading;

  // Update loading state - handle both success and error cases
  useEffect(() => {
    const threadDone = threadQuery.data || threadIsError || !threadIsLoading;
    const projectDone = projectQuery.data || projectIsError || !projectIsLoading;

    if (threadDone && projectDone && !initialLoadCompleted.current) {
      initialLoadCompleted.current = true;
      setIsLoading(false);
    }
  }, [threadQuery.data, threadIsError, threadIsLoading, projectQuery.data, projectIsError, projectIsLoading]);

  return {
    project,
    sandboxId,
    projectName,
    isLoading,
    error,
    threadQuery,
    projectQuery,
  };
}
