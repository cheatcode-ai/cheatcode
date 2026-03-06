'use client';

import { initiateAgent, type InitiateAgentResponse } from '@/lib/api';
import { createMutationHook } from '@/hooks/use-query';
import { handleApiSuccess, handleApiError } from '@/lib/error-handler';
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
      onSuccess: (_data) => {
        handleApiSuccess(
          'Agent initiated successfully',
          'Your AI assistant is ready to help',
        );
      },
      onError: (error) => {
        if (
          error instanceof Error &&
          error.message.toLowerCase().includes('payment required')
        ) {
          // silence toast; handled by the higher-level variant
          return;
        }
        handleApiError(error, {
          operation: 'initiate agent',
          resource: 'AI assistant',
        });
      },
    },
  )();
};
