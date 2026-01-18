import { useState, useEffect, useRef } from 'react';
import { useAgentRunsQuery } from '@/hooks/react-query/threads/use-agent-run';
import { AgentStatus } from '../_types';

interface UseAgentRunStateReturn {
  agentRunId: string | null;
  setAgentRunId: React.Dispatch<React.SetStateAction<string | null>>;
  agentStatus: AgentStatus;
  setAgentStatus: React.Dispatch<React.SetStateAction<AgentStatus>>;
  isLoading: boolean;
  agentRunsQuery: ReturnType<typeof useAgentRunsQuery>;
}

/**
 * Hook for agent run state management
 * Handles active run detection and status tracking
 */
export function useAgentRunState(threadId: string): UseAgentRunStateReturn {
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [isLoading, setIsLoading] = useState(true);

  const agentRunsCheckedRef = useRef(false);

  const agentRunsQuery = useAgentRunsQuery(threadId);

  // Track query state for dependency stability
  const queryIsError = agentRunsQuery.isError;
  const queryIsLoading = agentRunsQuery.isLoading;

  // Check for active runs on data load or error
  useEffect(() => {
    if (!agentRunsCheckedRef.current) {
      // Handle successful data load
      if (agentRunsQuery.data) {
        agentRunsCheckedRef.current = true;

        const activeRun = agentRunsQuery.data.find((run) => run.status === 'running');
        if (activeRun) {
          setAgentRunId(activeRun.id);
          setAgentStatus('running');
        } else {
          setAgentStatus('idle');
        }

        setIsLoading(false);
      }
      // Handle error or completed with no data
      else if (queryIsError || (!queryIsLoading && !agentRunsQuery.data)) {
        agentRunsCheckedRef.current = true;
        setAgentStatus('idle');
        setIsLoading(false);
      }
    }
  }, [agentRunsQuery.data, queryIsError, queryIsLoading]);

  // Reset checked ref when threadId changes
  useEffect(() => {
    agentRunsCheckedRef.current = false;
    setAgentRunId(null);
    setAgentStatus('idle');
    setIsLoading(true);
  }, [threadId]);

  return {
    agentRunId,
    setAgentRunId,
    agentStatus,
    setAgentStatus,
    isLoading,
    agentRunsQuery,
  };
}
