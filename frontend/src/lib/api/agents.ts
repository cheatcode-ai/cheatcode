// Agent API Functions
import { handleApiError } from '../error-handler';
import { API_URL } from './config';
import { BillingError, ProjectInitiationError, SandboxCreationError, InitiationAuthError } from './errors';
import { AgentRun, InitiateAgentResponse, HealthCheckResponse } from './types';

export const startAgent = async (
  threadId: string,
  options?: {
    model_name?: string;
    enable_thinking?: boolean;
    reasoning_effort?: string;
    stream?: boolean;
    app_type?: 'web' | 'mobile';
  },
  clerkToken?: string,
): Promise<{ agent_run_id: string }> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    if (!API_URL) {
      throw new Error(
        'Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.',
      );
    }

    const defaultOptions = {
      enable_thinking: false,
      reasoning_effort: 'low',
      stream: true,
      app_type: 'web' as const,
    } as const;

    const finalOptions = { ...defaultOptions, ...options };

    const body: any = {
      enable_thinking: finalOptions.enable_thinking,
      reasoning_effort: finalOptions.reasoning_effort,
      stream: finalOptions.stream,
      app_type: finalOptions.app_type,
    };

    if (finalOptions.model_name) {
      body.model_name = finalOptions.model_name;
    }

    const response = await fetch(`${API_URL}/thread/${threadId}/agent/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${clerkToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      if (response.status === 402) {
        try {
          const errorData = await response.json();
          console.error(`[API] Billing error starting agent (402):`, errorData);
          const detail = errorData?.detail || { message: 'Payment Required' };
          if (typeof detail.message !== 'string') {
            detail.message = 'Payment Required';
          }
          throw new BillingError(response.status, detail);
        } catch (parseError) {
          console.error('[API] Could not parse 402 error response body:', parseError);
          throw new BillingError(
            response.status,
            { message: 'Payment Required' },
            `Error starting agent: ${response.statusText} (402)`,
          );
        }
      }

      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `[API] Error starting agent: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error starting agent: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    if (error instanceof BillingError) {
      throw error;
    }

    console.error('[API] Failed to start agent:', error);

    if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      const networkError = new Error(
        `Cannot connect to backend server. Please check your internet connection and make sure the backend is running.`,
      );
      handleApiError(networkError, { operation: 'start agent', resource: 'AI assistant' });
      throw networkError;
    }

    handleApiError(error, { operation: 'start agent', resource: 'AI assistant' });
    throw error;
  }
};

export const stopAgent = async (agentRunId: string, clerkToken?: string): Promise<void> => {
  if (!clerkToken) {
    throw new Error('Authentication required. Please sign in to continue.');
  }

  const response = await fetch(`${API_URL}/agent-run/${agentRunId}/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${clerkToken}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const stopError = new Error(`Error stopping agent: ${response.statusText}`);
    handleApiError(stopError, { operation: 'stop agent', resource: 'AI assistant' });
    throw stopError;
  }
};

export const getAgentStatus = async (agentRunId: string, clerkToken?: string): Promise<AgentRun> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = `${API_URL}/agent-run/${agentRunId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `[API] Error getting agent status: ${response.status} ${response.statusText}`,
        errorText,
      );

      throw new Error(
        `Error getting agent status: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    return data;
  } catch (err) {
    console.error(`[API] Error in getAgentStatus for ${agentRunId}:`, err);
    throw err;
  }
};

export const getAgentRuns = async (threadId: string, clerkToken?: string): Promise<AgentRun[]> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/thread/${threadId}/agent-runs`, {
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Error getting agent runs: ${response.statusText}`);
    }

    const data = await response.json();
    return data.agent_runs || [];
  } catch (error) {
    console.error('Failed to get agent runs:', error);
    handleApiError(error, { operation: 'load agent runs', resource: 'conversation history' });
    throw error;
  }
};

// EventSource-based agent streaming implementation
export const streamAgent = (
  agentRunId: string,
  callbacks: {
    onMessage: (content: string) => void;
    onError: (error: Error | string) => void;
    onClose: () => void;
  },
  clerkToken?: string,
): (() => void) => {
  if (!clerkToken) {
    const authError = new Error('Authentication required. Please sign in to continue.');
    console.error('[streamAgent] No Clerk token available');
    callbacks.onError(authError);
    callbacks.onClose();
    return () => {};
  }

  let eventSource: EventSource | null = null;
  let isClosed = false;
  let errorCount = 0;
  const maxErrors = 5;
  let lastErrorTime = 0;

  const cleanup = () => {
    if (eventSource && !isClosed) {
      isClosed = true;
      eventSource.close();
      eventSource = null;
    }
  };

  try {
    const url = new URL(`${API_URL}/agent-run/${agentRunId}/stream`);
    url.searchParams.append('token', clerkToken);

    eventSource = new EventSource(url.toString());

    eventSource.onopen = () => {
      if (isClosed) return;
      errorCount = 0;
      lastErrorTime = 0;
    };

    eventSource.onmessage = (event) => {
      if (isClosed) return;

      try {
        const rawData = event.data;
        if (rawData.includes('"type":"ping"')) return;

        if (!rawData || rawData.trim() === '') {
          return;
        }

        try {
          const jsonData = JSON.parse(rawData);
          if (jsonData.status === 'error') {
            console.error(`[streamAgent] Error status received for ${agentRunId}:`, jsonData);
            callbacks.onError(jsonData.message || 'Unknown error occurred');
            return;
          }
        } catch (jsonError) {
          // Not JSON or invalid JSON, continue with normal processing
        }

        if (
          rawData.includes('Agent run') &&
          rawData.includes('not found in active runs')
        ) {
          callbacks.onError('Agent run not found in active runs');
          cleanup();
          callbacks.onClose();
          return;
        }

        if (
          rawData.includes('"type":"status"') &&
          rawData.includes('"status":"completed"')
        ) {
          cleanup();
          callbacks.onClose();
          return;
        }

        if (
          rawData.includes('"type":"status"') &&
          rawData.includes('"status_type":"thread_run_end"')
        ) {
          cleanup();
          callbacks.onClose();
          return;
        }

        callbacks.onMessage(rawData);
      } catch (error) {
        console.error(`[streamAgent] Error handling message:`, error);
        callbacks.onError(error instanceof Error ? error : String(error));
      }
    };

    eventSource.onerror = (event) => {
      if (isClosed) return;

      const currentTime = Date.now();
      const timeSinceLastError = currentTime - lastErrorTime;
      lastErrorTime = currentTime;

      if (timeSinceLastError > 5 * 60 * 1000) {
        errorCount = 0;
      }

      errorCount++;

      const eventSourceState = eventSource?.readyState;
      let errorMessage = 'Connection error';
      let shouldAttemptReconnect = true;

      if (errorCount >= maxErrors) {
        errorMessage = `Stream failed after ${errorCount} attempts - please refresh the page`;
        shouldAttemptReconnect = false;
      } else {
        if (eventSourceState === EventSource.CONNECTING) {
          errorMessage = `Failed to connect to stream (attempt ${errorCount}/${maxErrors}) - retrying...`;
        } else if (eventSourceState === EventSource.CLOSED) {
          errorMessage = 'Stream connection closed unexpectedly';
          shouldAttemptReconnect = false;
        } else if (eventSourceState === EventSource.OPEN) {
          errorMessage = `Stream connection interrupted (attempt ${errorCount}/${maxErrors}) - reconnecting...`;
        }

        if (event.target && (event.target as EventSource).url) {
          if (eventSourceState === EventSource.CONNECTING && errorCount >= 3) {
            errorMessage = 'Persistent connection failure - authentication may have expired';
            shouldAttemptReconnect = false;
          }
        }

        try {
          if ('error' in event && event.error) {
            errorMessage += ` (${event.error})`;
          }

          if ('message' in event && event.message) {
            errorMessage += ` - ${event.message}`;
          }

          if ('status' in event && event.status) {
            switch (event.status) {
              case 401:
                errorMessage = 'Authentication failed - please refresh and try again';
                shouldAttemptReconnect = false;
                break;
              case 403:
                errorMessage = 'Access denied - insufficient permissions';
                shouldAttemptReconnect = false;
                break;
              case 404:
                errorMessage = 'Stream endpoint not found - agent may have completed';
                shouldAttemptReconnect = false;
                break;
              case 500:
                errorMessage = `Server error (attempt ${errorCount}/${maxErrors}) - stream temporarily unavailable`;
                break;
              case 503:
                errorMessage = `Service unavailable (attempt ${errorCount}/${maxErrors}) - please try again later`;
                break;
              default:
                errorMessage = `Connection error (HTTP ${event.status}, attempt ${errorCount}/${maxErrors})`;
            }
          }
        } catch (inspectionError) {
          // Could not extract detailed error info
        }
      }

      if (!shouldAttemptReconnect) {
        cleanup();
        callbacks.onError(errorMessage);
        callbacks.onClose();
        return;
      }

      callbacks.onError(errorMessage);
    };

  } catch (error) {
    console.error(`[streamAgent] Failed to create EventSource for ${agentRunId}:`, error);

    let errorMessage = 'Failed to start stream';

    if (error instanceof Error) {
      if (error.name === 'SecurityError') {
        errorMessage = 'Security error - unable to connect to stream (check CORS settings)';
      } else if (error.name === 'TypeError') {
        errorMessage = 'Invalid stream URL or network configuration error';
      } else if (error.message.includes('fetch')) {
        errorMessage = 'Network error - unable to reach streaming endpoint';
      } else if (error.message.includes('token')) {
        errorMessage = 'Authentication token error - please refresh and try again';
      } else {
        errorMessage = `Stream setup failed: ${error.message}`;
      }
      callbacks.onError(errorMessage);
    } else {
      callbacks.onError(`Stream setup failed: ${String(error)}`);
    }

    callbacks.onClose();
    return () => {};
  }

  return cleanup;
};

export const initiateAgent = async (
  formData: FormData,
  clerkToken?: string,
): Promise<InitiateAgentResponse> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    if (!API_URL) {
      throw new Error(
        'Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL in your environment.',
      );
    }

    const response = await fetch(`${API_URL}/agent/initiate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clerkToken}`,
      },
      body: formData,
      cache: 'no-store',
    });

    if (!response.ok) {
      let errorDetail: any;
      try {
        errorDetail = await response.json();
      } catch {
        const errorText = await response.text().catch(() => 'No error details available');
        errorDetail = { message: errorText };
      }

      console.error(
        `[API] Error initiating agent: ${response.status} ${response.statusText}`,
        errorDetail,
      );

      if (response.status === 402) {
        throw new BillingError(response.status, {
          message: errorDetail.message || 'Payment required to create new project',
          ...errorDetail
        });
      } else if (response.status === 401 || response.status === 403) {
        throw new InitiationAuthError(response.status, {
          message: errorDetail.message || 'Authentication failed. Please sign in again and try again.',
          errorType: 'authentication'
        });
      } else if (response.status === 400) {
        throw new ProjectInitiationError(response.status, {
          message: errorDetail.message || 'Invalid request. Please check your inputs and try again.',
          errorType: 'validation'
        });
      } else if (response.status === 409) {
        throw new ProjectInitiationError(response.status, {
          message: errorDetail.message || 'A project with this configuration already exists.',
          errorType: 'conflict'
        });
      } else if (response.status === 503 || response.status === 502) {
        throw new SandboxCreationError(response.status, {
          message: errorDetail.message || 'Failed to create development environment. Please try again.',
          sandboxType: 'daytona'
        });
      } else if (response.status >= 500) {
        throw new ProjectInitiationError(response.status, {
          message: errorDetail.message || 'Server error occurred. Please try again in a moment.',
          errorType: 'server'
        });
      }

      throw new ProjectInitiationError(response.status, {
        message: errorDetail.message || `Failed to create project: ${response.statusText}`,
        errorType: 'unknown'
      });
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('[API] Failed to initiate agent:', error);

    if (
      error instanceof TypeError &&
      error.message.includes('Failed to fetch')
    ) {
      const networkError = new Error(
        `Cannot connect to backend server. Please check your internet connection and make sure the backend is running.`,
      );
      handleApiError(networkError, { operation: 'initiate agent', resource: 'AI assistant' });
      throw networkError;
    }
    handleApiError(error, { operation: 'initiate agent' });
    throw error;
  }
};

export const checkApiHealth = async (): Promise<HealthCheckResponse> => {
  try {
    const response = await fetch(`${API_URL}/health`, {
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`API health check failed: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    throw error;
  }
};
