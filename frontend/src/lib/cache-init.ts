import { FileCache } from '@/hooks/use-cached-file';

/**
 * Cache system state - singleton pattern to prevent memory leaks
 */
let cacheSystemState: {
  isInitialized: boolean;
  cleanupInterval: NodeJS.Timeout | null;
  handleVisibilityChange: (() => void) | null;
  handleBeforeUnload: (() => void) | null;
} = {
  isInitialized: false,
  cleanupInterval: null,
  handleVisibilityChange: null,
  handleBeforeUnload: null,
};

/**
 * Initialize cache maintenance routines
 * - Sets up interval to clean expired cache entries
 * - Adds event handlers for visibility and page unload
 * - Uses singleton pattern to prevent duplicate listeners
 */
export function initializeCacheSystem() {
  // Prevent duplicate initialization
  if (cacheSystemState.isInitialized) {
    return {
      stopCacheSystem: removeEventListeners,
      clearCache,
    };
  }

  // Clean up expired cache entries every 5 minutes
  const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

  // Cache entry expiration
  const DEFAULT_EXPIRATION = 30 * 60 * 1000; // 30 minutes

  // Clean up function to remove expired entries and release blob URLs
  const cleanupCache = () => {
    const now = Date.now();
    const blobUrlsToRevoke: string[] = [];

    // Access the internal Map from FileCache
    const cache = (FileCache as { cache?: Map<string, { timestamp: number; type: string; content: string }> }).cache;

    if (cache && typeof cache.forEach === 'function') {
      const keysToDelete: string[] = [];

      cache.forEach((entry, key) => {
        // Check if the entry has expired
        if (now - entry.timestamp > DEFAULT_EXPIRATION) {
          keysToDelete.push(key);

          // If it's a blob URL, add it to our revocation list
          if (entry.type === 'url' && typeof entry.content === 'string' && entry.content.startsWith('blob:')) {
            blobUrlsToRevoke.push(entry.content);
          }
        }
      });

      // Delete expired keys
      keysToDelete.forEach(key => {
        FileCache.delete(key);
      });

      // Revoke blob URLs
      blobUrlsToRevoke.forEach(url => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Failed to revoke blob URL
        }
      });
    }
  };

  // Set up visibility change handler to clean cache when page becomes visible again
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      // User returned to the page, run a cleanup
      cleanupCache();
    }
  };

  // Clean all blob URLs before page unload to prevent memory leaks
  const handleBeforeUnload = () => {
    // This is more aggressive as we're about to unload anyway
    const cache = (FileCache as { cache?: Map<string, { type: string; content: string }> }).cache;

    if (cache && typeof cache.forEach === 'function') {
      cache.forEach((entry) => {
        if (entry.type === 'url' && typeof entry.content === 'string' && entry.content.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(entry.content);
          } catch {
            // Ignore errors during page unload
          }
        }
      });
    }
  };

  // Store handlers in state so we can remove them later
  cacheSystemState.handleVisibilityChange = handleVisibilityChange;
  cacheSystemState.handleBeforeUnload = handleBeforeUnload;

  // Start the cleanup interval
  cacheSystemState.cleanupInterval = setInterval(cleanupCache, CLEANUP_INTERVAL);

  // Initialize event listeners
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', handleBeforeUnload);

  // Mark as initialized
  cacheSystemState.isInitialized = true;

  // Return a cleanup function
  return {
    stopCacheSystem: removeEventListeners,
    clearCache,
  };
}

/**
 * Remove all event listeners and clear interval
 */
function removeEventListeners() {
  if (cacheSystemState.handleVisibilityChange) {
    document.removeEventListener('visibilitychange', cacheSystemState.handleVisibilityChange);
    cacheSystemState.handleVisibilityChange = null;
  }

  if (cacheSystemState.handleBeforeUnload) {
    window.removeEventListener('beforeunload', cacheSystemState.handleBeforeUnload);
    cacheSystemState.handleBeforeUnload = null;
  }

  if (cacheSystemState.cleanupInterval) {
    clearInterval(cacheSystemState.cleanupInterval);
    cacheSystemState.cleanupInterval = null;
  }

  cacheSystemState.isInitialized = false;
}

/**
 * Clear all cache entries and revoke blob URLs
 */
function clearCache() {
  // Revoke all blob URLs before clearing
  const cache = (FileCache as { cache?: Map<string, { type: string; content: string }> }).cache;

  if (cache && typeof cache.forEach === 'function') {
    cache.forEach((entry) => {
      if (entry.type === 'url' && typeof entry.content === 'string' && entry.content.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(entry.content);
        } catch {
          // Failed to revoke URL during cache clear
        }
      }
    });
  }

  // Clear the cache
  FileCache.clear();
}
