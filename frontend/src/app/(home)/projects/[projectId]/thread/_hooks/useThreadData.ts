import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Project } from '@/lib/api';
import { useThreadQuery } from '@/hooks/react-query/threads/use-threads';
import { useMessagesQuery } from '@/hooks/react-query/threads/use-messages';
import { useProjectQuery } from '@/hooks/react-query/threads/use-project';
import { useAgentRunsQuery } from '@/hooks/react-query/threads/use-agent-run';
import { ApiMessageType, UnifiedMessage, AgentStatus } from '../_types';

interface UseThreadDataReturn {
  messages: UnifiedMessage[];
  setMessages: React.Dispatch<React.SetStateAction<UnifiedMessage[]>>;
  project: Project | null;
  sandboxId: string | null;
  projectName: string;
  agentRunId: string | null;
  setAgentRunId: React.Dispatch<React.SetStateAction<string | null>>;
  agentStatus: AgentStatus;
  setAgentStatus: React.Dispatch<React.SetStateAction<AgentStatus>>;
  isLoading: boolean;
  error: string | null;
  initialLoadCompleted: boolean;
  threadQuery: ReturnType<typeof useThreadQuery>;
  messagesQuery: ReturnType<typeof useMessagesQuery>;
  projectQuery: ReturnType<typeof useProjectQuery>;
  agentRunsQuery: ReturnType<typeof useAgentRunsQuery>;
}

export function useThreadData(threadId: string, projectId: string): UseThreadDataReturn {
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('');
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const initialLoadCompleted = useRef<boolean>(false);
  const messagesLoadedRef = useRef(false);
  const agentRunsCheckedRef = useRef(false);
  const hasInitiallyScrolled = useRef<boolean>(false);

  const threadQuery = useThreadQuery(threadId);
  const messagesQuery = useMessagesQuery(threadId);
  const projectQuery = useProjectQuery(projectId);
  const agentRunsQuery = useAgentRunsQuery(threadId);

  useEffect(() => {
    let isMounted = true;

    async function initializeData() {
      if (!initialLoadCompleted.current) setIsLoading(true);
      setError(null);
      try {
        if (!threadId) throw new Error('Thread ID is required');

        if (threadQuery.isError) {
          const errorMessage = threadQuery.error instanceof Error 
            ? threadQuery.error.message 
            : JSON.stringify(threadQuery.error);
          throw new Error('Failed to load thread data: ' + errorMessage);
        }
        if (!isMounted) return;

        if (projectQuery.data) {
          // Map project data to match the Project type
          const projectData = {
            ...projectQuery.data,
            id: projectQuery.data.project_id || (projectQuery.data as any).id || projectId
          };
          setProject(projectData);
          
          if (typeof projectQuery.data.sandbox === 'string') {
            setSandboxId(projectQuery.data.sandbox);
          } else if (projectQuery.data.sandbox?.id) {
            setSandboxId(projectQuery.data.sandbox.id);
          }

          setProjectName(projectQuery.data.name || '');
        }

        if (messagesQuery.data && !messagesLoadedRef.current) {
          const unifiedMessages = (messagesQuery.data || [])
            .filter((msg) => {
              // Only filter out internal system messages that are definitely not user-facing
              if (msg.type === 'status') {
                const statusType = typeof msg.content === 'object' && msg.content ? (msg.content as any).status_type : null;
                // Only hide these specific internal status types
                const internalStatusTypes = ['thread_run_start', 'thread_run_end', 'assistant_response_start', 'finish'];
                return !internalStatusTypes.includes(statusType);
              }
              
              // Keep all other message types
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

          setMessages(unifiedMessages);
          console.log('[PAGE] Loaded Messages (including tool statuses):', unifiedMessages.length);
          messagesLoadedRef.current = true;

          if (!hasInitiallyScrolled.current) {
            hasInitiallyScrolled.current = true;
          }
        }

        if (agentRunsQuery.data && !agentRunsCheckedRef.current && isMounted) {
          console.log('[PAGE] Checking for active agent runs...');
          agentRunsCheckedRef.current = true;

          const activeRun = agentRunsQuery.data.find((run) => run.status === 'running');
          if (activeRun && isMounted) {
            console.log('[PAGE] Found active run on load:', activeRun.id);
            setAgentRunId(activeRun.id);
          } else {
            console.log('[PAGE] No active agent runs found');
            if (isMounted) setAgentStatus('idle');
          }
        }

        if (threadQuery.data && messagesQuery.data && agentRunsQuery.data) {
          initialLoadCompleted.current = true;
          setIsLoading(false);
        }

      } catch (err) {
        console.error('Error loading thread data:', err);
        if (isMounted) {
          const errorMessage =
            err instanceof Error ? err.message : 'Failed to load thread';
          setError(errorMessage);
          toast.error(errorMessage);
          setIsLoading(false);
        }
      }
    }

    if (threadId) {
      initializeData();
    }

    return () => {
      isMounted = false;
    };
  }, [
    threadId,
    projectId,
    threadQuery.data,
    threadQuery.isError,
    threadQuery.error,
    projectQuery.data,
    messagesQuery.data,
    messagesQuery.isLoading,
    messagesQuery.isError,
    messagesQuery.error?.message,
    agentRunsQuery.data
  ]);

  useEffect(() => {
    if (messagesQuery.data && messagesQuery.status === 'success') {
      // Only update messages from server if we're not actively streaming/connecting
      if (!isLoading && agentStatus !== 'running' && agentStatus !== 'connecting') {
        const unifiedMessages = (messagesQuery.data || [])
          .filter((msg) => {
            // Keep all non-status messages
            if (msg.type !== 'status') return true;
            
            // For status messages, only show user-visible tool statuses
            const statusType = typeof msg.content === 'object' && msg.content ? (msg.content as any).status_type : null;
            return statusType && ['tool_started', 'tool_completed', 'tool_failed'].includes(statusType);
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
  }, [messagesQuery.data, messagesQuery.status, isLoading, agentStatus, threadId]);

  return {
    messages,
    setMessages,
    project,
    sandboxId,
    projectName,
    agentRunId,
    setAgentRunId,
    agentStatus,
    setAgentStatus,
    isLoading,
    error,
    initialLoadCompleted: initialLoadCompleted.current,
    threadQuery,
    messagesQuery,
    projectQuery,
    agentRunsQuery,
  };
} 
