import { createMutationHook, createQueryHook } from "@/hooks/use-query";
import { threadKeys } from "./keys";
import { BillingError, getAgentRuns, startAgent, stopAgent } from "@/lib/api";
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';

export const useAgentRunsQuery = (threadId: string) => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  
  return createQueryHook(
    threadKeys.agentRuns(threadId),
    async () => {
      const token = await getToken();
      const result = await getAgentRuns(threadId, token || undefined);
      return result;
    },
    {
      enabled: !!threadId && isLoaded && isSignedIn,
      retry: (failureCount, error) => {
        // Don't retry authentication errors
        if (error?.message?.includes('Authentication required')) {
          return false;
        }
        return failureCount < 2;
      },
      staleTime: 1000 * 30, // Consider data fresh for 30 seconds
      refetchOnWindowFocus: false, // Don't refetch on every window focus
    }
  )();
};

export const useStartAgentMutation = () => {
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
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
        agent_id?: string;
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
  const { getToken, isLoaded, isSignedIn, userId } = useAuth();
  
  return createMutationHook(
    async (agentRunId: string) => {
      const token = await getToken();
      const result = await stopAgent(agentRunId, token || undefined);
      return result;
    }
  )();
};
