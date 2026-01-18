import { useState, useEffect, useRef, useCallback } from 'react';
import { useMessagesQuery } from '@/hooks/react-query/threads/use-messages';
import { ApiMessageType, UnifiedMessage, AgentStatus } from '../_types';

interface UseThreadMessagesReturn {
  messages: UnifiedMessage[];
  setMessages: React.Dispatch<React.SetStateAction<UnifiedMessage[]>>;
  isLoading: boolean;
  initialLoadCompleted: boolean;
  messagesQuery: ReturnType<typeof useMessagesQuery>;
}

/**
 * Transforms API messages to unified format
 */
function transformMessages(
  apiMessages: ApiMessageType[],
  threadId: string,
  filterStatusMessages = true
): UnifiedMessage[] {
  return (apiMessages || [])
    .filter((msg) => {
      if (!filterStatusMessages) return true;

      // Only filter out internal system messages
      if (msg.type === 'status') {
        const statusType = typeof msg.content === 'object' && msg.content
          ? (msg.content as { status_type?: string }).status_type
          : null;
        // Only hide these specific internal status types
        const internalStatusTypes = ['thread_run_start', 'thread_run_end', 'assistant_response_start', 'finish'];
        return !internalStatusTypes.includes(statusType || '');
      }

      return true;
    })
    .map((msg: ApiMessageType) => ({
      message_id: msg.message_id || null,
      thread_id: msg.thread_id || threadId,
      type: (msg.type || 'system') as UnifiedMessage['type'],
      is_llm_message: Boolean(msg.is_llm_message),
      content: msg.content || '',
      metadata: msg.metadata || '{}',
      created_at: msg.created_at || new Date().toISOString(),
      updated_at: msg.updated_at || new Date().toISOString(),
    }));
}

/**
 * Hook for thread messages management
 * Handles message fetching, transformation, and optimistic updates
 */
export function useThreadMessages(
  threadId: string,
  agentStatus: AgentStatus = 'idle',
  isParentLoading = false
): UseThreadMessagesReturn {
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const messagesLoadedRef = useRef(false);
  const initialLoadCompleted = useRef(false);

  const messagesQuery = useMessagesQuery(threadId);

  // Track query state for dependency stability
  const queryIsError = messagesQuery.isError;
  const queryIsLoading = messagesQuery.isLoading;

  // Initial messages load - handle both success and error cases
  useEffect(() => {
    if (!messagesLoadedRef.current) {
      // Handle successful data load
      if (messagesQuery.data) {
        const unifiedMessages = transformMessages(messagesQuery.data, threadId);
        setMessages(unifiedMessages);
        messagesLoadedRef.current = true;
        initialLoadCompleted.current = true;
        setIsLoading(false);
      }
      // Handle error or completed with no data
      else if (queryIsError || (!queryIsLoading && !messagesQuery.data)) {
        messagesLoadedRef.current = true;
        initialLoadCompleted.current = true;
        setIsLoading(false);
      }
    }
  }, [messagesQuery.data, queryIsError, queryIsLoading, threadId]);

  // Handle subsequent message updates (when not streaming)
  useEffect(() => {
    if (messagesQuery.data && messagesQuery.status === 'success') {
      // Only update messages from server if we're not actively streaming/connecting
      if (!isParentLoading && agentStatus !== 'running' && agentStatus !== 'connecting') {
        const unifiedMessages = transformMessages(messagesQuery.data, threadId);

        // Use callback form to check current state and prevent unnecessary updates
        setMessages(currentMessages => {
          // Check if we have any optimistic messages that shouldn't be overridden
          const hasOptimisticMessages = currentMessages.some(msg =>
            msg.message_id && msg.message_id.toString().startsWith('temp-')
          );

          // Only update from server if we don't have optimistic messages
          if (!hasOptimisticMessages) {
            return unifiedMessages;
          }

          // Keep current messages if we have optimistic ones
          return currentMessages;
        });
      }
    }
  }, [messagesQuery.data, messagesQuery.status, isParentLoading, agentStatus, threadId]);

  return {
    messages,
    setMessages,
    isLoading,
    initialLoadCompleted: initialLoadCompleted.current,
    messagesQuery,
  };
}

/**
 * Hook for adding optimistic messages
 */
export function useOptimisticMessage() {
  const addOptimisticMessage = useCallback((
    setMessages: React.Dispatch<React.SetStateAction<UnifiedMessage[]>>,
    content: string,
    threadId: string,
    type: UnifiedMessage['type'] = 'user'
  ) => {
    const tempMessage: UnifiedMessage = {
      message_id: `temp-${Date.now()}`,
      thread_id: threadId,
      type,
      is_llm_message: false,
      content,
      metadata: '{}',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setMessages(prev => [...prev, tempMessage]);
    return tempMessage;
  }, []);

  return { addOptimisticMessage };
}
