import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { BillingError, getAgentRuns, startAgent, stopAgent } from "@/lib/api";
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';

export const useAgentRunsQuery = (threadId: string) => {
  const { getToken, isLoaded } = useAuth();

  return createQueryHook(
    threadKeys.agentRuns(threadId),
    async () => {
      const token = await getToken();
      const result = await getAgentRuns(threadId, token || undefined);
      return result;
    },
    {
      enabled: !!threadId && isLoaded,
      retry: (failureCount, error) => {
        // Don't retry authentication errors
        if (error?.message?.includes('Authentication required')) {
          return false;
        }
        return failureCount < 2;
      },
      staleTime: 5 * 60 * 1000, // 5 minutes cache
      gcTime: 30 * 60 * 1000, // 30 minutes
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    }
  )();
};

export const useStartAgentMutation = () => {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  
  return createMutationHook(
    async ({
      threadId,
      options,
    }: {
      threadId: string;
      options?: {
        model_name?: string;
        enable_thinking?: boolean;
        reasoning_effort?: string;
        stream?: boolean;
        app_type?: 'web' | 'mobile';
      };
    }) => {
      try {
        const token = await getToken();
        const result = await startAgent(threadId, options, token || undefined);
        
        // Invalidate billing status cache since credits were consumed
        queryClient.invalidateQueries({ queryKey: threadKeys.billingStatus });
        
        return result;
      } catch (error) {
        if (!(error instanceof BillingError)) {
          throw error;
        }
        throw error;
      }
    }
  )();
};

export const useStopAgentMutation = () => {
  const { getToken } = useAuth();
  
  return createMutationHook(
    async (agentRunId: string) => {
      const token = await getToken();
      const result = await stopAgent(agentRunId, token || undefined);
      return result;
    }
  )();
};
