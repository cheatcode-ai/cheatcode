import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  getAgentStatus,
  stopAgent,
  AgentRun,
  getMessages,
  streamAgent,
} from '@/lib/api';
import { toast } from 'sonner';
import {
  UnifiedMessage,
  ParsedContent,
  ParsedMetadata,
} from '@/components/thread/types';
import { safeJsonParse } from '@/components/thread/utils';

interface ApiMessageType {
  message_id?: string;
  thread_id?: string;
  type: string;
  is_llm_message?: boolean;
  content: string;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
  agent_id?: string;
  agents?: {
    name: string;
    avatar?: string;
    avatar_color?: string;
  };
}

// Define the structure returned by the hook
export interface UseAgentStreamResult {
  status: string;
  textContent: string;
  toolCall: ParsedContent | null;
  error: string | null;
  agentRunId: string | null; // Expose the currently managed agentRunId
  startStreaming: (runId: string) => void;
  stopStreaming: () => Promise<void>;
}

// Define the callbacks the hook consumer can provide
export interface AgentStreamCallbacks {
  onMessage: (message: UnifiedMessage) => void; // Callback for complete messages
  onStatusChange?: (status: string) => void; // Optional: Notify on internal status changes
  onError?: (error: string) => void; // Optional: Notify on errors
  onClose?: (finalStatus: string) => void; // Optional: Notify when streaming definitively ends
  onAssistantStart?: () => void; // Optional: Notify when assistant starts streaming
  onAssistantChunk?: (chunk: { content: string }) => void; // Optional: Notify on each assistant message chunk
}

// Helper function to map API messages to UnifiedMessages
const mapApiMessagesToUnified = (
  messagesData: ApiMessageType[] | null | undefined,
  currentThreadId: string,
): UnifiedMessage[] => {
  return (messagesData || [])
    .filter((msg) => msg.type !== 'status')
    .map((msg: ApiMessageType) => ({
      message_id: msg.message_id || null,
      thread_id: msg.thread_id || currentThreadId,
      type: (msg.type || 'system') as UnifiedMessage['type'],
      is_llm_message: Boolean(msg.is_llm_message),
      content: msg.content || '',
      metadata: msg.metadata || '{}',
      created_at: msg.created_at || new Date().toISOString(),
      updated_at: msg.updated_at || new Date().toISOString(),
      agent_id: (msg as any).agent_id,
      agents: (msg as any).agents,
    }));
};

export function useAgentStream(
  callbacks: AgentStreamCallbacks,
  threadId: string,
  setMessages: (messages: UnifiedMessage[]) => void,
  streamingActions?: {
    updateStreamingText: (content: string) => void;
    updateStreamingTool: (tool: any) => void;
    clearStreamingContent: () => void;
  },
  getToken?: () => Promise<string | null>
): UseAgentStreamResult {
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [textContent, setTextContent] = useState<
    { content: string; sequence?: number }[]
  >([]);
  const [toolCall, setToolCall] = useState<ParsedContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const currentRunIdRef = useRef<string | null>(null); // Ref to track the run ID being processed
  const threadIdRef = useRef(threadId); // Ref to hold the current threadId
  const setMessagesRef = useRef(setMessages); // Ref to hold the setMessages function
  // EventSource handles reconnection automatically, so we don't need manual reconnect logic

  const orderedTextContent = useMemo(() => {
    return textContent
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      .reduce((acc, curr) => acc + curr.content, '');
  }, [textContent]);

  // Update refs if threadId or setMessages changes
  useEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }
    };
  }, []);

  // Helper function to map backend status to frontend status string
  const mapAgentStatus = (backendStatus: string): string => {
    switch (backendStatus) {
      case 'completed':
        return 'completed';
      case 'stopped':
        return 'stopped';
      case 'failed':
        return 'failed';
      default:
        return 'error';
    }
  };

  // Internal function to update status and notify consumer
  const updateStatus = useCallback(
    (newStatus: string) => {
      if (isMountedRef.current) {
        setStatus(newStatus);
        callbacks.onStatusChange?.(newStatus);
        if (newStatus === 'error' && error) {
          callbacks.onError?.(error);
        }
        if (
          [
            'completed',
            'stopped',
            'failed',
            'error',
            'agent_not_running',
          ].includes(newStatus)
        ) {
          callbacks.onClose?.(newStatus);
        }
      }
    },
    [callbacks, error],
  );

  // Function to handle finalization of a stream (completion, stop, error)
  const finalizeStream = useCallback(
    (finalStatus: string, runId: string | null = agentRunId) => {
      if (!isMountedRef.current) return;

      const currentThreadId = threadIdRef.current;
      const currentSetMessages = setMessagesRef.current;

      console.log(
        `[useAgentStream] Finalizing stream for ${runId} on thread ${currentThreadId} with status: ${finalStatus}`,
      );

      // Close EventSource connection
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }

      // Reset streaming-specific state
      setTextContent([]);
      setToolCall(null);
      
      // Clear external streaming content if callback provided
      streamingActions?.clearStreamingContent();

      // Update status and clear run ID
      updateStatus(finalStatus);
      setAgentRunId(null);
      currentRunIdRef.current = null;

      // --- Reliable Message Refetch on Finalization ---
      const terminalStatuses = [
        'completed',
        'stopped',
        'failed',
        'error',
        'agent_not_running',
      ];
      if (currentThreadId && terminalStatuses.includes(finalStatus)) {
        console.log(
          `[useAgentStream] Scheduling message refetch for thread ${currentThreadId} after finalization with status ${finalStatus}.`,
        );
        
        // Add a delay to allow database writes to complete before refetching
        setTimeout(() => {
          if (!isMountedRef.current) return;
          
          console.log(
            `[useAgentStream] Refetching messages for thread ${currentThreadId} after completion delay.`,
          );
          getMessages(currentThreadId)
            .then((messagesData: ApiMessageType[]) => {
              if (isMountedRef.current && messagesData) {
                console.log(
                  `[useAgentStream] Refetched ${messagesData.length} messages for thread ${currentThreadId}.`,
                );
                              const unifiedMessages = mapApiMessagesToUnified(
                messagesData,
                currentThreadId,
              );
              
              // Use the same deduplication logic as streaming messages
              // instead of replacing the entire message array
              (currentSetMessages as any)((prevMessages: UnifiedMessage[]) => {
                const existingIds = new Set(prevMessages.map(m => m.message_id));
                const newMessages = unifiedMessages.filter(m => !existingIds.has(m.message_id));
                
                console.log(
                  `[useAgentStream] Merging ${newMessages.length} new messages with ${prevMessages.length} existing messages`,
                );
                
                return [...prevMessages, ...newMessages];
              });
              }
            })
            .catch((err) => {
              console.error(
                `[useAgentStream] Error refetching messages for thread ${currentThreadId} after finalization:`,
                err,
              );
              toast.error(`Failed to refresh messages: ${err.message}`);
            });
        }, 2000); // 2 second delay to allow database writes to complete
      }

      // If the run was stopped or completed, try to get final status 
      if (
        runId &&
        (finalStatus === 'completed' ||
          finalStatus === 'stopped' ||
          finalStatus === 'agent_not_running')
      ) {
        // Get authentication token for the status check
        if (getToken) {
          getToken().then(clerkToken => {
            if (clerkToken) {
              getAgentStatus(runId, clerkToken).catch((err) => {
                console.log(
                  `[useAgentStream] Post-finalization status check for ${runId} failed (this might be expected if not found): ${err.message}`,
                );
              });
            }
          });
        }
      }
    },
    [agentRunId, updateStatus, getToken],
  );

  // Stream message handler for EventSource
  const handleStreamMessage = useCallback(
    (rawData: string) => {
      if (!isMountedRef.current) return;
      (window as any).lastStreamMessage = Date.now();

      const processedData = rawData;
      if (!processedData) return;

      // --- Early exit for completion messages ---
      if (
        processedData ===
        '{"type": "status", "status": "completed", "message": "Agent run completed successfully"}'
      ) {
        console.log(
          '[useAgentStream] Received final completion status message',
        );
        finalizeStream('completed', currentRunIdRef.current);
        return;
      }
      if (
        processedData.includes('Run data not available for streaming') ||
        processedData.includes('Stream ended with status: completed')
      ) {
        console.log(
          `[useAgentStream] Detected final completion message: "${processedData}", finalizing.`,
        );
        finalizeStream('completed', currentRunIdRef.current);
        return;
      }

      // --- Check for error messages first ---
      try {
        const jsonData = JSON.parse(processedData);

        if (jsonData.status === 'error') {
          console.error('[useAgentStream] Received error status message:', jsonData);
          const errorMessage = jsonData.message || 'Unknown error occurred';
          setError(errorMessage);
          toast.error(errorMessage, { duration: 15000 });
          callbacks.onError?.(errorMessage);
          return;
        }
        
        // Handle control messages
        if (jsonData.type === 'control') {
          if (jsonData.action === 'stop') {
            console.log('[useAgentStream] Received stop control message');
            finalizeStream('stopped', currentRunIdRef.current);
            return;
          }
        }
        
        // Filter out system messages that shouldn't appear in chat
        if (jsonData.type === 'warning') {
          console.warn('[useAgentStream] Stream warning:', jsonData.message);
          return; // Don't display warnings in chat
        }
        
        if (jsonData.type === 'heartbeat' || jsonData.type === 'ping') {
          return; // Don't display heartbeat messages in chat
        }
        
        if (jsonData.type === 'status' && jsonData.status === 'completed') {
          console.log('[useAgentStream] Received completion status, finalizing stream');
          finalizeStream('completed', currentRunIdRef.current);
          return;
        }
      } catch (jsonError) {
        // Not JSON or could not parse as JSON, continue processing
      }

      // --- Process JSON messages ---
      const message = safeJsonParse(processedData, null) as UnifiedMessage | null;
      if (!message) {
        console.warn(
          '[useAgentStream] Failed to parse streamed message:',
          processedData,
        );
        return;
      }
      

      
      // Only process actual chat message types
      if (message.type && !['assistant', 'user', 'tool', 'system'].includes(message.type)) {
        console.debug(`[useAgentStream] Filtered out message type '${message.type}':`, message);
        return;
      }

      const parsedContent = safeJsonParse<ParsedContent>(message.content, {});
      const parsedMetadata = safeJsonParse<ParsedMetadata>(
        message.metadata,
        {},
      );

      // Update status to streaming on first message
      if (status === 'connecting') {
        updateStatus('streaming');
      }

      // Handle different message types
      switch (message.type) {
        case 'assistant':
          if (
            parsedMetadata.stream_status === 'chunk' &&
            parsedContent.content
          ) {
            // Handle streaming chunks - update UI but don't add to chat
            setTextContent((prev) => {
              return prev.concat({
                sequence: message.sequence || parsedMetadata.sequence || 0,
                content: parsedContent.content,
              });
            });
            callbacks.onAssistantChunk?.({ content: parsedContent.content });
            
            // Update external streaming text if callback provided
            streamingActions?.updateStreamingText(parsedContent.content);
          } else if (parsedMetadata.stream_status === 'complete') {
            // Complete message - clear streaming and add to chat
            setTextContent([]);
            setToolCall(null);
            if (message.message_id) {
              callbacks.onMessage(message);
            }
          } else if (!parsedMetadata.stream_status) {
            // Handle non-chunked assistant messages (fallback)
            // Only add to chat if it looks like a complete message and isn't raw code
            const hasValidContent = parsedContent.content && 
              typeof parsedContent.content === 'string' && 
              parsedContent.content.trim().length > 0;
            
            // Filter out messages that are primarily code or very verbose tool content
            const contentStr = typeof parsedContent.content === 'string' ? parsedContent.content : '';
            const isLikelyCode = contentStr && (
              contentStr.includes('<parameter name=') ||
              contentStr.includes('<function_calls>') ||
              contentStr.includes('```') ||
              (contentStr.length > 2000 && contentStr.includes('<'))
            );
            
            if (hasValidContent && !isLikelyCode) {
              callbacks.onAssistantStart?.();
              if (message.message_id) {
                callbacks.onMessage(message);
              }
            } else if (hasValidContent && isLikelyCode) {
              console.debug('[useAgentStream] Filtered out code-heavy message:', contentStr.substring(0, 100) + '...');
            } else {
              // Treat as streaming chunk if no valid content but has some content
              if (parsedContent.content && !isLikelyCode) {
                setTextContent((prev) => [
                  ...prev,
                  { content: parsedContent.content, sequence: 0 }
                ]);
                callbacks.onAssistantChunk?.({ content: parsedContent.content });
                streamingActions?.updateStreamingText(parsedContent.content);
              }
            }
          }
          break;
          
        case 'tool':
          // Clear any streaming tool call
          setToolCall(null);
          
          // Only add tool messages to chat if they have proper structure
          // and aren't raw tool content/code snippets
          if (message.message_id && parsedContent) {
            // Check if this is a complete tool message vs raw tool content
            const isStructuredTool = 
              (parsedContent.name || parsedContent.function_name) &&
              (parsedContent.result !== undefined || parsedContent.arguments !== undefined);
            
            const isRawContent = typeof parsedContent === 'string' && (parsedContent as string).length > 0 &&
              ((parsedContent as string).includes('<') || 
               (parsedContent as string).includes('```') || 
               (parsedContent as string).length > 1000);
            
            if (isStructuredTool && !isRawContent) {
              callbacks.onMessage(message);
            } else {
              console.debug('[useAgentStream] Filtered out raw tool content:', parsedContent);
            }
          }
          break;
          
        case 'status':
          // Handle status messages based on status_type
          switch (parsedContent.status_type) {
            case 'tool_started':
              setToolCall({
                role: 'assistant',
                status_type: 'tool_started',
                name: parsedContent.function_name,
                arguments: parsedContent.arguments,
              });
              // Update external streaming tool if callback provided
              streamingActions?.updateStreamingTool({
                name: parsedContent.function_name,
                arguments: parsedContent.arguments,
              });
              break;
            case 'thread_run_end':
              console.log('[useAgentStream] Received thread run end status');
              finalizeStream('completed', currentRunIdRef.current);
              break;
            default:
              // Other status messages - log but don't add to chat
              console.log('[useAgentStream] Received status message:', parsedContent);
              break;
          }
          break;
          
        default:
          // For any other message types, only add to chat if they have a message_id
          if (message.message_id) {
            callbacks.onMessage(message);
          } else {
            console.debug('[useAgentStream] Skipping message without ID:', message.type);
          }
          break;
      }
    },
    [callbacks, status, updateStatus, finalizeStream, streamingActions],
  );

  // Stream error handler for EventSource
  const handleStreamError = useCallback(
    (error: Error | string) => {
      if (!isMountedRef.current) return;

      console.error('[useAgentStream] Stream error:', error);
      const errorMessage = error instanceof Error ? error.message : error;
      setError(errorMessage);
      toast.error(errorMessage, { duration: 15000 });
      callbacks.onError?.(errorMessage);
    },
    [callbacks],
  );

  // Stream close handler for EventSource
  const handleStreamClose = useCallback(
    () => {
      if (!isMountedRef.current) return;
      
      console.log('[useAgentStream] Stream connection closed');
      
      const runId = currentRunIdRef.current;
      if (!runId) {
        console.warn('[useAgentStream] Stream closed but no active agentRunId.');
        if (status === 'streaming' || status === 'connecting') {
          finalizeStream('completed');
        }
        return;
      }

      // EventSource closed, likely agent completed normally
      finalizeStream('completed', runId);
    },
    [status, finalizeStream],
  );

  // Function to establish EventSource connection
  const startEventSourceStream = useCallback(
    async (runId: string) => {
      if (!isMountedRef.current) return;

      // Close existing connection
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }

      // Get authentication token
      if (!getToken) {
        console.error('[useAgentStream] No getToken function provided');
        finalizeStream('error', runId);
        return;
      }

      const clerkToken = await getToken();
      if (!clerkToken) {
        console.error('[useAgentStream] No authentication token available');
        finalizeStream('error', runId);
        return;
      }

      console.log(`[useAgentStream] Starting EventSource stream for ${runId}`);

      try {
        // Use the streamAgent function from the API
        const cleanup = streamAgent(runId, {
          onMessage: handleStreamMessage,
          onError: handleStreamError,
          onClose: handleStreamClose,
        }, clerkToken);

        streamCleanupRef.current = cleanup;
        console.log(`[useAgentStream] EventSource stream established for ${runId}`);

      } catch (error) {
        console.error('[useAgentStream] Failed to create EventSource stream:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to connect';
        setError(errorMessage);
        finalizeStream('error', runId);
      }
    },
    [handleStreamMessage, handleStreamError, handleStreamClose, finalizeStream, getToken],
  );

  const startStreaming = useCallback(
    async (runId: string) => {
      if (!isMountedRef.current) return;
      console.log(
        `[useAgentStream] Received request to start streaming for ${runId}`,
      );

      // Clean up any previous connection
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }

      // Reset state before starting
      setTextContent([]);
      setToolCall(null);
      setError(null);
      
      // Clear external streaming content if callback provided
      streamingActions?.clearStreamingContent();
      updateStatus('connecting');
      setAgentRunId(runId);
      currentRunIdRef.current = runId;

      try {
        // Verify agent is running before connecting
        const clerkToken = getToken ? await getToken() : null;
        const agentStatus = await getAgentStatus(runId, clerkToken);
        if (!isMountedRef.current) return;

        if (agentStatus.status !== 'running') {
          console.warn(
            `[useAgentStream] Agent run ${runId} is not in running state (status: ${agentStatus.status}). Cannot start stream.`,
          );
          setError(`Agent run is not running (status: ${agentStatus.status})`);
          finalizeStream(
            mapAgentStatus(agentStatus.status) || 'agent_not_running',
            runId,
          );
          return;
        }

        // Agent is running, establish EventSource connection
        await startEventSourceStream(runId);
      } catch (err) {
        if (!isMountedRef.current) return;

        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(
          `[useAgentStream] Error initiating stream for ${runId}: ${errorMessage}`,
        );
        setError(errorMessage);

        const isNotFoundError =
          errorMessage.includes('not found') ||
          errorMessage.includes('404') ||
          errorMessage.includes('does not exist');

        finalizeStream(isNotFoundError ? 'agent_not_running' : 'error', runId);
      }
    },
    [updateStatus, finalizeStream, mapAgentStatus, startEventSourceStream, getToken],
  );

  const stopStreaming = useCallback(async () => {
    if (!isMountedRef.current || !agentRunId) return;

    const runIdToStop = agentRunId;
    console.log(
      `[useAgentStream] Stopping stream for agent run ${runIdToStop}`,
    );

    // Immediately update status and clean up stream
    finalizeStream('stopped', runIdToStop);

    try {
      await stopAgent(runIdToStop);
      toast.success('Agent stopped.');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(
        `[useAgentStream] Error sending stop request for ${runIdToStop}: ${errorMessage}`,
      );
      toast.error(`Failed to stop agent: ${errorMessage}`);
    }
  }, [agentRunId, finalizeStream]);

  return {
    status,
    textContent: orderedTextContent,
    toolCall,
    error,
    agentRunId,
    startStreaming,
    stopStreaming,
  };
}