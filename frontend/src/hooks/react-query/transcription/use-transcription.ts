import { createMutationHook } from '@/hooks/use-query';
import { transcribeAudio, TranscriptionResponse } from '@/lib/api';
import { useAuth } from '@clerk/nextjs';

// The transcribeAudio API requires a Clerk session token.
// This hook fetches the token on each mutation and forwards it.

export const useTranscription = () => {
  const { getToken } = useAuth();

  const useMutationHook = createMutationHook<TranscriptionResponse, File>(
    async (audioFile: File) => {
      const token = await getToken();

      if (!token) {
        throw new Error('Authentication required. Please sign in to continue.');
      }

      return transcribeAudio(audioFile, token);
    },
    {
      errorContext: {
        operation: 'transcribe audio',
        resource: 'speech-to-text',
      },
    },
  );

  // Return the actual mutation instance
  return useMutationHook();
}; 