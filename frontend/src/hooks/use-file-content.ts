'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { FileCache, getCachedFile } from './use-cached-file';

// Query keys for file content
export const fileContentKeys = {
  all: ['file-content'] as const,
  byPath: (sandboxId: string, path: string) => 
    [...fileContentKeys.all, sandboxId, path] as const,
};

/**
 * Hook to fetch and cache file content with authentication
 */
export function useFileContent(sandboxId?: string, filePath?: string) {
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { getToken } = useAuth();

  useEffect(() => {
    const loadContent = async () => {
      if (!sandboxId || !filePath) {
        setContent(null);
        return;
      }

      const cacheKey = `${sandboxId}:${filePath}:text`;
      
      // Check if file content is already in cache
      const cached = FileCache.get(cacheKey);
      if (cached !== null) {
        setContent(cached);
        return;
      }

      // Otherwise, load and cache the file content
      setIsLoading(true);
      try {
        const token = await getToken();
        const fileContent = await getCachedFile(sandboxId, filePath, {
          token: token || '',
          contentType: 'text'
        });
        setContent(fileContent);
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to load file content:', err);
        setError(err as Error);
        setIsLoading(false);
      }
    };

    loadContent();
  }, [sandboxId, filePath, getToken]);

  return {
    data: content,
    isLoading,
    error
  };
} 