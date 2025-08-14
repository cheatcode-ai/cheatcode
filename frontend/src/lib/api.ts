import { createClient, createClientWithToken } from '@/lib/supabase/client';
import { handleApiError } from './error-handler';
import { updateThreadName as updateThreadNameUtil } from '@/hooks/react-query/threads/utils';

// ✅ MIGRATION COMPLETE: All functions have been migrated from Supabase auth to Clerk tokens.
// Supabase is still used for data storage (database operations), but authentication is now handled by Clerk.
// All functions now accept an optional `clerkToken` parameter and will throw an error if no token is provided.

// Get backend URL from environment variables
const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL || '';



// Custom error for billing issues
export class BillingError extends Error {
  status: number;
  detail: { message: string; [key: string]: any }; // Allow other properties in detail

  constructor(
    status: number,
    detail: { message: string; [key: string]: any },
    message?: string,
  ) {
    super(message || detail.message || 'Billing error occurred');
    this.name = 'BillingError';
    this.status = status;
    this.detail = detail;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BillingError);
    }
  }
}

// Custom error for project initiation failures
export class ProjectInitiationError extends Error {
  status: number;
  detail: { message: string; errorType: string; [key: string]: any };

  constructor(
    status: number,
    detail: { message: string; errorType: string; [key: string]: any },
    message?: string,
  ) {
    super(message || detail.message || 'Project initiation failed');
    this.name = 'ProjectInitiationError';
    this.status = status;
    this.detail = detail;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProjectInitiationError);
    }
  }
}

// Custom error for sandbox creation failures
export class SandboxCreationError extends Error {
  status: number;
  detail: { message: string; sandboxType?: string; [key: string]: any };

  constructor(
    status: number,
    detail: { message: string; sandboxType?: string; [key: string]: any },
    message?: string,
  ) {
    super(message || detail.message || 'Sandbox creation failed');
    this.name = 'SandboxCreationError';
    this.status = status;
    this.detail = detail;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SandboxCreationError);
    }
  }
}

// Custom error for authentication issues during initiation
export class InitiationAuthError extends Error {
  status: number;
  detail: { message: string; [key: string]: any };

  constructor(
    status: number,
    detail: { message: string; [key: string]: any },
    message?: string,
  ) {
    super(message || detail.message || 'Authentication failed during project initiation');
    this.name = 'InitiationAuthError';
    this.status = status;
    this.detail = detail;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InitiationAuthError);
    }
  }
}

// Type Definitions (moved from potential separate file for clarity)
export type Project = {
  id: string;
  name: string;
  description: string;
  account_id: string;
  created_at: string;
  updated_at?: string;
  sandbox: {
    dev_server_url?: string;
    api_server_url?: string;
    id?: string;
    token?: string;
  };
  is_public?: boolean; // Flag to indicate if the project is public
  app_type?: 'web' | 'mobile'; // Type of application (web or mobile)
  [key: string]: any; // Allow additional properties to handle database fields
};

export type Thread = {
  thread_id: string;
  account_id: string | null;
  project_id?: string | null;
  is_public?: boolean;
  metadata?: { name?: string; [key: string]: any };
  created_at: string;
  updated_at: string;
  [key: string]: any; // Allow additional properties to handle database fields
};

export type Message = {
  role: string;
  content: string;
  type: string;
  agent_id?: string;
  agents?: {
    name: string;
    avatar?: string;
    avatar_color?: string;
  };
};

export type AgentRun = {
  id: string;
  thread_id: string;
  status: 'running' | 'completed' | 'stopped' | 'error';
  started_at: string;
  completed_at: string | null;
  responses: Message[];
  error: string | null;
};

export type ToolCall = {
  name: string;
  arguments: Record<string, unknown>;
};

export interface InitiateAgentResponse {
  thread_id: string;
  agent_run_id: string;
}

export interface HealthCheckResponse {
  status: string;
  timestamp: string;
  instance_id: string;
}

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  mod_time: string;
  permissions?: string;
}



// Project APIs
export const getProjects = async (clerkToken?: string): Promise<Project[]> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    // Call the backend API endpoint
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
    console.log('[API] Retrieved projects from backend:', projects.length);

    return projects;
  } catch (err) {
    console.error('Error fetching projects:', err);
    handleApiError(err, { operation: 'load projects', resource: 'projects' });
    // Return empty array for permission errors to avoid crashing the UI
    return [];
  }
};

export const getProject = async (projectId: string, clerkToken?: string): Promise<Project> => {
  try {
    // Require Clerk token - no Supabase fallback
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
      // Handle the specific "no rows returned" error from Supabase
      if (error.code === 'PGRST116') {
        throw new Error(`Project not found or not accessible: ${projectId}`);
      }
      throw error;
    }

    console.log('Raw project data from database:', data);

    // If project has a sandbox, ensure it's started
    if (data.sandbox?.id) {
      // Fire off sandbox activation without blocking
      const ensureSandboxActive = async () => {
        try {
          // For public projects, we don't need authentication
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
          };

          if (clerkToken) {
            headers['Authorization'] = `Bearer ${clerkToken}`;
          }

          console.log(`Ensuring sandbox is active for project ${projectId}...`);
          const response = await fetch(
            `${API_URL}/project/${projectId}/sandbox/ensure-active`,
            {
              method: 'POST',
              headers,
            },
          );

          if (!response.ok) {
            const errorText = await response
              .text()
              .catch(() => 'No error details available');
            console.warn(
              `Failed to ensure sandbox is active: ${response.status} ${response.statusText}`,
              errorText,
            );
          } else {
            console.log('Sandbox activation successful');
          }
        } catch (sandboxError) {
          console.warn('Failed to ensure sandbox is active:', sandboxError);
        }
      };

      // Start the sandbox activation without awaiting
      ensureSandboxActive();
    }

    // Map database fields to our Project type
    const mappedProject: Project = {
      id: data.project_id,
      name: data.name || '',
      description: data.description || '',
      account_id: data.account_id,
      is_public: data.is_public || false,
      created_at: data.created_at,
      app_type: data.app_type || 'web', // Default to 'web' if not specified
      sandbox: data.sandbox || {
        id: '',
        token: '',
        dev_server_url: '',
        api_server_url: '',
      },
    };

    // console.log('Mapped project data for frontend:', mappedProject);

    return mappedProject;
  } catch (error) {
    console.error(`Error fetching project ${projectId}:`, error);
    handleApiError(error, { operation: 'load project', resource: `project ${projectId}` });
    throw error;
  }
};

export const createProject = async (
  projectData: { name: string; description: string },
  accountId?: string,
  clerkToken?: string,
): Promise<Project> => {
  // Require Clerk token - no Supabase fallback
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  const supabase = createClient();

  // If accountId is not provided, we'll need to get it from the Clerk user context
  // For now, this will need to be provided by the calling code
  if (!accountId) {
    throw new Error('Account ID is required to create a project');
  }

  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: projectData.name,
      description: projectData.description || null,
      account_id: accountId,
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
    account_id: data.account_id,
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
  // Require Clerk token - no Supabase fallback
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  const supabase = createClient();

  console.log('Updating project with ID:', projectId);
  console.log('Update data:', data);

  // Sanity check to avoid update errors
  if (!projectId || projectId === '') {
    console.error('Attempted to update project with invalid ID:', projectId);
    throw new Error('Cannot update project: Invalid project ID');
  }

  const { data: updatedData, error } = await supabase
    .from('projects')
    .update(data)
    .eq('project_id', projectId)
    .select()
    .single();

  if (error) {
    console.error('Error updating project:', error);
    handleApiError(error, { operation: 'update project', resource: `project ${projectId}` });
    throw error;
  }

  if (!updatedData) {
    const noDataError = new Error('No data returned from update');
    handleApiError(noDataError, { operation: 'update project', resource: `project ${projectId}` });
    throw noDataError;
  }

  // Dispatch a custom event to notify components about the project change
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

  // Return formatted project data - use same mapping as getProject
  const project = {
    id: updatedData.project_id,
    name: updatedData.name,
    description: updatedData.description || '',
    account_id: updatedData.account_id,
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
  // Require Clerk token - no Supabase fallback
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

// Thread APIs
export const getThreads = async (projectId?: string, clerkToken?: string): Promise<Thread[]> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    // Build the URL with optional project filter
    const url = new URL(`${API_URL}/threads`);
    if (projectId) {
      url.searchParams.append('project_id', projectId);
      console.log('[API] Filtering threads by project_id:', projectId);
    }

    // Call the backend API endpoint
    const response = await fetch(url.toString(), {
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

    const threads = await response.json();
    console.log('[API] Retrieved threads from backend:', threads.length);

    return threads;
  } catch (err) {
    console.error('Error fetching threads:', err);
    handleApiError(err, { operation: 'load threads', resource: projectId ? `threads for project ${projectId}` : 'threads' });
    // Return empty array for permission errors to avoid crashing the UI
    return [];
  }
};

export const getThread = async (threadId: string, clerkToken?: string): Promise<Thread> => {
  console.log('[API] getThread called with:', { threadId, hasToken: !!clerkToken });
  
  const supabase = clerkToken ? createClientWithToken(clerkToken) : createClient();

  const { data, error } = await supabase
    .from('threads')
    .select('*')
    .eq('thread_id', threadId)
    .single();

  if (error) {
    console.error('Error fetching thread:', error);
    console.error('Error details:', { 
      code: error.code, 
      message: error.message,
      details: error.details,
      hint: error.hint 
    });
    handleApiError(error, { operation: 'load thread', resource: `thread ${threadId}` });
    throw new Error(`Error getting thread: ${error.message}`);
  }

  return data;
};

export const createThread = async (projectId: string, accountId?: string, clerkToken?: string): Promise<Thread> => {
  // Require Clerk token - no Supabase fallback
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  // If accountId is not provided, we'll need to get it from the Clerk user context
  // For now, this will need to be provided by the calling code
  if (!accountId) {
    throw new Error('Account ID is required to create a thread');
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from('threads')
    .insert({
      project_id: projectId,
      account_id: accountId,
    })
    .select()
    .single();

  if (error) {
    handleApiError(error, { operation: 'create thread', resource: 'thread' });
    throw error;
  }
  return data;
};

export const addUserMessage = async (
  threadId: string,
  content: string,
  clerkToken?: string,
): Promise<void> => {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : createClient();

  // Format the message in the format the LLM expects - keep it simple with only required fields
  const message = {
    role: 'user',
    content: content,
  };

  // Insert the message into the messages table
  const { error } = await supabase.from('messages').insert({
    thread_id: threadId,
    type: 'user',
    is_llm_message: true,
    content: JSON.stringify(message),
  });

  if (error) {
    console.error('Error adding user message:', error);
    handleApiError(error, { operation: 'add message', resource: 'message' });
    throw new Error(`Error adding message: ${error.message}`);
  }
};

export const getMessages = async (threadId: string, clerkToken?: string): Promise<Message[]> => {
  console.log('[API] getMessages called with:', { threadId, hasToken: !!clerkToken });
  
  const supabase = clerkToken ? createClientWithToken(clerkToken) : createClient();

  let allMessages: Message[] = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('messages')
      .select(`
        *,
        agents:agent_id (
          name,
          avatar,
          avatar_color
        )
      `)
      .eq('thread_id', threadId)
      .neq('type', 'cost')
      .neq('type', 'summary')
      .order('created_at', { ascending: true })
      .range(from, from + batchSize - 1);

    if (error) {
      console.error('Error fetching messages:', error);
      console.error('Error details:', { 
        code: error.code, 
        message: error.message,
        details: error.details,
        hint: error.hint 
      });
      handleApiError(error, { operation: 'load messages', resource: `messages for thread ${threadId}` });
      throw new Error(`Error getting messages: ${error.message}`);
    }

    if (data && data.length > 0) {
      allMessages = allMessages.concat(data);
      from += batchSize;
      hasMore = data.length === batchSize;
    } else {
      hasMore = false;
    }
  }

  console.log('[API] Messages fetched count:', allMessages.length);

  return allMessages;
};

// Agent APIs
export const startAgent = async (
  threadId: string,
  options?: {
    model_name?: string;
    enable_thinking?: boolean;
    reasoning_effort?: string;
    stream?: boolean;
    agent_id?: string;
    app_type?: 'web' | 'mobile';
  },
  clerkToken?: string,
): Promise<{ agent_run_id: string }> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    // Check if backend URL is configured
    if (!API_URL) {
      throw new Error(
        'Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.',
      );
    }

    console.log(
      `[API] Starting agent for thread ${threadId} using ${API_URL}/thread/${threadId}/agent/start`,
    );

    // Do not set a client-side default model – let the backend decide.
    const defaultOptions = {
      enable_thinking: false,
      reasoning_effort: 'low',
      stream: true,
      agent_id: undefined,
      app_type: 'web' as const,
    } as const;

    const finalOptions = { ...defaultOptions, ...options };

    const body: any = {
      enable_thinking: finalOptions.enable_thinking,
      reasoning_effort: finalOptions.reasoning_effort,
      stream: finalOptions.stream,
      app_type: finalOptions.app_type,
    };

    // Only include model_name if the caller explicitly provided one.
    if (finalOptions.model_name) {
      body.model_name = finalOptions.model_name;
    }
    
    // Only include agent_id if it's provided
    if (finalOptions.agent_id) {
      body.agent_id = finalOptions.agent_id;
    }

    const response = await fetch(`${API_URL}/thread/${threadId}/agent/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clerkToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Check for 402 Payment Required first
      if (response.status === 402) {
        try {
          const errorData = await response.json();
          console.error(`[API] Billing error starting agent (402):`, errorData);
          // Ensure detail exists and has a message property
          const detail = errorData?.detail || { message: 'Payment Required' };
          if (typeof detail.message !== 'string') {
            detail.message = 'Payment Required'; // Default message if missing
          }
          throw new BillingError(response.status, detail);
        } catch (parseError) {
          // Handle cases where parsing fails or the structure isn't as expected
          console.error(
            '[API] Could not parse 402 error response body:',
            parseError,
          );
          throw new BillingError(
            response.status,
            { message: 'Payment Required' },
            `Error starting agent: ${response.statusText} (402)`,
          );
        }
      }

      // Handle other errors
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `[API] Error starting agent: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error starting agent: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    // Rethrow BillingError instances directly
    if (error instanceof BillingError) {
      throw error;
    }

    console.error('[API] Failed to start agent:', error);
    
    // Handle different error types with appropriate user messages
    if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      const networkError = new Error(
        `Cannot connect to backend server. Please check your internet connection and make sure the backend is running.`,
      );
      handleApiError(networkError, { operation: 'start agent', resource: 'AI assistant' });
      throw networkError;
    }

    // For other errors, add context and rethrow
    handleApiError(error, { operation: 'start agent', resource: 'AI assistant' });
    throw error;
  }
};

export const stopAgent = async (agentRunId: string, clerkToken?: string): Promise<void> => {
  // Require Clerk token - no Supabase fallback
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  const response = await fetch(`${API_URL}/agent-run/${agentRunId}/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${clerkToken}`,
    },
    // Add cache: 'no-store' to prevent caching
    cache: 'no-store',
  });

  if (!response.ok) {
    const stopError = new Error(`Error stopping agent: ${response.statusText}`);
    handleApiError(stopError, { operation: 'stop agent', resource: 'AI assistant' });
    throw stopError;
  }
};

export const getAgentStatus = async (agentRunId: string, clerkToken?: string): Promise<AgentRun> => {
  console.log(`[API] Requesting agent status for ${agentRunId}`);

  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = `${API_URL}/agent-run/${agentRunId}`;
    console.log(`[API] Fetching from: ${url}`);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
      // Add cache: 'no-store' to prevent caching
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `[API] Error getting agent status: ${response.status} ${response.statusText}`,
        errorText,
      );



      throw new Error(
        `Error getting agent status: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    console.log(`[API] Successfully got agent status:`, data);



    return data;
  } catch (err) {
    console.error(`[API] Error in getAgentStatus for ${agentRunId}:`, err);
    throw err;
  }
};

export const getAgentRuns = async (threadId: string, clerkToken?: string): Promise<AgentRun[]> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/thread/${threadId}/agent-runs`, {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
      // Add cache: 'no-store' to prevent caching
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Error getting agent runs: ${response.statusText}`);
    }

    const data = await response.json();
    return data.agent_runs || [];
  } catch (error) {
    console.error('Failed to get agent runs:', error);
    handleApiError(error, { operation: 'load agent runs', resource: 'conversation history' });
    throw error;
  }
};

// EventSource-based agent streaming implementation
export const streamAgent = (
  agentRunId: string,
  callbacks: {
    onMessage: (content: string) => void;
    onError: (error: Error | string) => void;
    onClose: () => void;
  },
  clerkToken?: string,
): (() => void) => {
  console.log(`[streamAgent] Starting EventSource stream for ${agentRunId}`);

  // Validate authentication
  if (!clerkToken) {
    const authError = new Error('Authentication required. Please sign in to continue.');
    console.error('[streamAgent] No Clerk token available');
    callbacks.onError(authError);
    callbacks.onClose();
    return () => {};
  }

  let eventSource: EventSource | null = null;
  let isClosed = false;
  let errorCount = 0;
  const maxErrors = 5;
  let lastErrorTime = 0;

  const cleanup = () => {
    if (eventSource && !isClosed) {
      console.log(`[streamAgent] Cleaning up EventSource for ${agentRunId}`);
      isClosed = true;
      eventSource.close();
      eventSource = null;
    }
  };

  try {
    // Build EventSource URL with authentication
    const url = new URL(`${API_URL}/agent-run/${agentRunId}/stream`);
    url.searchParams.append('token', clerkToken);
    
    console.log(`[streamAgent] Creating EventSource for ${agentRunId}`);
    eventSource = new EventSource(url.toString());

    eventSource.onopen = () => {
      if (isClosed) return;
      console.log(`[streamAgent] EventSource connected for ${agentRunId}`);
      
      // Reset error count on successful connection
      errorCount = 0;
      lastErrorTime = 0;
      console.log(`[streamAgent] Connection established, error count reset for ${agentRunId}`);
    };

    eventSource.onmessage = (event) => {
      if (isClosed) return;
      
      try {
        const rawData = event.data;
        if (rawData.includes('"type":"ping"')) return;

        // Log raw data for debugging (truncated for readability)
        console.log(
          `[streamAgent] Received data for ${agentRunId}: ${rawData.substring(0, 100)}${rawData.length > 100 ? '...' : ''}`,
        );

        // Skip empty messages
        if (!rawData || rawData.trim() === '') {
          console.debug('[streamAgent] Received empty message, skipping');
          return;
        }

        // Check for error status messages
        try {
          const jsonData = JSON.parse(rawData);
          if (jsonData.status === 'error') {
            console.error(`[streamAgent] Error status received for ${agentRunId}:`, jsonData);
            
            // Pass the error message to the callback
            callbacks.onError(jsonData.message || 'Unknown error occurred');
            
            // Don't close the stream for error status messages as they may continue
            return;
          }
        } catch (jsonError) {
          // Not JSON or invalid JSON, continue with normal processing
        }

        // Check for "Agent run not found" error
        if (
          rawData.includes('Agent run') &&
          rawData.includes('not found in active runs')
        ) {
          console.log(
            `[streamAgent] Agent run ${agentRunId} not found in active runs, closing stream`,
          );

          // Notify about the error
          callbacks.onError('Agent run not found in active runs');

          // Clean up
          cleanup();
          callbacks.onClose();
          return;
        }

        // Check for completion messages
        if (
          rawData.includes('"type":"status"') &&
          rawData.includes('"status":"completed"')
        ) {
          console.log(
            `[streamAgent] Detected completion status message for ${agentRunId}`,
          );

          // Check for specific completion messages that indicate we should stop checking
          if (
            rawData.includes('Run data not available for streaming') ||
            rawData.includes('Stream ended with status: completed')
          ) {
            console.log(
              `[streamAgent] Detected final completion message for ${agentRunId}`,
            );
          }

          // Don't display completion status messages in chat - they're handled by the stream logic
          console.log(`[streamAgent] Completion message processed for ${agentRunId}, not displaying in chat`);

          // Clean up
          cleanup();
          callbacks.onClose();
          return;
        }

        // Check for thread run end message
        if (
          rawData.includes('"type":"status"') &&
          rawData.includes('"status_type":"thread_run_end"')
        ) {
          console.log(
            `[streamAgent] Detected thread run end message for ${agentRunId}`,
          );

          // Don't display thread run end messages in chat - they're handled by the stream logic
          console.log(`[streamAgent] Thread run end message processed for ${agentRunId}, not displaying in chat`);

          // Clean up
          cleanup();
          callbacks.onClose();
          return;
        }

        // Pass raw data to useAgentStream for processing
        // useAgentStream will handle filtering, parsing, and message deduplication
        callbacks.onMessage(rawData);
      } catch (error) {
        console.error(`[streamAgent] Error handling message:`, error);
        callbacks.onError(error instanceof Error ? error : String(error));
      }
    };

    eventSource.onerror = (event) => {
      if (isClosed) return;
      
      console.log(`[streamAgent] EventSource error for ${agentRunId}:`, event);
      console.log(`[streamAgent] EventSource readyState: ${eventSource?.readyState}`);
      
      // Track error frequency to prevent infinite reconnection attempts
      const currentTime = Date.now();
      const timeSinceLastError = currentTime - lastErrorTime;
      lastErrorTime = currentTime;
      
      // Reset error count if enough time has passed (5 minutes)
      if (timeSinceLastError > 5 * 60 * 1000) {
        errorCount = 0;
      }
      
      errorCount++;
      
      // Extract more specific error information from the event
      const eventSourceState = eventSource?.readyState;
      let errorMessage = 'Connection error';
      let shouldAttemptReconnect = true;
      
      // If we've had too many errors, stop reconnecting
      if (errorCount >= maxErrors) {
        errorMessage = `Stream failed after ${errorCount} attempts - please refresh the page`;
        shouldAttemptReconnect = false;
      } else {
        // Analyze the error based on EventSource readyState and event properties
        if (eventSourceState === EventSource.CONNECTING) {
          errorMessage = `Failed to connect to stream (attempt ${errorCount}/${maxErrors}) - retrying...`;
        } else if (eventSourceState === EventSource.CLOSED) {
          errorMessage = 'Stream connection closed unexpectedly';
          shouldAttemptReconnect = false;
        } else if (eventSourceState === EventSource.OPEN) {
          errorMessage = `Stream connection interrupted (attempt ${errorCount}/${maxErrors}) - reconnecting...`;
        }
        
        // Check if this is likely an authentication error by examining the target URL
        // EventSource will fail to connect with 401/403 and keep retrying
        if (event.target && (event.target as EventSource).url) {
          const targetUrl = (event.target as EventSource).url;
          
          // If we've been trying to connect for a while and keep failing,
          // it's likely an authentication or permission issue
          if (eventSourceState === EventSource.CONNECTING && errorCount >= 3) {
            errorMessage = 'Persistent connection failure - authentication may have expired';
            shouldAttemptReconnect = false;
          }
        }
        
        // Extract additional error information if available
        try {
          if ('error' in event && event.error) {
            errorMessage += ` (${event.error})`;
          }
          
          // Some browsers provide more detailed error information
          if ('message' in event && event.message) {
            errorMessage += ` - ${event.message}`;
          }
          
          // If we have specific error codes or status information
          if ('status' in event && event.status) {
            switch (event.status) {
              case 401:
                errorMessage = 'Authentication failed - please refresh and try again';
                shouldAttemptReconnect = false;
                break;
              case 403:
                errorMessage = 'Access denied - insufficient permissions';
                shouldAttemptReconnect = false;
                break;
              case 404:
                errorMessage = 'Stream endpoint not found - agent may have completed';
                shouldAttemptReconnect = false;
                break;
              case 500:
                errorMessage = `Server error (attempt ${errorCount}/${maxErrors}) - stream temporarily unavailable`;
                break;
              case 503:
                errorMessage = `Service unavailable (attempt ${errorCount}/${maxErrors}) - please try again later`;
                break;
              default:
                errorMessage = `Connection error (HTTP ${event.status}, attempt ${errorCount}/${maxErrors})`;
            }
          }
        } catch (inspectionError) {
          console.debug(`[streamAgent] Could not extract detailed error info:`, inspectionError);
        }
      }
      
      // For non-recoverable errors or too many errors, close the stream
      if (!shouldAttemptReconnect) {
        console.log(`[streamAgent] Non-recoverable error for ${agentRunId}, closing stream`);
        cleanup();
        callbacks.onError(errorMessage);
        callbacks.onClose();
        return;
      }
      
      // For recoverable errors, EventSource will automatically retry
      console.log(`[streamAgent] Recoverable error for ${agentRunId}: ${errorMessage}`);
      callbacks.onError(errorMessage);
    };

  } catch (error) {
    console.error(`[streamAgent] Failed to create EventSource for ${agentRunId}:`, error);
    
    // Provide more specific error messages based on the error type
    let errorMessage = 'Failed to start stream';
    
    if (error instanceof Error) {
      if (error.name === 'SecurityError') {
        errorMessage = 'Security error - unable to connect to stream (check CORS settings)';
      } else if (error.name === 'TypeError') {
        errorMessage = 'Invalid stream URL or network configuration error';
      } else if (error.message.includes('fetch')) {
        errorMessage = 'Network error - unable to reach streaming endpoint';
      } else if (error.message.includes('token')) {
        errorMessage = 'Authentication token error - please refresh and try again';
      } else {
        errorMessage = `Stream setup failed: ${error.message}`;
      }
      callbacks.onError(errorMessage);
    } else {
      callbacks.onError(`Stream setup failed: ${String(error)}`);
    }
    
    callbacks.onClose();
    return () => {};
  }

  // Return cleanup function
  return cleanup;
};


// Sandbox API Functions
export const createSandboxFile = async (
  sandboxId: string,
  filePath: string,
  content: string,
  clerkToken?: string,
): Promise<void> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    // Use FormData to handle both text and binary content more reliably
    const formData = new FormData();
    formData.append('path', filePath);

    // Create a Blob from the content string and append as a file
    const blob = new Blob([content], { type: 'application/octet-stream' });
    formData.append('file', blob, filePath.split('/').pop() || 'file');

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${clerkToken}`,
    };

    const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/files`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error creating sandbox file: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error creating sandbox file: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Failed to create sandbox file:', error);
    handleApiError(error, { operation: 'create file', resource: `file ${filePath}` });
    throw error;
  }
};

// Fallback method for legacy support using JSON
export const createSandboxFileJson = async (
  sandboxId: string,
  filePath: string,
  content: string,
  clerkToken?: string,
): Promise<void> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${clerkToken}`,
    };

    const response = await fetch(
      `${API_URL}/sandboxes/${sandboxId}/files/json`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: filePath,
          content: content,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error creating sandbox file (JSON): ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error creating sandbox file: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Failed to create sandbox file with JSON:', error);
    handleApiError(error, { operation: 'create file', resource: `file ${filePath}` });
    throw error;
  }
};

// Helper function to normalize file paths with Unicode characters
function normalizePathWithUnicode(path: string): string {
  try {
    // Replace escaped Unicode sequences with actual characters
    return path.replace(/\\u([0-9a-fA-F]{4})/g, (_, hexCode) => {
      return String.fromCharCode(parseInt(hexCode, 16));
    });
  } catch (e) {
    console.error('Error processing Unicode escapes in path:', e);
    return path;
  }
}

export const listSandboxFiles = async (
  sandboxId: string,
  path: string,
  clerkToken?: string,
): Promise<FileInfo[]> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/sandboxes/${sandboxId}/files`);
    
    // Normalize the path to handle Unicode escape sequences
    const normalizedPath = normalizePathWithUnicode(path);
    
    // Properly encode the path parameter for UTF-8 support
    url.searchParams.append('path', normalizedPath);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${clerkToken}`,
    };

    const response = await fetch(url.toString(), {
      headers,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error listing sandbox files: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error listing sandbox files: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error('Failed to list sandbox files:', error);
    // handleApiError(error, { operation: 'list files', resource: `directory ${path}` });
    throw error;
  }
};

// Git-based file operations (fallback to sandbox)
export const listProjectFiles = async (
  projectId: string,
  path: string = "",
  clerkToken?: string,
): Promise<FileInfo[]> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/project/${projectId}/git/files`);
    url.searchParams.append('path', path);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details available');
      console.error(`Error listing project files: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Error listing project files: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error('Failed to list project files:', error);
    throw error;
  }
};

export const getProjectFileContent = async (
  projectId: string,
  filePath: string,
  clerkToken?: string,
): Promise<string> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/project/${projectId}/git/file-content`);
    url.searchParams.append('file_path', filePath);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details available');
      console.error(`Error getting project file content: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Error getting project file content: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    return data.content || '';
  } catch (error) {
    console.error('Failed to get project file content:', error);
    throw error;
  }
};

export const getSandboxFileContent = async (
  sandboxId: string,
  path: string,
  clerkToken?: string,
): Promise<string | Blob> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/sandboxes/${sandboxId}/files/content`);
    
    // Normalize the path to handle Unicode escape sequences
    const normalizedPath = normalizePathWithUnicode(path);
    
    // Properly encode the path parameter for UTF-8 support
    url.searchParams.append('path', normalizedPath);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${clerkToken}`,
    };

    const response = await fetch(url.toString(), {
      headers,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error getting sandbox file content: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error getting sandbox file content: ${response.statusText} (${response.status})`,
      );
    }

    // Check if it's a text file or binary file based on content-type and file extension
    const contentType = response.headers.get('content-type');
    const fileName = path.split('/').pop() || '';
    const extension = fileName.split('.').pop()?.toLowerCase() || '';
    
    // Text file extensions that should always be treated as text
    const textExtensions = ['ts', 'tsx', 'js', 'jsx', 'css', 'html', 'json', 'md', 'txt', 'yml', 'yaml', 'toml', 'xml', 'csv'];
    const isTextFile = textExtensions.includes(extension);
    
    if (
      isTextFile ||
      (contentType && contentType.includes('text')) ||
      contentType?.includes('application/json')
    ) {
      return await response.text();
    } else {
      return await response.blob();
    }
  } catch (error) {
    console.error('Failed to get sandbox file content:', error);
    handleApiError(error, { operation: 'load file content', resource: `file ${path}` });
    throw error;
  }
};

// Function to get public projects
export const getPublicProjects = async (): Promise<Project[]> => {
  try {
    const supabase = createClient();

    // Query for threads that are marked as public
    const { data: publicThreads, error: threadsError } = await supabase
      .from('threads')
      .select('project_id')
      .eq('is_public', true);

    if (threadsError) {
      console.error('Error fetching public threads:', threadsError);
      return [];
    }

    // If no public threads found, return empty array
    if (!publicThreads?.length) {
      return [];
    }

    // Extract unique project IDs from public threads
    const publicProjectIds = [
      ...new Set(publicThreads.map((thread) => thread.project_id)),
    ].filter(Boolean);

    // If no valid project IDs, return empty array
    if (!publicProjectIds.length) {
      return [];
    }

    // Get the projects that have public threads
    const { data: projects, error: projectsError } = await supabase
      .from('projects')
      .select('*')
      .in('project_id', publicProjectIds);

    if (projectsError) {
      console.error('Error fetching public projects:', projectsError);
      return [];
    }

    console.log(
      '[API] Raw public projects from DB:',
      projects?.length,
      projects,
    );

    // Map database fields to our Project type
    const mappedProjects: Project[] = (projects || []).map((project) => ({
      id: project.project_id,
      name: project.name || '',
      description: project.description || '',
      account_id: project.account_id,
      created_at: project.created_at,
      updated_at: project.updated_at,
      sandbox: project.sandbox || {
        id: '',
        token: '',
        dev_server_url: '',
        api_server_url: '',
      },
      is_public: true, // Mark these as public projects
    }));

    console.log(
      '[API] Mapped public projects for frontend:',
      mappedProjects.length,
    );

    return mappedProjects;
  } catch (err) {
    console.error('Error fetching public projects:', err);
    handleApiError(err, { operation: 'load public projects', resource: 'public projects' });
    return [];
  }
};


export const initiateAgent = async (
  formData: FormData,
  clerkToken?: string,
): Promise<InitiateAgentResponse> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    if (!API_URL) {
      throw new Error(
        'Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.',
      );
    }

    console.log(
      `[API] Initiating agent with files using ${API_URL}/agent/initiate`,
    );

    const response = await fetch(`${API_URL}/agent/initiate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
      body: formData,
      cache: 'no-store',
    });

    if (!response.ok) {
      let errorDetail: any;
      try {
        errorDetail = await response.json();
      } catch {
        const errorText = await response.text().catch(() => 'No error details available');
        errorDetail = { message: errorText };
      }
      
      console.error(
        `[API] Error initiating agent: ${response.status} ${response.statusText}`,
        errorDetail,
      );
    
      if (response.status === 402) {
        // Payment/billing related error
        throw new BillingError(response.status, {
          message: errorDetail.message || 'Payment required to create new project',
          ...errorDetail
        });
      } else if (response.status === 401 || response.status === 403) {
        // Authentication/authorization error
        throw new InitiationAuthError(response.status, {
          message: errorDetail.message || 'Authentication failed. Please sign in again and try again.',
          errorType: 'authentication'
        });
      } else if (response.status === 400) {
        // Validation or bad request error
        throw new ProjectInitiationError(response.status, {
          message: errorDetail.message || 'Invalid request. Please check your inputs and try again.',
          errorType: 'validation'
        });
      } else if (response.status === 409) {
        // Conflict error (e.g., project name already exists)
        throw new ProjectInitiationError(response.status, {
          message: errorDetail.message || 'A project with this configuration already exists.',
          errorType: 'conflict'
        });
      } else if (response.status === 503 || response.status === 502) {
        // Sandbox creation specific errors
        throw new SandboxCreationError(response.status, {
          message: errorDetail.message || 'Failed to create development environment. Please try again.',
          sandboxType: 'daytona'
        });
      } else if (response.status >= 500) {
        // General server error
        throw new ProjectInitiationError(response.status, {
          message: errorDetail.message || 'Server error occurred. Please try again in a moment.',
          errorType: 'server'
        });
      }
    
      // Fallback for other status codes
      throw new ProjectInitiationError(response.status, {
        message: errorDetail.message || `Failed to create project: ${response.statusText}`,
        errorType: 'unknown'
      });
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('[API] Failed to initiate agent:', error);

    if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      const networkError = new Error(
        `Cannot connect to backend server. Please check your internet connection and make sure the backend is running.`,
      );
      handleApiError(networkError, { operation: 'initiate agent', resource: 'AI assistant' });
      throw networkError;
    }
    handleApiError(error, { operation: 'initiate agent' });
    throw error;
  }
};

export const checkApiHealth = async (): Promise<HealthCheckResponse> => {
  try {
    const response = await fetch(`${API_URL}/health`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`API health check failed: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    throw error;
  }
};

// Billing API Types
export interface CreateCheckoutSessionRequest {
  price_id: string;
  success_url: string;
  cancel_url: string;
  referral_id?: string;
}



export interface SubscriptionStatus {
  status: string; // Includes 'active', 'trialing', 'past_due', 'scheduled_downgrade', 'no_subscription'
  plan_name?: string;
  price_id?: string; // Added
  current_period_end?: string; // ISO Date string
  cancel_at_period_end: boolean;
  trial_end?: string; // ISO Date string
  minutes_limit?: number;
  cost_limit?: number;
  current_usage?: number;
  // Fields for scheduled changes
  has_schedule: boolean;
  scheduled_plan_name?: string;
  scheduled_price_id?: string; // Added
  scheduled_change_date?: string; // ISO Date string - Deprecate? Check backend usage
  schedule_effective_date?: string; // ISO Date string - Added for consistency
}

export interface BillingStatusResponse {
  account_id: string;
  plan_id: string;
  plan_name: string;
  price_inr: number;
  price_usd: number;
  tokens_total: number;
  tokens_remaining: number;
  credits_total: number;
  credits_remaining: number;
  quota_resets_at: string;
  subscription_status: string;
  features: string[];
  can_run?: boolean; // Computed property for backward compatibility
  message?: string; // Computed property for backward compatibility
  deployments_used: number;
  deployments_total: number;
}

export interface UsageLogEntry {
  message_id: string;
  thread_id: string;
  created_at: string;
  content: {
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
    };
    model: string;
  };
  total_tokens: number;
  estimated_cost: number;
  project_id: string;
}

export interface UsageLogsResponse {
  logs: UsageLogEntry[];
  has_more: boolean;
  message?: string;
}

// New token-based types for credit system
export interface TokenUsageEntry {
  id: string;
  account_id: string;
  thread_id?: string;
  message_id?: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  tokens_remaining_after: number;
  estimated_cost: number;
  created_at: string;
  project_id?: string; // NEW: Optional since some entries might not have threads or projects
}

export interface UsageHistoryResponse {
  account_id: string;
  usage_entries: TokenUsageEntry[];
  total_tokens_used: number;
  total_credits_used: number;
}

export interface PlanDetails {
  name: string;
  price_inr: number;
  price_usd: number;
  token_quota: number;
  display_credits: number;
  features: string[];
  description: string;
}

export interface PlanListResponse {
  plans: PlanDetails[];
  current_plan: string;
}

export interface CheckoutSessionResponse {
  checkout_url?: string;
  success: boolean;
  message: string;
  plan_details?: PlanDetails;
}

export interface CreateCheckoutSessionResponse {
  status:
    | 'upgraded'
    | 'downgrade_scheduled'
    | 'checkout_created'
    | 'no_change'
    | 'new'
    | 'updated'
    | 'scheduled';
  subscription_id?: string;
  schedule_id?: string;
  session_id?: string;
  url?: string;
  effective_date?: string;
  message?: string;
  details?: {
    is_upgrade?: boolean;
    effective_date?: string;
    current_price?: number;
    new_price?: number;
    invoice?: {
      id: string;
      status: string;
      amount_due: number;
      amount_paid: number;
    };
  };
}

// Billing API Functions (Legacy - to be deprecated)
// This function is kept for backward compatibility but will be removed soon





// Note: This function is deprecated - use React Query hooks with Clerk tokens instead
export const getSubscription = async (clerkToken?: string): Promise<SubscriptionStatus> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/billing/subscription`, {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error getting subscription: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error getting subscription: ${response.statusText} (${response.status})`,
      );
    }

    return response.json();
  } catch (error) {
    console.error('Failed to get subscription:', error);
    handleApiError(error, { operation: 'load subscription', resource: 'billing information' });
    throw error;
  }
};




export const checkBillingStatus = async (clerkToken?: string): Promise<BillingStatusResponse> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/billing/status`, {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error checking billing status: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error checking billing status: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    
    // Add backward compatibility fields
    data.can_run = data.credits_remaining > 0 || data.plan_id === 'byok';
    data.message = data.can_run 
      ? `You have ${data.credits_remaining} credits remaining` 
      : `Insufficient credits. You have ${data.credits_remaining} credits remaining.`;
      
    return data;
  } catch (error) {
    console.error('Failed to check billing status:', error);
    handleApiError(error, { operation: 'check billing status', resource: 'billing information' });
    throw error;
  }
};

// New token-credit API functions
export const getUsageHistory = async (clerkToken?: string, days: number = 30): Promise<UsageHistoryResponse> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/billing/usage-history?days=${days}`, {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error getting usage history: ${response.statusText} (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get usage history:', error);
    handleApiError(error, { operation: 'get usage history', resource: 'usage information' });
    throw error;
  }
};

export const getAvailablePlans = async (clerkToken?: string): Promise<PlanListResponse> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/billing/plans`, {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error getting plans: ${response.statusText} (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to get plans:', error);
    handleApiError(error, { operation: 'get plans', resource: 'plan information' });
    throw error;
  }
};

export const createDodoCheckoutSession = async (
  clerkToken: string, 
  planId: string, 
  successUrl?: string, 
  cancelUrl?: string
): Promise<CheckoutSessionResponse> => {
  try {
    const response = await fetch(`${API_URL}/billing/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plan_id: planId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      }),
    });

    if (!response.ok) {
      // Handle 402 Payment Required errors
      if (response.status === 402) {
        const errorData = await response.json();
        throw new InsufficientCreditsError(errorData.detail);
      }
      
      // Handle 503 Service Unavailable errors (payment processing unavailable)
      if (response.status === 503) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Payment processing is currently unavailable. Please contact support to upgrade your plan.');
      }
      
      throw new Error(`Error creating checkout session: ${response.statusText} (${response.status})`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to create checkout session:', error);
    throw error;
  }
};

// Custom error for insufficient credits
export class InsufficientCreditsError extends Error {
  constructor(public details: any) {
    super(details.message || 'Insufficient credits');
    this.name = 'InsufficientCreditsError';
  }
}

// Transcription API Types
export interface TranscriptionResponse {
  text: string;
}

// Transcription API Functions
export const transcribeAudio = async (audioFile: File, clerkToken?: string): Promise<TranscriptionResponse> => {
  try {
    // Require Clerk token - no Supabase fallback
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const formData = new FormData();
    formData.append('audio_file', audioFile);

    const response = await fetch(`${API_URL}/transcription`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error transcribing audio: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error transcribing audio: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to transcribe audio:', error);
    handleApiError(error, { operation: 'transcribe audio', resource: 'audio file' });
    throw error;
  }
};

// Removed getAgentBuilderChatHistory - agent builder functionality no longer supported

// Thread naming function
export const updateThreadName = async (threadId: string, name: string, clerkToken?: string): Promise<any> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication token required. Please provide a Clerk token.');
    }

    return await updateThreadNameUtil(threadId, name, clerkToken);
  } catch (error) {
    console.error('Failed to update thread name:', error);
    handleApiError(error, { operation: 'update thread name', resource: 'thread' });
    throw error;
  }
};

// Test function to check Supabase connection
export const testSupabaseConnection = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const supabase = createClient();
    
    // Try a simple query that doesn't require auth
    const { data, error } = await supabase
      .from('projects')
      .select('count')
      .eq('is_public', true)
      .limit(1);
    
    if (error) {
      return { 
        success: false, 
        message: `Supabase error: ${error.message} (${error.code})` 
      };
    }
    
    return { 
      success: true, 
      message: 'Supabase connection successful' 
    };
  } catch (err) {
    return { 
      success: false, 
      message: `Connection error: ${err instanceof Error ? err.message : 'Unknown error'}` 
    };
  }
};

// Function to download entire sandbox code as zip
export const downloadSandboxCode = async (
  sandboxId: string,
  projectName: string,
  clerkToken?: string,
  appType: 'web' | 'mobile' = 'web',
): Promise<void> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    // Import JSZip dynamically to avoid bundle size issues
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    // Helper function to check if directory should be excluded from download
    const isExcludedDirectory = (dirName: string): boolean => {
      const excludedDirs = [
        // Package managers and dependencies
        'node_modules',
        'bower_components',
        'vendor',
        
        // Build outputs and caches
        '.next',
        'dist',
        'build',
        'out',
        '.cache',
        '.parcel-cache',
        '.turbo',
        
        // IDE and editor directories
        '.vscode',
        '.idea',
        '.vs',
        '.settings',
        
        // Version control
        '.git',
        '.svn',
        '.hg',
        
        // Testing and coverage
        'coverage',
        '.nyc_output',
        '.jest',
        'jest-coverage',
        
        // Temporary and log directories
        'tmp',
        'temp',
        'logs',
        'log',
        
        // OS generated
        '.DS_Store',
        'Thumbs.db',
        
        // Other common build/cache directories
        '.gradle',
        '.mvn',
        'target',
        'bin',
        'obj',
        '.terraform',
        '__pycache__',
        '.pytest_cache'
      ];
      return excludedDirs.includes(dirName);
    };

    // Recursive function to add all files to zip
    const addFilesToZip = async (directoryPath: string, zipFolder: any) => {
      console.log(`[DOWNLOAD] Fetching directory: ${directoryPath}`);
      const files = await listSandboxFiles(sandboxId, directoryPath, clerkToken);
      
      for (const file of files) {
        if (file.is_dir) {
          // Skip excluded directories EARLY - don't recurse into them
          if (isExcludedDirectory(file.name)) {
            console.log(`[DOWNLOAD] Skipping excluded directory: ${file.name}`);
            continue;
          }
          
          // Create subdirectory in zip and recurse
          const subFolder = zipFolder.folder(file.name);
          await addFilesToZip(file.path, subFolder);
        } else {
          // Add file to zip
          try {
            console.log(`[DOWNLOAD] Adding file: ${file.name}`);
            const content = await getSandboxFileContent(sandboxId, file.path, clerkToken);
            if (content instanceof Blob) {
              zipFolder.file(file.name, content);
            } else {
              zipFolder.file(file.name, content);
            }
          } catch (error) {
            console.warn(`Failed to download file ${file.path}:`, error);
          }
        }
      }
    };

    // Start from the workspace directory
    const workspacePath = appType === 'mobile' ? '/workspace/cheatcode-mobile' : '/workspace/cheatcode-app';
    await addFilesToZip(workspacePath, zip);

    // Generate zip file
    console.log('[DOWNLOAD] Generating zip file...');
    const content = await zip.generateAsync({ type: 'blob' });

    // Create download link and trigger download
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${projectName || 'project'}-code.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log('[DOWNLOAD] Download completed successfully');
  } catch (error) {
    console.error('Failed to download sandbox code:', error);
    handleApiError(error, { operation: 'download code', resource: 'project files' });
    throw error;
  }
};
