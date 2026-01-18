import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { API_URL } from '@/lib/api/config';

import { DevServerStatus } from '../types/app-preview';

interface UseDevServerProps {
  sandboxId?: string;
  isPreviewTabActive?: boolean; // Made optional since dev server should work regardless
  appType?: 'web' | 'mobile';
  previewUrl?: string;
  autoStart?: boolean; // New prop to control auto-start behavior
  onPreviewUrlRetry?: () => void; // Callback to retry preview URL fetch
}

export const useDevServer = ({
  sandboxId,
  isPreviewTabActive: _isPreviewTabActive = false,
  appType = 'web',
  previewUrl,
  autoStart = true, // Frontend handles auto-starting dev server for faster response
  onPreviewUrlRetry
}: UseDevServerProps) => {
  const [status, setStatus] = useState<DevServerStatus>('stopped');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [expoUrl, setExpoUrl] = useState<string | null>(null); // Expo tunnel URL for QR code
  const { getToken } = useAuth();

  // Use refs to prevent duplicate operations
  const statusCheckInProgress = useRef(false);
  const startInProgress = useRef(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const useSSE = useRef(true); // Feature flag for SSE vs polling
  const hasAutoStarted = useRef(false); // Prevent repeated auto-starts
  const lastSandboxId = useRef<string | undefined>(undefined); // Track sandbox changes

  const checkStatus = useCallback(async (previewUrl?: string) => {
    if (!sandboxId || statusCheckInProgress.current) return;
    
    statusCheckInProgress.current = true;
    
    try {
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        setStatus('stopped');
        statusCheckInProgress.current = false;
        return;
      }

      const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: appType === 'mobile' 
            ? "curl -s -o /dev/null -w \"%{http_code}\" http://localhost:8081 2>/dev/null || echo '000'"
            : "curl -s -o /dev/null -w \"%{http_code}\" http://localhost:3000 2>/dev/null || echo '000'",
          blocking: true,
          timeout: 10
        })
      });

      if (response.ok) {
        const result = await response.json();
        const httpCode = result.output?.trim();
        
        if (httpCode && httpCode !== '000' && result.success) {
          setStatus('running');
          setError(null);
          setIsStarting(false);

          // If dev server is running but no preview URL, trigger retry
          if (!previewUrl && onPreviewUrlRetry) {
            onPreviewUrlRetry();
          }
        } else {
          // Only set to 'stopped' if we're not currently starting AND haven't already auto-started
          // This prevents resetting the UI during startup
          if (status !== 'starting' && !isStarting && !hasAutoStarted.current) {
            setStatus('stopped');
          }
        }
      } else {
        // Only set to 'stopped' if we're not currently starting
        if (status !== 'starting' && !isStarting && !hasAutoStarted.current) {
          setStatus('stopped');
        }
      }
    } catch (error) {
      // Only set to 'stopped' if we're not currently starting
      if (status !== 'starting' && !isStarting && !hasAutoStarted.current) {
        setStatus('stopped');
      }
    } finally {
      statusCheckInProgress.current = false;
    }
  }, [sandboxId, getToken, appType, status, isStarting, onPreviewUrlRetry]);

  const start = useCallback(async () => {
    if (!sandboxId || startInProgress.current) {
      return;
    }

    startInProgress.current = true;

    try {
      setStatus('starting');
      setIsStarting(true);
      setError(null);

      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        setStatus('stopped');
        setIsStarting(false);
        return;
      }

      const command = appType === 'mobile'
        ? "cd /workspace/cheatcode-mobile && npm install -g @expo/ngrok@^4.1.0 && npx --yes expo start --max-workers 4 --tunnel"
        : "cd /workspace/cheatcode-app && pnpm dev";

      const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command,
          session_name: `dev_server_${appType}`, // Fixed: Use app-specific session names
          blocking: false,
          cwd: appType === 'mobile' ? "/workspace/cheatcode-mobile" : "/workspace/cheatcode-app"
        })
      });

      if (response.ok) {
        await response.json();

        // Monitor the session for better feedback
        const monitorSession = async () => {
          for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            try {
              const statusResponse = await fetch(`${API_URL}/sandboxes/${sandboxId}/sessions/dev_server_${appType}/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              
              if (statusResponse.ok) {
                const sessionStatus = await statusResponse.json();

                const hasStartupLogs = sessionStatus.commands?.some((cmd: any) => {
                  const logs = typeof cmd.logs === 'string' ? cmd.logs : '';
                  if (appType === 'mobile') {
                    return logs.includes('Metro waiting on') ||
                           logs.includes('Tunnel ready') ||
                           logs.includes('Your app is ready') ||
                           logs.includes('ready') ||
                           logs.includes('Metro') ||
                           logs.includes('8081') ||
                           logs.includes('Expo');
                  } else {
                    return logs.includes('ready') || logs.includes('Local:') || logs.includes('3000');
                  }
                });
                
                if (hasStartupLogs) {
                  checkStatus(previewUrl);
                  break;
                }
              }
            } catch (error) {
              // Session monitoring error - continue
            }
          }
          
          checkStatus(previewUrl);
        };
        
        monitorSession();
        setError('Starting development server... This may take a moment.');
      } else {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to start dev server' }));
        setError(errorData.detail || 'Failed to start development server');
        setStatus('stopped');
        setIsStarting(false);
      }
    } catch (error) {
      setError('Failed to start development server');
      setStatus('stopped');
      setIsStarting(false);
    } finally {
      startInProgress.current = false;
    }
  }, [sandboxId, getToken, checkStatus, previewUrl, appType]);



  // Auto-start dev server ONCE when sandbox is available (not tied to preview tab)
  // This effect MUST run before status check to prevent race conditions
  useEffect(() => {
    // Reset hasAutoStarted when sandboxId changes (inline to avoid race condition)
    if (sandboxId && sandboxId !== lastSandboxId.current) {
      lastSandboxId.current = sandboxId;
      hasAutoStarted.current = false;

      // Immediately trigger auto-start for new sandbox (don't wait for status check)
      if (autoStart && !startInProgress.current) {
        hasAutoStarted.current = true;

        // Call start() directly - no timeout needed since sandbox should be ready
        // Using queueMicrotask to ensure state updates have settled
        queueMicrotask(() => {
          start();
        });
      }
    }
    // NOTE: No cleanup - we don't want React re-renders to cancel the auto-start
  }, [sandboxId, autoStart, start, appType]);
  
  // Connect to SSE stream for real-time dev server status updates
  // Falls back to polling if SSE is not available or fails
  const connectSSE = useCallback(async () => {
    if (!sandboxId || !useSSE.current) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    try {
      const token = await getToken();
      if (!token) {
        useSSE.current = false;
        return;
      }

      const sessionName = `dev_server_${appType}`;
      const sseUrl = `${API_URL}/sandboxes/${sandboxId}/dev-server/stream?session_name=${sessionName}&app_type=${appType}`;

      // Note: EventSource doesn't support custom headers, so we use fetch with streaming
      const response = await fetch(sseUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
        },
      });

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE events (data: {...}\n\n)
            const events = buffer.split('\n\n');
            buffer = events.pop() || ''; // Keep incomplete event in buffer

            for (const event of events) {
              if (event.startsWith('data: ')) {
                try {
                  const data = JSON.parse(event.slice(6));

                  if (data.type === 'status') {
                    if (data.status === 'running') {
                      setStatus('running');
                      setError(null);
                      setIsStarting(false);
                    } else if (data.status === 'stopped') {
                      // Only set to 'stopped' if we haven't already auto-started
                      // This prevents restart loops when SSE reports 'stopped' during startup
                      if (!hasAutoStarted.current) {
                        setStatus('stopped');
                        setIsStarting(false);
                      }
                    } else if (data.status === 'starting' || data.status === 'checking') {
                      setStatus('starting');
                    }
                  } else if (data.type === 'preview_url' && data.url) {
                    if (!previewUrl && onPreviewUrlRetry) {
                      onPreviewUrlRetry();
                    }
                  } else if (data.type === 'expo_url' && data.url) {
                    setExpoUrl(data.url);
                  } else if (data.type === 'error') {
                    // Only set error for user-actionable issues, not SDK internals
                    if (data.message && !data.message.includes('object has no attribute')) {
                      setError(data.message);
                    }
                    // Fall back to polling on backend errors
                    useSSE.current = false;
                  } else if (data.type === 'done') {
                    // Stream completed
                  } else if (data.type === 'heartbeat') {
                    // Heartbeat received - connection is healthy
                  }
                } catch (parseError) {
                  // Failed to parse SSE event
                }
              }
            }
          }
        } catch (streamError) {
          // SSE stream error
        }
      };

      processStream();

    } catch (error) {
      useSSE.current = false;
    }
  }, [sandboxId, appType, getToken, previewUrl, onPreviewUrlRetry]);

  // Use SSE when starting, fall back to minimal polling when running
  // NOTE: Don't run initial checkStatus immediately - let auto-start run first
  useEffect(() => {
    if (!sandboxId) return;

    // Don't run status check if auto-start is pending (within first 2 seconds)
    // This prevents race condition where checkStatus sets status='running' before auto-start fires
    if (hasAutoStarted.current || isStarting) {
      // Auto-start in progress, skip immediate check but still set up polling
    } else {
      // Delayed initial status check (after auto-start would have triggered)
      setTimeout(() => {
        if (!hasAutoStarted.current && !isStarting) {
          checkStatus(previewUrl);
        }
      }, 2000);
    }

    // Connect SSE when dev server is starting
    if (status === 'starting' && useSSE.current) {
      connectSSE();
    }

    // Clear any existing polling interval
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    // Only use polling as fallback or for health checks when running
    // SSE handles real-time status during startup
    if (!useSSE.current || status === 'running') {
      // Minimal polling when running (just health check every 60s)
      // Or fallback polling if SSE failed
      const interval = status === 'running' ? 60000 : (useSSE.current ? 10000 : 5000);

      pollingIntervalRef.current = setInterval(() => {
        checkStatus(previewUrl);
      }, interval);
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [sandboxId, checkStatus, previewUrl, status, connectSSE, isStarting, appType]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Track expo URL fetch attempts for retry logic
  const expoUrlFetchAttemptsRef = useRef(0);
  const expoUrlPollingRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch Expo URL from backend (fallback for when SSE doesn't provide it)
  // Includes retry logic since tunnel takes time to establish
  const fetchExpoUrl = useCallback(async (_retryCount = 0): Promise<boolean> => {
    if (!sandboxId || appType !== 'mobile') return false;

    try {
      const token = await getToken();
      if (!token) return false;

      const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/expo-url`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.expo_url) {
          setExpoUrl(data.expo_url);
          // Stop polling when URL is found
          if (expoUrlPollingRef.current) {
            clearInterval(expoUrlPollingRef.current);
            expoUrlPollingRef.current = null;
          }
          return true;
        }
      }
    } catch (error) {
      // Failed to fetch Expo URL
    }
    return false;
  }, [sandboxId, appType, getToken]);

  // Start polling for Expo URL with retry logic
  const startExpoUrlPolling = useCallback(() => {
    // Don't start if already polling or already have URL
    if (expoUrlPollingRef.current || expoUrl) return;

    expoUrlFetchAttemptsRef.current = 0;

    // Poll every 3 seconds for up to 60 seconds (20 attempts)
    expoUrlPollingRef.current = setInterval(async () => {
      expoUrlFetchAttemptsRef.current += 1;

      const found = await fetchExpoUrl(expoUrlFetchAttemptsRef.current);

      // Stop after 20 attempts or if found
      if (found || expoUrlFetchAttemptsRef.current >= 20) {
        if (expoUrlPollingRef.current) {
          clearInterval(expoUrlPollingRef.current);
          expoUrlPollingRef.current = null;
        }
      }
    }, 3000);
  }, [fetchExpoUrl, expoUrl]);

  // Start polling for Expo URL when dev server is running OR when preview URL is available
  // This ensures we fetch the expo URL even if status detection is delayed
  useEffect(() => {
    if (appType === 'mobile' && !expoUrl && (status === 'running' || previewUrl)) {
      // Delay a bit to give the tunnel time to establish, then start polling
      const timeout = setTimeout(() => {
        startExpoUrlPolling();
      }, previewUrl ? 1000 : 3000); // Shorter delay if preview already available
      return () => clearTimeout(timeout);
    }
  }, [status, appType, expoUrl, startExpoUrlPolling, previewUrl]);

  // Cleanup expo URL polling on unmount
  useEffect(() => {
    return () => {
      if (expoUrlPollingRef.current) {
        clearInterval(expoUrlPollingRef.current);
        expoUrlPollingRef.current = null;
      }
    };
  }, []);

  return {
    status,
    error,
    isStarting,
    start,
    checkStatus: () => checkStatus(previewUrl),
    // Additional utilities for better dev server management
    isRunning: status === 'running',
    canStart: status === 'stopped' && !isStarting,
    // Expo URL for QR code (mobile only)
    expoUrl,
    fetchExpoUrl
  };
}; 