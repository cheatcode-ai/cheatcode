import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type Project } from '@/lib/api';
import { type useThreadQuery } from '@/hooks/react-query/threads/use-threads';
import { type useMessagesQuery } from '@/hooks/react-query/threads/use-messages';
import { type useProjectQuery } from '@/hooks/react-query/threads/use-project';
import { type useAgentRunsQuery } from '@/hooks/react-query/threads/use-agent-run';
import { type UnifiedMessage, type AgentStatus } from '../_types';
import { useThreadMetadata } from './useThreadMetadata';
import { useThreadMessages } from './useThreadMessages';
import { useAgentRunState } from './useAgentRunState';

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

/**
 * Composite hook for thread data management
 *
 * This hook combines:
 * - useThreadMetadata: Thread and project metadata
 * - useThreadMessages: Message loading and state
 * - useAgentRunState: Agent run tracking
 *
 * For finer-grained control, use the individual hooks directly.
 */
export function useThreadData(
  threadId: string,
  projectId: string,
): UseThreadDataReturn {
  // Use individual focused hooks
  const metadata = useThreadMetadata(threadId, projectId);
  const agentRun = useAgentRunState(threadId);
  const messagesHook = useThreadMessages(
    threadId,
    agentRun.agentStatus,
    metadata.isLoading,
  );

  // Track overall initial load completion
  const [initialLoadCompleted, setInitialLoadCompleted] = useState(false);
  const initialLoadCompletedRef = useRef(false);

  // Compute overall loading state
  const isLoading =
    metadata.isLoading || messagesHook.isLoading || agentRun.isLoading;

  // Track when all data is loaded
  useEffect(() => {
    if (
      !metadata.isLoading &&
      !messagesHook.isLoading &&
      !agentRun.isLoading &&
      !initialLoadCompletedRef.current
    ) {
      initialLoadCompletedRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInitialLoadCompleted(true);
    }
  }, [metadata.isLoading, messagesHook.isLoading, agentRun.isLoading]);

  // Show error toast if there's a metadata error
  useEffect(() => {
    if (metadata.error) {
      toast.error(metadata.error);
    }
  }, [metadata.error]);

  return {
    // Messages
    messages: messagesHook.messages,
    setMessages: messagesHook.setMessages,

    // Project metadata
    project: metadata.project,
    sandboxId: metadata.sandboxId,
    projectName: metadata.projectName,

    // Agent run state
    agentRunId: agentRun.agentRunId,
    setAgentRunId: agentRun.setAgentRunId,
    agentStatus: agentRun.agentStatus,
    setAgentStatus: agentRun.setAgentStatus,

    // Overall state
    isLoading,
    error: metadata.error,
    initialLoadCompleted,

    // Queries for direct access
    threadQuery: metadata.threadQuery,
    messagesQuery: messagesHook.messagesQuery,
    projectQuery: metadata.projectQuery,
    agentRunsQuery: agentRun.agentRunsQuery,
  };
}

// Re-export individual hooks for direct use
