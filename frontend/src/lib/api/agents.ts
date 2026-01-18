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
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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
            const detail = errorData?.detail || { message: 'Payment Required' };
            if (typeof detail.message !== 'string') {
              detail.message = 'Payment Required';
            }
            throw new BillingError(response.status, detail);
          } catch (parseError) {
            if (parseError instanceof BillingError) throw parseError;
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

        // Check for transient sandbox lock errors - retry silently
        const isSandboxLockError = response.status === 500 &&
          errorText.includes('Cannot acquire lock for sandbox');

        if (isSandboxLockError && attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          continue; // Retry
        }

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

      // Don't handle transient errors during retry attempts
      if (attempt < maxRetries && error instanceof Error &&
          error.message.includes('500')) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

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
  }

  // This shouldn't be reached, but TypeScript needs it
  throw new Error('Failed to start agent after retries');
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
      throw new Error(
        `Error getting agent status: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    return data;
  } catch (err) {
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
    handleApiError(error, { operation: 'load agent runs', resource: 'conversation history' });
    throw error;
  }
};

// Stream connection configuration
const STREAM_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000,           // Initial retry delay (1 second)
  maxDelayMs: 30000,           // Max retry delay (30 seconds)
  heartbeatTimeoutMs: 45000,   // No message timeout (45 seconds - backend sends pings every 15s)
  errorResetWindowMs: 5 * 60 * 1000, // Reset error count after 5 min of stability
};

// EventSource-based agent streaming implementation with robust reconnection
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
    callbacks.onError(authError);
    callbacks.onClose();
    return () => {};
  }

  let eventSource: EventSource | null = null;
  let isClosed = false;
  let errorCount = 0;
  let lastErrorTime = 0;
  let lastMessageTime = Date.now();
  let heartbeatCheckInterval: ReturnType<typeof setInterval> | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let isReconnecting = false;

  // Calculate exponential backoff delay with jitter
  const getReconnectDelay = (attempt: number): number => {
    const exponentialDelay = STREAM_CONFIG.baseDelayMs * Math.pow(2, attempt);
    const cappedDelay = Math.min(exponentialDelay, STREAM_CONFIG.maxDelayMs);
    // Add 10-30% jitter to prevent thundering herd
    const jitter = cappedDelay * (0.1 + Math.random() * 0.2);
    return Math.floor(cappedDelay + jitter);
  };

  const clearTimers = () => {
    if (heartbeatCheckInterval) {
      clearInterval(heartbeatCheckInterval);
      heartbeatCheckInterval = null;
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
  };

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    clearTimers();
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  };

  const createConnection = () => {
    if (isClosed) return;

    // Close existing connection if any
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    try {
      const url = new URL(`${API_URL}/agent-run/${agentRunId}/stream`);
      url.searchParams.append('token', clerkToken);

      eventSource = new EventSource(url.toString());
      lastMessageTime = Date.now();

      eventSource.onopen = () => {
        if (isClosed) return;
        // Connection successful - reset error tracking
        errorCount = 0;
        lastErrorTime = 0;
        isReconnecting = false;
      };

      eventSource.onmessage = (event) => {
        if (isClosed) return;

        // Update last message time for heartbeat tracking
        lastMessageTime = Date.now();

        try {
          const rawData = event.data;

          // Handle ping messages - update heartbeat but don't forward
          if (rawData.includes('"type":"ping"')) return;

          if (!rawData || rawData.trim() === '') {
            return;
          }

          try {
            const jsonData = JSON.parse(rawData);
            if (jsonData.status === 'error') {
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
          callbacks.onError(error instanceof Error ? error : String(error));
        }
      };

      eventSource.onerror = (event) => {
        if (isClosed) return;

        const currentTime = Date.now();
        const timeSinceLastError = currentTime - lastErrorTime;
        lastErrorTime = currentTime;

        // Reset error count if enough time has passed since last error
        if (timeSinceLastError > STREAM_CONFIG.errorResetWindowMs) {
          errorCount = 0;
        }

        errorCount++;

        const eventSourceState = eventSource?.readyState;
        let errorMessage = 'Connection error';
        let shouldAttemptReconnect = true;
        let isAuthError = false;

        if (errorCount >= STREAM_CONFIG.maxRetries) {
          errorMessage = `Stream failed after ${errorCount} attempts - please refresh the page`;
          shouldAttemptReconnect = false;
        } else {
          if (eventSourceState === EventSource.CONNECTING) {
            errorMessage = `Connecting to stream (attempt ${errorCount}/${STREAM_CONFIG.maxRetries})...`;
          } else if (eventSourceState === EventSource.CLOSED) {
            errorMessage = 'Stream connection closed unexpectedly';
            // Still attempt reconnect for closed connections unless max errors reached
          } else if (eventSourceState === EventSource.OPEN) {
            errorMessage = `Stream interrupted (attempt ${errorCount}/${STREAM_CONFIG.maxRetries}) - reconnecting...`;
          }

          // Check for persistent connection failures
          if (eventSourceState === EventSource.CONNECTING && errorCount >= 3) {
            errorMessage = 'Persistent connection failure - checking authentication...';
            isAuthError = true;
          }

          try {
            if ('status' in event && event.status) {
              switch (event.status) {
                case 401:
                  errorMessage = 'Authentication failed - please refresh and try again';
                  shouldAttemptReconnect = false;
                  isAuthError = true;
                  break;
                case 403:
                  errorMessage = 'Access denied - insufficient permissions';
                  shouldAttemptReconnect = false;
                  isAuthError = true;
                  break;
                case 404:
                  errorMessage = 'Stream endpoint not found - agent may have completed';
                  shouldAttemptReconnect = false;
                  break;
                case 500:
                  errorMessage = `Server error (attempt ${errorCount}/${STREAM_CONFIG.maxRetries})`;
                  break;
                case 503:
                  errorMessage = `Service unavailable (attempt ${errorCount}/${STREAM_CONFIG.maxRetries})`;
                  break;
                default:
                  errorMessage = `Connection error (HTTP ${event.status}, attempt ${errorCount}/${STREAM_CONFIG.maxRetries})`;
              }
            }
          } catch (inspectionError) {
            // Could not extract detailed error info
          }
        }

        // Don't reconnect for auth errors even if under retry limit
        if (isAuthError && errorCount >= 3) {
          shouldAttemptReconnect = false;
        }

        if (!shouldAttemptReconnect) {
          cleanup();
          callbacks.onError(errorMessage);
          callbacks.onClose();
          return;
        }

        // Attempt explicit reconnection with exponential backoff
        if (!isReconnecting) {
          isReconnecting = true;
          const delay = getReconnectDelay(errorCount - 1);

          // Close the failed connection
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }

          reconnectTimeout = setTimeout(() => {
            if (!isClosed) {
              createConnection();
            }
          }, delay);
        }

        // Only notify user of persistent errors, not transient reconnection attempts
        if (errorCount > 1) {
          callbacks.onError(errorMessage);
        }
      };

    } catch (error) {

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

      // Attempt recovery for network errors
      errorCount++;
      if (errorCount < STREAM_CONFIG.maxRetries && !isClosed) {
        const delay = getReconnectDelay(errorCount - 1);
        reconnectTimeout = setTimeout(() => {
          if (!isClosed) {
            createConnection();
          }
        }, delay);
      } else {
        callbacks.onClose();
      }
    }
  };

  // Start heartbeat monitoring - reconnect if no messages received
  const startHeartbeatMonitor = () => {
    heartbeatCheckInterval = setInterval(() => {
      if (isClosed) {
        clearTimers();
        return;
      }

      const timeSinceLastMessage = Date.now() - lastMessageTime;

      if (timeSinceLastMessage > STREAM_CONFIG.heartbeatTimeoutMs) {

        // Trigger reconnection
        if (!isReconnecting && eventSource) {
          errorCount++;
          if (errorCount < STREAM_CONFIG.maxRetries) {
            isReconnecting = true;
            eventSource.close();
            eventSource = null;
            const delay = getReconnectDelay(errorCount - 1);
            reconnectTimeout = setTimeout(() => {
              if (!isClosed) {
                createConnection();
              }
            }, delay);
            callbacks.onError(`Connection stale - reconnecting (attempt ${errorCount}/${STREAM_CONFIG.maxRetries})...`);
          } else {
            cleanup();
            callbacks.onError('Stream connection timed out - please refresh the page');
            callbacks.onClose();
          }
        }
      }
    }, 10000); // Check every 10 seconds
  };

  // Initialize connection and heartbeat monitor
  createConnection();
  startHeartbeatMonitor();

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
