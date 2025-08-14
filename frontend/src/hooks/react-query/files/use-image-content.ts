import React from 'react';
import { useFileContentQuery } from './use-file-queries';

/**
 * Hook for fetching image content and creating blob URLs
 * Simplified to avoid reference counting issues in React StrictMode
 */
export function useImageContent(
  sandboxId?: string,
  filePath?: string,
  options: {
    enabled?: boolean;
    staleTime?: number;
  } = {}
) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);

  // Get the blob data from React Query cache
  const {
    data: blobData,
    isLoading,
    error,
  } = useFileContentQuery(sandboxId, filePath, {
    contentType: 'blob',
    enabled: options.enabled,
    staleTime: options.staleTime || 5 * 60 * 1000, // 5 minutes default
  });

  // Create blob URL when we have blob data and clean up properly
  React.useEffect(() => {
    if (blobData instanceof Blob) {
      console.log(`[IMAGE CONTENT] Creating blob URL for ${filePath}`, {
        size: blobData.size,
        type: blobData.type
      });
      
      const url = URL.createObjectURL(blobData);
      setBlobUrl(url);
      
      // Cleanup function to revoke the blob URL
      return () => {
        console.log(`[IMAGE CONTENT] Cleaning up blob URL for ${filePath}: ${url}`);
        URL.revokeObjectURL(url);
        setBlobUrl(null);
      };
    } else {
      setBlobUrl(null);
      return;
    }
  }, [blobData, filePath]);

  return {
    data: blobUrl,
    isLoading,
    error,
  };
} 