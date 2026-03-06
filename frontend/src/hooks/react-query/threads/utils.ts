import { createClientWithToken } from '@/lib/supabase/client';
import { type Project } from '@/lib/api';

// Re-export types for convenience
export type { Project };

export async function getProject(projectId: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null;
  if (!supabase) {
    throw new Error('No authentication token provided');
  }

  const { data, error } = await supabase
    .from('projects')
    .select(
      'project_id, name, description, user_id, sandbox, is_public, app_type, model_name, created_at, updated_at',
    )
    .eq('project_id', projectId)
    .single();

  if (error) {
    throw error;
  }

  return {
    project_id: data.project_id,
    name: data.name,
    description: data.description,
    account_id: data.user_id, // Database column is user_id, map to account_id for API
    sandbox: data.sandbox || {},
    is_public: data.is_public,
    app_type: data.app_type,
    model_name: data.model_name,
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

export async function updateProject(
  projectId: string,
  data: Partial<Project>,
  clerkToken?: string,
) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null;
  if (!supabase) {
    throw new Error('No authentication token provided');
  }

  // Map frontend Project type to database fields
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.is_public !== undefined) updateData.is_public = data.is_public;
  if (data.sandbox !== undefined) updateData.sandbox = data.sandbox;
  if (data.app_type !== undefined) updateData.app_type = data.app_type;

  const { data: result, error } = await supabase
    .from('projects')
    .update(updateData)
    .eq('project_id', projectId)
    .select(
      'project_id, name, description, user_id, sandbox, is_public, app_type, created_at, updated_at',
    )
    .single();

  if (error) {
    throw error;
  }

  return {
    project_id: result.project_id,
    name: result.name,
    description: result.description,
    account_id: result.user_id, // Database column is user_id, map to account_id for API
    sandbox: result.sandbox || {},
    is_public: result.is_public,
    app_type: result.app_type,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}

export async function updateThreadName(
  threadId: string,
  name: string,
  clerkToken?: string,
) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null;
  if (!supabase) {
    throw new Error('No authentication token provided');
  }

  // Get current metadata and update with the name
  const { data: currentThread, error: fetchError } = await supabase
    .from('threads')
    .select('metadata')
    .eq('thread_id', threadId)
    .single();

  // Handle case where thread doesn't exist or isn't accessible
  if (fetchError) {
    // PGRST116 means no rows returned - thread may not exist yet or RLS blocks access
    if (fetchError.code === 'PGRST116') {
      return null;
    }
    throw fetchError;
  }

  const currentMetadata = currentThread?.metadata || {};
  const updatedMetadata = {
    ...currentMetadata,
    name,
  };

  const { data: result, error } = await supabase
    .from('threads')
    .update({ metadata: updatedMetadata })
    .eq('thread_id', threadId)
    .select(
      'thread_id, user_id, project_id, is_public, metadata, created_at, updated_at',
    )
    .single();

  if (error) {
    // Also handle case where update finds no rows
    if (error.code === 'PGRST116') {
      return null;
    }
    throw error;
  }

  return {
    thread_id: result.thread_id,
    account_id: result.user_id, // Database column is user_id, map to account_id for API
    project_id: result.project_id,
    is_public: result.is_public,
    metadata: result.metadata,
    created_at: result.created_at,
    updated_at: result.updated_at,
  };
}

export async function deleteThread(
  threadId: string,
  _sandboxId?: string,
  clerkToken?: string,
) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null;
  if (!supabase) {
    throw new Error('No authentication token provided');
  }

  // Delete the thread
  const { error } = await supabase
    .from('threads')
    .delete()
    .eq('thread_id', threadId);

  if (error) {
    throw error;
  }

  return { success: true };
}
