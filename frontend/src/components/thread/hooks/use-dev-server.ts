import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';

import { DevServerStatus } from '../types/app-preview';

interface UseDevServerProps {
  sandboxId?: string;
  isPreviewTabActive: boolean;
  appType?: 'web' | 'mobile';
  previewUrl?: string;
}

export const useDevServer = ({ sandboxId, isPreviewTabActive, appType = 'web', previewUrl }: UseDevServerProps) => {
  const [status, setStatus] = useState<DevServerStatus>('stopped');
  const [error, setError] = useState<string | null>(null);
  const { getToken } = useAuth();



  const checkStatus = useCallback(async (previewUrl?: string) => {
    if (!sandboxId) return;
    
    try {
      const token = await getToken();
      if (!token) return;

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
        } else {
          setStatus('stopped');
        }
      } else {
        setStatus('stopped');
      }
    } catch (error) {
      console.error('Failed to check dev server status:', error);
      setStatus('stopped');
    }
  }, [sandboxId, getToken, appType]);

  const start = useCallback(async () => {
    if (!sandboxId) return;
    
    try {
      setStatus('starting');
      setError(null);
      
      const token = await getToken();
      if (!token) {
        setError('Authentication required');
        setStatus('stopped');
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
            : "cd /workspace/cheatcode-app && pnpm run dev",
          session_name: "dev_server",
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
              const statusResponse = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/sandboxes/${sandboxId}/sessions/dev_server/status`, {
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
                  console.log('[MOBILE SESSION] Startup logs detected, checking status');
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
      }
    } catch (error) {
      console.error('Failed to start dev server:', error);
      setError('Failed to start development server');
      setStatus('stopped');
    }
  }, [sandboxId, getToken, checkStatus, previewUrl, appType]);

  // Check dev server status when preview tab is active
  useEffect(() => {
    if (sandboxId && isPreviewTabActive) {
      checkStatus(previewUrl);
      
      const interval = setInterval(() => checkStatus(previewUrl), 30000);
      return () => clearInterval(interval);
    }
  }, [sandboxId, isPreviewTabActive, previewUrl, checkStatus]);

  // Auto-start dev server if not running when preview tab is opened
  useEffect(() => {
    if (sandboxId && isPreviewTabActive && status === 'stopped') {
      const timer = setTimeout(() => {
        if (status === 'stopped') {
          start();
        }
      }, 2000);
      
      return () => clearTimeout(timer);
    }
  }, [sandboxId, isPreviewTabActive, status, start]);

  return {
    status,
    error,
    start,
    checkStatus: () => checkStatus(previewUrl)
  };
}; 