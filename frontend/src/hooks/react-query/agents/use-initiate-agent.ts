'use client';

import { initiateAgent, InitiateAgentResponse } from "@/lib/api";
import { createMutationHook } from "@/hooks/use-query";
import { handleApiSuccess, handleApiError } from "@/lib/error-handler";
import { agentKeys } from "./keys";
import { useQueryClient } from "@tanstack/react-query";
import { useModal } from "@/hooks/use-modal-store";
import { projectKeys, threadKeys } from "../sidebar/keys";
import { useAuth } from '@clerk/nextjs';

export const useInitiateAgentMutation = () => {
  const { getToken } = useAuth();
  
  return createMutationHook<InitiateAgentResponse, FormData>(
    async (formData) => {
      const token = await getToken();
      return initiateAgent(formData, token || undefined);
    },
    {
      errorContext: { operation: 'initiate agent', resource: 'AI assistant' },
      onSuccess: (data) => {
        handleApiSuccess("Agent initiated successfully", "Your AI assistant is ready to help");
      },
      onError: (error) => {
        if (error instanceof Error && error.message.toLowerCase().includes("payment required")) {
          // silence toast; handled by the higher-level variant
          return;
        }
        handleApiError(error, { operation: 'initiate agent', resource: 'AI assistant' });
      }
    }
  )();
};

export const useInitiateAgentWithInvalidation = () => {
  const queryClient = useQueryClient();
  const { onOpen } = useModal();
  const { getToken } = useAuth();
  
  return createMutationHook<InitiateAgentResponse, FormData>(
    async (formData) => {
      const token = await getToken();
      return initiateAgent(formData, token || undefined);
    },
    {
      onSuccess: (data) => {
        handleApiSuccess("Agent initiated successfully", "Your AI assistant is ready to help");
        queryClient.invalidateQueries({ queryKey: projectKeys.all });
        queryClient.invalidateQueries({ queryKey: threadKeys.all });
        queryClient.invalidateQueries({ queryKey: agentKeys.initiate() });
      },
      onError: (error) => {
        // Intercept billing error and show dialog instead of corner toast
        if (error instanceof Error && error.message.toLowerCase().includes("payment required")) {
          onOpen("paymentRequiredDialog");
          return;
        }
        handleApiError(error, { operation: 'initiate agent', resource: 'AI assistant' });
      }
    }
  )();
}; 