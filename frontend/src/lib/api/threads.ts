// Thread and Message API Functions
import { createClient, createClientWithToken } from '@/lib/supabase/client';
import { handleApiError } from '../error-handler';
import { updateThreadName as updateThreadNameUtil } from '@/hooks/react-query/threads/utils';
import { API_URL } from './config';
import { Thread, Message } from './types';

export const getThreads = async (projectId?: string, clerkToken?: string): Promise<Thread[]> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/threads`);
    if (projectId) {
      url.searchParams.append('project_id', projectId);
    }

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
    return threads;
  } catch (err) {
    handleApiError(err, { operation: 'load threads', resource: projectId ? `threads for project ${projectId}` : 'threads' });
    return [];
  }
};

export const getThread = async (threadId: string, clerkToken?: string): Promise<Thread> => {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : createClient();

  const { data, error } = await supabase
    .from('threads')
    .select('*')
    .eq('thread_id', threadId)
    .single();

  if (error) {
    handleApiError(error, { operation: 'load thread', resource: `thread ${threadId}` });
    throw new Error(`Error getting thread: ${error.message}`);
  }

  return data;
};

export const createThread = async (projectId: string, accountId?: string, clerkToken?: string): Promise<Thread> => {
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  if (!accountId) {
    throw new Error('Account ID is required to create a thread');
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from('threads')
    .insert({
      project_id: projectId,
      user_id: accountId,  // Database column is user_id, not account_id
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

  const message = {
    role: 'user',
    content: content,
  };

  const { error } = await supabase.from('messages').insert({
    thread_id: threadId,
    type: 'user',
    is_llm_message: true,
    content: JSON.stringify(message),
  });

  if (error) {
    handleApiError(error, { operation: 'add message', resource: 'message' });
    throw new Error(`Error adding message: ${error.message}`);
  }
};

export const getMessages = async (threadId: string, clerkToken?: string): Promise<Message[]> => {
  const supabase = clerkToken ? createClientWithToken(clerkToken) : createClient();

  let allMessages: Message[] = [];
  let from = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('thread_id', threadId)
      .neq('type', 'cost')
      .neq('type', 'summary')
      .order('created_at', { ascending: true })
      .range(from, from + batchSize - 1);

    if (error) {
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

  return allMessages;
};

export const updateThreadName = async (threadId: string, name: string, clerkToken?: string): Promise<any> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication token required. Please provide a Clerk token.');
    }

    return await updateThreadNameUtil(threadId, name, clerkToken);
  } catch (error) {
    handleApiError(error, { operation: 'update thread name', resource: 'thread' });
    throw error;
  }
};
