import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ViewMode } from '../types/app-preview';
import { getViewportDimensions } from '../utils/file-utils';

interface UsePreviewUrlProps {
  sandboxId?: string;
}

export const usePreviewUrl = ({ sandboxId }: UsePreviewUrlProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [urlInput, setUrlInput] = useState<string>('/');
  const [refreshKey, setRefreshKey] = useState(0);
  const [currentView, setCurrentView] = useState<ViewMode>('desktop');
  const [iframeRef, setIframeRef] = useState<HTMLIFrameElement | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  const { getToken } = useAuth();

  // Fetch the actual Daytona preview URL from backend with retry logic
  const fetchPreviewUrl = useCallback(async (currentRetryCount = 0) => {
    if (!sandboxId) return;
    
    const maxRetries = 5;
    const baseDelay = 2000; // 2 seconds
    
    try {
      const token = await getToken();
      setAuthToken(token);
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/sandboxes/${sandboxId}/preview-url`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.preview_url) {
          setCurrentUrl(data.preview_url);
          setHasError(false);
          setRetryCount(0);
          setIsLoading(false);
          return;
        } else {
          console.log('Preview not available:', data.status);
          // Don't set error immediately, might need more time
        }
      } else {
        console.error('Failed to fetch preview URL:', response.status);
      }
      
      // If we reach here, the request didn't get a preview URL
      throw new Error('Preview URL not ready');
      
    } catch (error) {
      console.error(`Error fetching preview URL (attempt ${currentRetryCount + 1}):`, error);
      
      if (currentRetryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, currentRetryCount); // 2s, 4s, 8s, 16s, 32s
        setRetryCount(currentRetryCount + 1);
        
        setTimeout(() => {
          fetchPreviewUrl(currentRetryCount + 1);
        }, delay);
      } else {
        setHasError(true);
        setIsLoading(false);
        console.error('Max retries reached for preview URL fetch');
      }
    }
  }, [sandboxId, getToken]);

  // Manual retry function
  const retryPreviewUrl = useCallback(() => {
    setIsLoading(true);
    setHasError(false);
    setRetryCount(0);
    fetchPreviewUrl(0);
  }, [fetchPreviewUrl]);

  useEffect(() => {
    fetchPreviewUrl();
  }, [fetchPreviewUrl]);

  // Use the currentUrl as the preview URL (actual Daytona URL)
  const previewUrl = currentUrl;

  // Handle URL form submission
  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (urlInput.trim() && iframeRef) {
      let fullUrl = urlInput.trim();
      
      if (!fullUrl.startsWith('http') && !fullUrl.startsWith('/')) {
        fullUrl = '/' + fullUrl;
      }
      
      if (fullUrl.startsWith('/') && previewUrl) {
        fullUrl = previewUrl + fullUrl;
      }
      
      iframeRef.src = fullUrl;
      setCurrentUrl(fullUrl);
    }
  }, [urlInput, previewUrl, iframeRef]);

  // Handle iframe load success
  const handleIframeLoad = useCallback(() => {
    setIsLoading(false);
    setHasError(false);
  }, []);

  // Handle iframe load error
  const handleIframeError = useCallback(() => {
    setIsLoading(false);
    setHasError(true);
  }, []);

  // Refresh preview
  const handleRefresh = useCallback(() => {
    setRefreshKey(prev => prev + 1);
    setIsLoading(true);
    setHasError(false);
  }, []);

  // Open in new tab
  const openInNewTab = useCallback(() => {
    if (currentUrl || previewUrl) {
      window.open(currentUrl || previewUrl, '_blank');
    }
  }, [currentUrl, previewUrl]);

  // Cycle through view modes
  const cycleView = useCallback(() => {
    setCurrentView(prev => {
      switch (prev) {
        case 'desktop': return 'tablet';
        case 'tablet': return 'mobile';
        case 'mobile': return 'desktop';
        default: return 'desktop';
      }
    });
  }, []);

  // Get current view dimensions
  const viewportDimensions = useMemo(() => {
    return getViewportDimensions(currentView);
  }, [currentView]);

  // Initialize URL input when preview URL is set
  useEffect(() => {
    if (previewUrl) {
      setUrlInput('/');
    }
  }, [previewUrl]);

  // Reset loading state when refresh key changes
  useEffect(() => {
    if (refreshKey > 0 && previewUrl) {
      setIsLoading(true);
      setHasError(false);
    }
  }, [refreshKey, previewUrl]);

  return {
    previewUrl,
    currentUrl,
    urlInput,
    setUrlInput,
    isLoading,
    hasError,
    refreshKey,
    currentView,
    viewportDimensions,
    retryCount,
    handleUrlSubmit,
    handleIframeLoad,
    handleIframeError,
    handleRefresh,
    openInNewTab,
    cycleView,
    setIframeRef,
    retryPreviewUrl
  };
}; 