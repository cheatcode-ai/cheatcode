// Project API Functions
import { createClient } from '@/lib/supabase/client';
import { handleApiError } from '../error-handler';
import { API_URL } from './config';
import { Project } from './types';

export const getProjects = async (clerkToken?: string): Promise<Project[]> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/projects`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const projects = await response.json();
    return projects;
  } catch (err) {
    handleApiError(err, { operation: 'load projects', resource: 'projects' });
    return [];
  }
};

export const getProject = async (projectId: string, clerkToken?: string): Promise<Project> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const supabase = createClient();

    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('project_id', projectId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error(`Project not found or not accessible: ${projectId}`);
      }
      throw error;
    }

    // If project has a sandbox, ensure it's started
    if (data.sandbox?.id) {
      const ensureSandboxActive = async () => {
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };

          if (clerkToken) {
            headers['Authorization'] = `Bearer ${clerkToken}`;
          }

          const response = await fetch(
            `${API_URL}/project/${projectId}/sandbox/ensure-active`,
            {
              method: 'POST',
              headers,
            },
          );

          if (!response.ok) {
            // Sandbox activation failed silently
          }
        } catch (sandboxError) {
          // Failed to ensure sandbox is active
        }
      };

      ensureSandboxActive();
    }

    const mappedProject: Project = {
      id: data.project_id,
      name: data.name || '',
      description: data.description || '',
      account_id: data.user_id,  // Database column is user_id, map to account_id for API
      is_public: data.is_public || false,
      created_at: data.created_at,
      app_type: data.app_type || 'web',
      model_name: data.model_name,
      sandbox: data.sandbox || {
        id: '',
        token: '',
        dev_server_url: '',
        api_server_url: '',
      },
    };

    return mappedProject;
  } catch (error) {
    handleApiError(error, { operation: 'load project', resource: `project ${projectId}` });
    throw error;
  }
};

export const createProject = async (
  projectData: { name: string; description: string },
  accountId?: string,
  clerkToken?: string,
): Promise<Project> => {
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  const supabase = createClient();

  if (!accountId) {
    throw new Error('Account ID is required to create a project');
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: projectData.name,
      description: projectData.description || null,
      user_id: accountId,  // Database column is user_id, not account_id
    })
    .select()
    .single();

  if (error) {
    handleApiError(error, { operation: 'create project', resource: 'project' });
    throw error;
  }

  const project = {
    id: data.project_id,
    name: data.name,
    description: data.description || '',
    account_id: data.user_id,  // Database column is user_id, map to account_id for API
    created_at: data.created_at,
    sandbox: { id: '', token: '', dev_server_url: '' },
  };
  return project;
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
    handleApiError(error, { operation: 'update project', resource: `project ${projectId}` });
    throw error;
  }

  if (!updatedData) {
    const noDataError = new Error('No data returned from update');
    handleApiError(noDataError, { operation: 'update project', resource: `project ${projectId}` });
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
    account_id: updatedData.user_id,  // Database column is user_id, map to account_id for API
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

export const deleteProject = async (projectId: string, clerkToken?: string): Promise<void> => {
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .delete()
    .eq('project_id', projectId);

  if (error) {
    handleApiError(error, { operation: 'delete project', resource: `project ${projectId}` });
    throw error;
  }
};

export const getPublicProjects = async (): Promise<Project[]> => {
  try {
    const supabase = createClient();

    const { data: publicThreads, error: threadsError } = await supabase
      .from('threads')
      .select('project_id')
      .eq('is_public', true);

    if (threadsError) {
      return [];
    }

    if (!publicThreads?.length) {
      return [];
    }

    const publicProjectIds = [
      ...new Set(publicThreads.map((thread) => thread.project_id)),
    ].filter(Boolean);

    if (!publicProjectIds.length) {
      return [];
    }

    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('*')
      .in('project_id', publicProjectIds);

    if (projectsError) {
      return [];
    }

    const mappedProjects: Project[] = (projects || []).map((project) => ({
      id: project.project_id,
      name: project.name || '',
      description: project.description || '',
      account_id: project.user_id,  // Database column is user_id, map to account_id for API
      created_at: project.created_at,
      updated_at: project.updated_at,
      sandbox: project.sandbox || {
        id: '',
        token: '',
        dev_server_url: '',
        api_server_url: '',
      },
      is_public: true,
    }));

    return mappedProjects;
  } catch (err) {
    handleApiError(err, { operation: 'load public projects', resource: 'public projects' });
    return [];
  }
};
