'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';
import { FileCache } from './use-cached-file';

// Track in-progress image loads to prevent duplication
const inProgressImageLoads = new Map<string, Promise<string>>();

/**
 * Hook to fetch and cache image content with authentication
 */
export function useImageContent(sandboxId?: string, filePath?: string, appType: 'web' | 'mobile' = 'web') {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { getToken } = useAuth();

  useEffect(() => {
    const loadImage = async () => {
      if (!sandboxId || !filePath) {
        console.log('[useImageContent] Missing required parameters:', {
          hasSandboxId: !!sandboxId,
          hasFilePath: !!filePath,
        });
        setImageUrl(null);
        return;
      }

      const token = await getToken();
      if (!token) {
        console.log('[useImageContent] No token available');
        setImageUrl(null);
        return;
      }

      // Ensure path has correct workspace prefix for consistent caching
      const workspacePath = appType === 'mobile' ? '/workspace/cheatcode-mobile' : '/workspace/cheatcode-app';
      let normalizedPath = filePath;
      
      if (normalizedPath.startsWith(workspacePath)) {
        // Already correct
      } else if (normalizedPath.startsWith('/workspace')) {
        // Convert old /workspace paths to new structure
        const relativePart = normalizedPath.replace('/workspace/', '').replace('/workspace', '');
        // Remove any legacy workspace directory names
        const cleanRelativePart = relativePart.replace(/^(cheatcode-app|cheatcode-mobile)\//, '');
        normalizedPath = cleanRelativePart ? `${workspacePath}/${cleanRelativePart}` : workspacePath;
      } else {
        // Relative path, assume it's relative to current workspace
        normalizedPath = `${workspacePath}/${normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath}`;
      }

      // Define consistent cache keys
      const cacheKey = `${sandboxId}:${normalizedPath}:blob`;
      const loadKey = `${sandboxId}:${normalizedPath}`;
      
      // Check if image is already in cache
      const cached = FileCache.get(cacheKey);
      if (cached) {
        if (typeof cached === 'string' && cached.startsWith('blob:')) {
          console.log('[useImageContent] Using cached blob URL');
          setImageUrl(cached);
          return;
        } else if (cached instanceof Blob) {
          // If we have a raw blob object, create a URL from it
          try {
            const blobUrl = URL.createObjectURL(cached);
            console.log('[useImageContent] Created new blob URL from cached blob');
            setImageUrl(blobUrl);
            // Store the URL back in the cache
            FileCache.set(cacheKey, blobUrl);
            return;
          } catch (err) {
            console.error('[useImageContent] Error creating blob URL:', err);
            setError(new Error('Failed to create blob URL from cached blob'));
            setIsLoading(false);
          }
        } else {
          console.log('[useImageContent] Using cached value (not a blob URL)');
          setImageUrl(String(cached));
          return;
        }
      }

      // Check if this image is already being loaded by another component
      if (inProgressImageLoads.has(loadKey)) {
        console.log('[useImageContent] Image load already in progress, waiting for result');
        setIsLoading(true);
        
        inProgressImageLoads.get(loadKey)!
          .then(blobUrl => {
            setImageUrl(blobUrl);
            setIsLoading(false);
          })
          .catch(err => {
            console.error('[useImageContent] Error from in-progress load:', err);
            setError(err);
            setIsLoading(false);
          });
        
        return;
      }

      // If not cached or in progress, fetch the image directly with proper authentication
      console.log('[useImageContent] Fetching image:', normalizedPath);
      setIsLoading(true);
      
      // Create a URL for the fetch request
      const url = new URL(`${process.env.NEXT_PUBLIC_BACKEND_URL}/sandboxes/${sandboxId}/files/content`);
      url.searchParams.append('path', normalizedPath);
      
      // Create a promise for this load and track it
      const loadPromise = fetch(url.toString(), {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`Failed to load image: ${response.status} ${response.statusText}`);
          }
          return response.blob();
        })
        .then(blob => {
          // Create a blob URL from the image data
          const blobUrl = URL.createObjectURL(blob);
          console.log('[useImageContent] Successfully created blob URL from fetched image');
          
          // Cache both the blob and the URL
          FileCache.set(cacheKey, blobUrl);
          
          return blobUrl;
        });
      
      // Store the promise in the in-progress map
      inProgressImageLoads.set(loadKey, loadPromise);
      
      // Now use the promise for our state
      loadPromise
        .then(blobUrl => {
          setImageUrl(blobUrl);
          setIsLoading(false);
        })
        .catch(err => {
          console.error('Failed to load image:', err);
          console.error('Image loading details:', { 
            sandboxId, 
            filePath, 
            normalizedPath,
            hasToken: !!token,
            backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL 
          });
          setError(err);
          setIsLoading(false);
        })
        .finally(() => {
          // Remove from in-progress map when done
          inProgressImageLoads.delete(loadKey);
        });
    };

    loadImage();
  }, [sandboxId, filePath, appType, getToken]);

  return {
    data: imageUrl,
    isLoading,
    error
  };
}