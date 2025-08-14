import { createClientWithToken } from '@/lib/supabase/client'
import { Project, Thread } from '@/lib/api'

// Re-export types for convenience
export type { Project, Thread }

export async function getProject(projectId: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  const { data, error } = await supabase
    .from('projects')
    .select('project_id, name, description, account_id, sandbox, is_public, app_type, created_at, updated_at')
    .eq('project_id', projectId)
    .single()
  
  if (error) {
    console.error('Error fetching project:', error)
    throw error
  }
  
  return {
    project_id: data.project_id,
    name: data.name,
    description: data.description,
    account_id: data.account_id,
    sandbox: data.sandbox || {},
    is_public: data.is_public,
    app_type: data.app_type,
    created_at: data.created_at,
    updated_at: data.updated_at
  }
}

export async function getThread(threadId: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  const { data, error } = await supabase
    .from('threads')
    .select('thread_id, account_id, project_id, is_public, metadata, created_at, updated_at')
    .eq('thread_id', threadId)
    .single()
  
  if (error) {
    console.error('Error fetching thread:', error)
    throw error
  }
  
  return {
    thread_id: data.thread_id,
    account_id: data.account_id,
    project_id: data.project_id,
    is_public: data.is_public,
    metadata: data.metadata,
    created_at: data.created_at,
    updated_at: data.updated_at
  }
}

export async function getMessages(threadId: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  const { data, error } = await supabase
    .from('messages')
    .select('message_id, thread_id, type, is_llm_message, content, metadata, created_at, updated_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  
  if (error) {
    console.error('Error fetching messages:', error)
    throw error
  }
  
  return data || []
}

export async function getAgentRuns(threadId: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  const { data, error } = await supabase
    .from('agent_runs')
    .select('run_id, thread_id, status, result, metadata, created_at, updated_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true })
  
  if (error) {
    console.error('Error fetching agent runs:', error)
    throw error
  }
  
  return data || []
}

export async function createClerkAccount(clerkUserId: string, name: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  // First, try to create the account
  const { data: accountData, error: accountError } = await supabase
    .from('basejump.accounts')
    .insert({
      id: clerkUserId,
      primary_owner_user_id: clerkUserId,
      name: name,
      personal_account: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single()
  
  if (accountError) {
    console.error('Error creating account:', accountError)
    throw accountError
  }
  
  // Then, add the user to the account_user table
  const { error: userError } = await supabase
    .from('basejump.account_user')
    .insert({
      user_id: clerkUserId,
      account_id: clerkUserId,
      account_role: 'owner'
    })
  
  if (userError) {
    console.error('Error adding user to account:', userError)
    throw userError
  }
  
  return accountData
}

export async function getOrCreateClerkAccount(clerkUserId: string, name: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  // First, try to get existing account
  const { data: existingAccount, error: fetchError } = await supabase
    .from('basejump.accounts')
    .select('id, name, personal_account, created_at, updated_at')
    .eq('id', clerkUserId)
    .single()
  
  if (existingAccount && !fetchError) {
    return existingAccount
  }
  
  // If account doesn't exist, create it
  return createClerkAccount(clerkUserId, name, clerkToken)
}

export async function getPublicProjects(clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  const { data, error } = await supabase
    .from('projects')
    .select('project_id, name, description, account_id, sandbox, is_public, app_type, created_at, updated_at')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('Error fetching public projects:', error)
    throw error
  }
  
  return data?.map(project => ({
    project_id: project.project_id,
    name: project.name,
    description: project.description,
    account_id: project.account_id,
    sandbox: project.sandbox || {},
    is_public: project.is_public,
    app_type: project.app_type,
    created_at: project.created_at,
    updated_at: project.updated_at
  })) || []
}

export async function updateProject(projectId: string, data: Partial<Project>, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  // Map frontend Project type to database fields
  const updateData: any = {}
  if (data.name !== undefined) updateData.name = data.name
  if (data.description !== undefined) updateData.description = data.description
  if (data.is_public !== undefined) updateData.is_public = data.is_public
  if (data.sandbox !== undefined) updateData.sandbox = data.sandbox
  if (data.app_type !== undefined) updateData.app_type = data.app_type
  
  const { data: result, error } = await supabase
    .from('projects')
    .update(updateData)
    .eq('project_id', projectId)
    .select('project_id, name, description, account_id, sandbox, is_public, app_type, created_at, updated_at')
    .single()
  
  if (error) {
    console.error('Error updating project:', error)
    throw error
  }
  
  return {
    project_id: result.project_id,
    name: result.name,
    description: result.description,
    account_id: result.account_id,
    sandbox: result.sandbox || {},
    is_public: result.is_public,
    app_type: result.app_type,
    created_at: result.created_at,
    updated_at: result.updated_at
  }
}

export async function toggleThreadPublicStatus(threadId: string, isPublic: boolean, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  const { data, error } = await supabase
    .from('threads')
    .update({ is_public: isPublic })
    .eq('thread_id', threadId)
    .select('thread_id, account_id, project_id, is_public, created_at, updated_at')
    .single()
  
  if (error) {
    console.error('Error toggling thread public status:', error)
    throw error
  }
  
  return {
    thread_id: data.thread_id,
    account_id: data.account_id,
    project_id: data.project_id,
    is_public: data.is_public,
    created_at: data.created_at,
    updated_at: data.updated_at
  }
}

export async function updateThread(threadId: string, data: Partial<Thread>, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  // Map frontend Thread type to database fields
  const updateData: any = {}
  if (data.is_public !== undefined) updateData.is_public = data.is_public
  if (data.project_id !== undefined) updateData.project_id = data.project_id
  
  const { data: result, error } = await supabase
    .from('threads')
    .update(updateData)
    .eq('thread_id', threadId)
    .select('thread_id, account_id, project_id, is_public, created_at, updated_at')
    .single()
  
  if (error) {
    console.error('Error updating thread:', error)
    throw error
  }
  
  return {
    thread_id: result.thread_id,
    account_id: result.account_id,
    project_id: result.project_id,
    is_public: result.is_public,
    created_at: result.created_at,
    updated_at: result.updated_at
  }
}

export async function updateThreadName(threadId: string, name: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  // Get current metadata and update with the name
  const { data: currentThread, error: fetchError } = await supabase
    .from('threads')
    .select('metadata')
    .eq('thread_id', threadId)
    .single()
  
  if (fetchError) {
    console.error('Error fetching current thread metadata:', fetchError)
    throw fetchError
  }
  
  const currentMetadata = currentThread?.metadata || {}
  const updatedMetadata = {
    ...currentMetadata,
    name: name
  }
  
  const { data: result, error } = await supabase
    .from('threads')
    .update({ metadata: updatedMetadata })
    .eq('thread_id', threadId)
    .select('thread_id, account_id, project_id, is_public, metadata, created_at, updated_at')
    .single()
  
  if (error) {
    console.error('Error updating thread name:', error)
    throw error
  }
  
  return {
    thread_id: result.thread_id,
    account_id: result.account_id,
    project_id: result.project_id,
    is_public: result.is_public,
    metadata: result.metadata,
    created_at: result.created_at,
    updated_at: result.updated_at
  }
}

export async function deleteThread(threadId: string, sandboxId?: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  // Delete the thread
  const { error } = await supabase
    .from('threads')
    .delete()
    .eq('thread_id', threadId)
  
  if (error) {
    console.error('Error deleting thread:', error)
    throw error
  }
  
  // If a sandbox ID is provided, optionally handle sandbox cleanup
  // This would typically be done via a backend API call
  if (sandboxId) {
    console.log(`Thread ${threadId} deleted, sandbox ${sandboxId} may need cleanup`)
    // TODO: Add sandbox cleanup logic if needed
  }
  
  return { success: true }
}

export async function getAllThreads(clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  const { data, error } = await supabase
    .from('threads')
    .select('thread_id, account_id, project_id, is_public, metadata, created_at, updated_at')
    .order('updated_at', { ascending: false })
  
  if (error) {
    console.error('Error fetching all threads:', error)
    throw error
  }
  
  return (data || []).map(thread => ({
    thread_id: thread.thread_id,
    account_id: thread.account_id,
    project_id: thread.project_id,
    is_public: thread.is_public,
    metadata: thread.metadata,
    created_at: thread.created_at,
    updated_at: thread.updated_at
  }))
}

export async function getThreadsForAccount(accountId: string, clerkToken?: string) {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : null
  if (!supabase) {
    throw new Error('No authentication token provided')
  }
  
  // Only fetch threads that belong to this account and are not agent builder threads
  const { data, error } = await supabase
    .from('threads')
    .select('thread_id, account_id, project_id, is_public, metadata, created_at, updated_at')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
  
  if (error) {
    console.error('Error fetching threads for account:', error)
    throw error
  }
  
  return (data || [])
    .filter(thread => {
      // Filter out agent builder threads
      const metadata = thread.metadata || {}
      return !metadata.is_agent_builder
    })
    .map(thread => ({
      thread_id: thread.thread_id,
      account_id: thread.account_id,
      project_id: thread.project_id,
      is_public: thread.is_public,
      metadata: thread.metadata,
      created_at: thread.created_at,
      updated_at: thread.updated_at
    }))
}