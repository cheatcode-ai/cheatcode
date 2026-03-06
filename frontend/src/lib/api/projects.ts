// Project API Functions
import { createClient } from '@/lib/supabase/client';
import { handleApiError } from '../error-handler';
import { API_URL } from './config';
import { type Project } from './types';

export const getProjects = async (clerkToken?: string): Promise<Project[]> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/projects`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: 'Unknown error' }));
      throw new Error(
        errorData.message || `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const projects = await response.json();
    return projects;
  } catch (err) {
    handleApiError(err, { operation: 'load projects', resource: 'projects' });
    return [];
  }
};

export const updateProject = async (
  projectId: string,
  data: Partial<Project>,
  clerkToken?: string,
): Promise<Project> => {
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  const supabase = createClient();

  if (!projectId || projectId === '') {
    throw new Error('Cannot update project: Invalid project ID');
  }

  const { data: updatedData, error } = await supabase
    .from('projects')
    .update(data)
    .eq('project_id', projectId)
    .select()
    .single();

  if (error) {
    handleApiError(error, {
      operation: 'update project',
      resource: `project ${projectId}`,
    });
    throw error;
  }

  if (!updatedData) {
    const noDataError = new Error('No data returned from update');
    handleApiError(noDataError, {
      operation: 'update project',
      resource: `project ${projectId}`,
    });
    throw noDataError;
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('project-updated', {
        detail: {
          projectId,
          updatedData: {
            id: updatedData.project_id,
            name: updatedData.name,
            description: updatedData.description,
          },
        },
      }),
    );
  }

  const project = {
    id: updatedData.project_id,
    name: updatedData.name,
    description: updatedData.description || '',
    account_id: updatedData.user_id, // Database column is user_id, map to account_id for API
    created_at: updatedData.created_at,
    sandbox: updatedData.sandbox || {
      id: '',
      token: '',
      dev_server_url: '',
      api_server_url: '',
    },
  };
  return project;
};

export const deleteProject = async (
  projectId: string,
  clerkToken?: string,
): Promise<void> => {
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('project_id', projectId);

  if (error) {
    handleApiError(error, {
      operation: 'delete project',
      resource: `project ${projectId}`,
    });
    throw error;
  }
};
