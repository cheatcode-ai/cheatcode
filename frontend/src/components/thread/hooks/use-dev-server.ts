import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';

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
  isPreviewTabActive = false,
  appType = 'web',
  previewUrl,
  autoStart = true,
  onPreviewUrlRetry
}: UseDevServerProps) => {
  const [status, setStatus] = useState<DevServerStatus>('stopped');
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const { getToken } = useAuth();

  // Use refs to prevent duplicate operations
  const statusCheckInProgress = useRef(false);
  const startInProgress = useRef(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoStartTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const useSSE = useRef(true); // Feature flag for SSE vs polling
  const hasAutoStarted = useRef(false); // Prevent repeated auto-starts

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

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/sandboxes/${sandboxId}/execute`, {
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
        
        // Debug logging for mobile projects
        if (appType === 'mobile') {
          console.log('[MOBILE DEV SERVER] Process check:', {
            httpCode,
            success: result.success,
            output: result.output
          });
        }
        
        if (httpCode && httpCode !== '000' && result.success) {
          setStatus('running');
          setError(null);
          setIsStarting(false);

          // If dev server is running but no preview URL, trigger retry
          if (!previewUrl && onPreviewUrlRetry) {
            console.log('[DEV SERVER] Dev server running but no preview URL, triggering retry');
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
      console.error('Failed to check dev server status:', error);
      // Only set to 'stopped' if we're not currently starting
      if (status !== 'starting' && !isStarting && !hasAutoStarted.current) {
        setStatus('stopped');
      }
    } finally {
      statusCheckInProgress.current = false;
    }
  }, [sandboxId, getToken, appType, status, isStarting, onPreviewUrlRetry]);

  const start = useCallback(async () => {
    if (!sandboxId || startInProgress.current) return;
    
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

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/sandboxes/${sandboxId}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: appType === 'mobile' 
            ? "cd /workspace/cheatcode-mobile && npm install -g @expo/ngrok@^4.1.0 && npx --yes expo start --max-workers 2 --tunnel"
            : "cd /workspace/cheatcode-app && npm run dev",
          session_name: `dev_server_${appType}`, // Fixed: Use app-specific session names
          blocking: false,
          cwd: appType === 'mobile' ? "/workspace/cheatcode-mobile" : "/workspace/cheatcode-app"
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Dev server started:', result);
        
        // Monitor the session for better feedback
        const monitorSession = async () => {
          for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            try {
              const statusResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/sandboxes/${sandboxId}/sessions/dev_server_${appType}/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
              });
              
              if (statusResponse.ok) {
                const sessionStatus = await statusResponse.json();
                
                // Debug logging for mobile session monitoring
                if (appType === 'mobile') {
                  console.log('[MOBILE SESSION] Session status:', sessionStatus);
                  sessionStatus.commands?.forEach((cmd: any, index: number) => {
                    if (cmd.logs) {
                      console.log(`[MOBILE SESSION] Command ${index} logs:`, cmd.logs.substring(0, 200));
                    }
                  });
                }
                
                const hasStartupLogs = sessionStatus.commands?.some((cmd: any) => {
                  if (appType === 'mobile') {
                    return cmd.logs?.includes('Metro waiting on') || 
                           cmd.logs?.includes('Tunnel ready') || 
                           cmd.logs?.includes('Your app is ready') ||
                           cmd.logs?.includes('ready') || 
                           cmd.logs?.includes('Metro') || 
                           cmd.logs?.includes('8081') || 
                           cmd.logs?.includes('Expo');
                  } else {
                    return cmd.logs?.includes('ready') || cmd.logs?.includes('Local:') || cmd.logs?.includes('3000');
                  }
                });
                
                if (hasStartupLogs) {
                  console.log(`[${appType.toUpperCase()} SESSION] Startup logs detected, checking status`);
                  checkStatus(previewUrl);
                  break;
                }
              }
            } catch (error) {
              console.log('Session monitoring error:', error);
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
      console.error('Failed to start dev server:', error);
      setError('Failed to start development server');
      setStatus('stopped');
      setIsStarting(false);
    } finally {
      startInProgress.current = false;
    }
  }, [sandboxId, getToken, checkStatus, previewUrl, appType]);



  // Auto-start dev server ONCE when sandbox is available (not tied to preview tab)
  // Uses hasAutoStarted ref to prevent repeated auto-starts from status polling
  useEffect(() => {
    // Only auto-start if:
    // - We have a sandboxId
    // - autoStart is enabled
    // - Status is 'stopped'
    // - Not currently starting
    // - Haven't already auto-started (prevents restart loop)
    if (sandboxId && autoStart && status === 'stopped' && !isStarting && !hasAutoStarted.current) {
      // Clear any existing timeout
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
      }

      // Start dev server after a brief delay to ensure sandbox is fully ready
      autoStartTimeoutRef.current = setTimeout(() => {
        if (status === 'stopped' && !isStarting && !hasAutoStarted.current) {
          console.log(`[${appType.toUpperCase()} DEV SERVER] Auto-starting dev server for sandbox ${sandboxId}`);
          hasAutoStarted.current = true; // Mark as auto-started to prevent repeat
          start();
        }
      }, 3000); // 3 second delay for sandbox initialization

      return () => {
        if (autoStartTimeoutRef.current) {
          clearTimeout(autoStartTimeoutRef.current);
        }
      };
    }
  }, [sandboxId, autoStart, status, isStarting, start, appType]);
  
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
        console.log('[DEV SERVER] No auth token, falling back to polling');
        useSSE.current = false;
        return;
      }

      const sessionName = `dev_server_${appType}`;
      const sseUrl = `${process.env.NEXT_PUBLIC_BACKEND_URL}/sandboxes/${sandboxId}/dev-server/stream?session_name=${sessionName}&app_type=${appType}`;

      console.log('[DEV SERVER] Connecting to SSE stream:', sseUrl);

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
                    console.log('[DEV SERVER SSE] Status update:', data.status);
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
                    console.log('[DEV SERVER SSE] Preview URL received:', data.url);
                    if (!previewUrl && onPreviewUrlRetry) {
                      onPreviewUrlRetry();
                    }
                  } else if (data.type === 'error') {
                    // Log backend errors but don't alarm users with transient issues
                    console.warn('[DEV SERVER SSE] Backend error:', data.message);
                    // Only set error for user-actionable issues, not SDK internals
                    if (data.message && !data.message.includes('object has no attribute')) {
                      setError(data.message);
                    }
                    // Fall back to polling on backend errors
                    useSSE.current = false;
                  } else if (data.type === 'done') {
                    console.log('[DEV SERVER SSE] Stream completed');
                  } else if (data.type === 'heartbeat') {
                    // Heartbeat received - connection is healthy
                  }
                } catch (parseError) {
                  console.warn('[DEV SERVER SSE] Failed to parse event:', event);
                }
              }
            }
          }
        } catch (streamError) {
          console.error('[DEV SERVER SSE] Stream error:', streamError);
        }
      };

      processStream();

    } catch (error) {
      console.error('[DEV SERVER] SSE connection failed, falling back to polling:', error);
      useSSE.current = false;
    }
  }, [sandboxId, appType, getToken, previewUrl, onPreviewUrlRetry]);

  // Use SSE when starting, fall back to minimal polling when running
  useEffect(() => {
    if (!sandboxId) return;

    // Initial status check
    checkStatus(previewUrl);

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
  }, [sandboxId, checkStatus, previewUrl, status, connectSSE]);

  // Reset hasAutoStarted when sandboxId changes (new project)
  useEffect(() => {
    hasAutoStarted.current = false;
  }, [sandboxId]);

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

  return {
    status,
    error,
    isStarting,
    start,
    checkStatus: () => checkStatus(previewUrl),
    // Additional utilities for better dev server management
    isRunning: status === 'running',
    canStart: status === 'stopped' && !isStarting
  };
}; 