import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';

import { DevServerStatus } from '../types/app-preview';

interface UseDevServerProps {
  sandboxId?: string;
  isPreviewTabActive?: boolean; // Made optional since dev server should work regardless
  appType?: 'web' | 'mobile';
  previewUrl?: string;
  autoStart?: boolean; // New prop to control auto-start behavior
}

export const useDevServer = ({ 
  sandboxId, 
  isPreviewTabActive = false, 
  appType = 'web', 
  previewUrl,
  autoStart = true 
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

  const checkStatus = useCallback(async (previewUrl?: string) => {
    if (!sandboxId || statusCheckInProgress.current) return;
    
    statusCheckInProgress.current = true;
    
    try {
      const token = await getToken();
      if (!token) {
        statusCheckInProgress.current = false;
        return;
      }

      // For mobile projects, always check the expo process instead of URL
      // The preview URL might be accessible even when expo isn't running
      if (appType === 'mobile') {
        console.log('[MOBILE DEV SERVER] Checking expo process status for mobile app');
        // Fall through to command execution to check expo process
      }

      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/sandboxes/${sandboxId}/execute`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          command: appType === 'mobile' 
            ? "pgrep -f 'expo start' > /dev/null && echo '200' || echo '000'"
            : "curl -s http://localhost:3000 -o /dev/null -w '%{http_code}' --connect-timeout 3 || echo '000'",
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
        } else {
          if (status !== 'starting') {
            setStatus('stopped');
          }
        }
      } else {
        if (status !== 'starting') {
          setStatus('stopped');
        }
      }
    } catch (error) {
      console.error('Failed to check dev server status:', error);
      if (status !== 'starting') {
        setStatus('stopped');
      }
    } finally {
      statusCheckInProgress.current = false;
    }
  }, [sandboxId, getToken, appType, status]);

  // Auto-start dev server immediately when sandbox is available (not tied to preview tab)
  useEffect(() => {
    if (sandboxId && autoStart && status === 'stopped' && !isStarting) {
      // Clear any existing timeout
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
      }
      
      // Start dev server after a brief delay to ensure sandbox is fully ready
      autoStartTimeoutRef.current = setTimeout(() => {
        if (status === 'stopped' && !isStarting) {
          console.log(`[${appType.toUpperCase()} DEV SERVER] Auto-starting dev server for sandbox ${sandboxId}`);
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
  
  // Set up polling for status checks (only one interval per hook instance)
  useEffect(() => {
    if (sandboxId) {
      // Initial status check
      checkStatus(previewUrl);
      
      // Clear any existing polling interval
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      
      // Set up new polling interval
      pollingIntervalRef.current = setInterval(() => {
        checkStatus(previewUrl);
      }, 15000); // Check every 15 seconds (reduced from 30s for better UX)
      
      return () => {
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      };
    }
  }, [sandboxId, checkStatus, previewUrl]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
      if (autoStartTimeoutRef.current) {
        clearTimeout(autoStartTimeoutRef.current);
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