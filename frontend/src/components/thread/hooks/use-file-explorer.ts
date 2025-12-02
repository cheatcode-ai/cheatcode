import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { getSandboxFileTree, getSandboxFileContent } from '@/lib/api';
import { FileTreeNode, FileTreeResponse } from '@/lib/api/types';

interface UseFileExplorerProps {
  sandboxId?: string;
  projectId?: string; // Keep for fallback compatibility
  isCodeTabActive: boolean;
  appType?: 'web' | 'mobile';
}

/**
 * Flattens a nested tree structure for efficient rendering with virtualization.
 * Each node includes its depth level for indentation.
 */
interface FlattenedNode extends FileTreeNode {
  level: number;
  isExpanded?: boolean;
  hasChildren: boolean;
}

/**
 * Optimized File Explorer Hook
 *
 * Key optimizations:
 * 1. Uses single API call (/files/tree) instead of N+1 recursive calls
 * 2. Server-side filtering eliminates wasted bandwidth
 * 3. Pre-built tree structure from backend
 * 4. Smart file content prefetching for adjacent files
 * 5. Efficient React Query caching
 */
export const useFileExplorer = ({
  sandboxId,
  projectId,
  isCodeTabActive,
  appType = 'web'
}: UseFileExplorerProps) => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  // Determine workspace path based on app type
  const workspacePath = appType === 'mobile' ? '/workspace/cheatcode-mobile' : '/workspace/cheatcode-app';

  // Main file tree query - single optimized API call
  const {
    data: fileTreeData,
    isLoading: isLoadingFileTree,
    error: fileTreeError,
    refetch: refetchFileTree,
  } = useQuery({
    queryKey: ['file-tree-optimized', sandboxId, appType],
    queryFn: async (): Promise<FileTreeResponse> => {
      if (!sandboxId) throw new Error('No sandbox ID');

      const token = await getToken();
      if (!token) throw new Error('No authentication token');

      console.log('[FILE EXPLORER] Fetching complete file tree via optimized endpoint');
      const startTime = performance.now();

      const result = await getSandboxFileTree(sandboxId, workspacePath, token);

      const endTime = performance.now();
      console.log(`[FILE EXPLORER] Tree loaded: ${result.totalFiles} files in ${Math.round(endTime - startTime)}ms`);

      return result;
    },
    enabled: isCodeTabActive && !!sandboxId,
    staleTime: 30 * 1000, // Cache for 30 seconds
    gcTime: 60 * 1000, // Keep in garbage collection for 1 minute
    refetchOnWindowFocus: true,
    retry: 2,
  });

  // Extract tree from response
  const fileTree = fileTreeData?.tree ?? [];

  // File content query
  const {
    data: fileContent,
    isLoading: isLoadingContent,
    error: contentError,
  } = useQuery({
    queryKey: ['file-content-optimized', sandboxId, selectedFile, appType],
    queryFn: async () => {
      if (!selectedFile || !sandboxId) return null;

      const token = await getToken();
      if (!token) throw new Error('No authentication token');

      // Construct full path for API call
      const fullPath = `${workspacePath}/${selectedFile}`;
      console.log('[FILE EXPLORER] Loading file content:', fullPath);

      const content = await getSandboxFileContent(sandboxId, fullPath, token);
      return typeof content === 'string' ? content : '[Binary file]';
    },
    enabled: !!selectedFile && !!sandboxId,
    staleTime: 2 * 60 * 1000, // Cache content for 2 minutes
    gcTime: 5 * 60 * 1000,
  });

  // Prefetch adjacent files for faster navigation
  const prefetchAdjacentFiles = useCallback(async (currentFile: string) => {
    if (!sandboxId || !fileTree.length) return;

    const token = await getToken();
    if (!token) return;

    // Find siblings of the current file
    const findSiblings = (nodes: FileTreeNode[], targetPath: string): FileTreeNode[] => {
      for (const node of nodes) {
        if (node.type === 'directory' && node.children) {
          // Check if target is in this directory
          const childPaths = node.children.map(c => c.path);
          if (childPaths.includes(targetPath)) {
            // Return sibling files (not directories)
            return node.children.filter(c => c.type === 'file' && c.path !== targetPath);
          }
          // Recurse into subdirectories
          const found = findSiblings(node.children, targetPath);
          if (found.length) return found;
        }
      }
      // Check root level
      const rootFiles = nodes.filter(n => n.type === 'file');
      if (rootFiles.some(f => f.path === targetPath)) {
        return rootFiles.filter(f => f.path !== targetPath);
      }
      return [];
    };

    const siblings = findSiblings(fileTree, currentFile);

    // Prefetch up to 3 sibling files
    const filesToPrefetch = siblings.slice(0, 3);

    for (const file of filesToPrefetch) {
      queryClient.prefetchQuery({
        queryKey: ['file-content-optimized', sandboxId, file.path, appType],
        queryFn: async () => {
          const fullPath = `${workspacePath}/${file.path}`;
          const content = await getSandboxFileContent(sandboxId, fullPath, token);
          return typeof content === 'string' ? content : '[Binary file]';
        },
        staleTime: 2 * 60 * 1000,
      });
    }
  }, [sandboxId, fileTree, workspacePath, getToken, queryClient, appType]);

  // Handle file selection with prefetching
  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedFile(filePath);
    // Prefetch adjacent files in the background
    prefetchAdjacentFiles(filePath);
  }, [prefetchAdjacentFiles]);

  // Handle directory toggle (expand/collapse)
  const handleDirectoryToggle = useCallback((directoryPath: string) => {
    setExpandedDirectories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(directoryPath)) {
        newSet.delete(directoryPath);
      } else {
        newSet.add(directoryPath);
      }
      return newSet;
    });
  }, []);

  // Find first selectable file for auto-selection
  const findFirstSelectableFile = useCallback((nodes: FileTreeNode[]): string | null => {
    for (const node of nodes) {
      if (node.type === 'file') {
        return node.path;
      }
      if (node.type === 'directory' && node.children) {
        const found = findFirstSelectableFile(node.children);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // Auto-select first file when tree loads
  useEffect(() => {
    if (isCodeTabActive && fileTree.length > 0 && !selectedFile) {
      const firstFile = findFirstSelectableFile(fileTree);
      if (firstFile) {
        setSelectedFile(firstFile);
      }
    }
  }, [isCodeTabActive, fileTree, selectedFile, findFirstSelectableFile]);

  // Reset state when sandbox changes
  useEffect(() => {
    if (sandboxId) {
      setSelectedFile(null);
      setExpandedDirectories(new Set());
    }
  }, [sandboxId, appType]);

  // Force refresh function
  const forceRefresh = useCallback(() => {
    console.log('[FILE EXPLORER] Force refreshing file tree and content');
    queryClient.invalidateQueries({ queryKey: ['file-tree-optimized', sandboxId] });
    queryClient.invalidateQueries({ queryKey: ['file-content-optimized', sandboxId] });
    setSelectedFile(null);
    setExpandedDirectories(new Set());
  }, [queryClient, sandboxId]);

  // Invalidate just file content (for when files are modified by agents)
  const invalidateFileContent = useCallback(() => {
    console.log('[FILE EXPLORER] Invalidating file content cache');
    queryClient.invalidateQueries({ queryKey: ['file-content-optimized', sandboxId] });
  }, [queryClient, sandboxId]);

  // Convert FileTreeNode[] to the format expected by existing components
  // This maintains backward compatibility with the existing FileTree component
  const processedFiles = useMemo(() => {
    const convertNode = (node: FileTreeNode): any => ({
      name: node.name,
      type: node.type,
      path: node.path,
      fullPath: node.fullPath,
      children: node.children?.map(convertNode),
    });
    return fileTree.map(convertNode);
  }, [fileTree]);

  // Format content for display
  const displayContent = useMemo(() => {
    if (!fileContent) return '';
    if (typeof fileContent === 'string') return fileContent;
    if (typeof fileContent === 'object') return JSON.stringify(fileContent, null, 2);
    return '[Binary file - cannot display]';
  }, [fileContent]);

  return {
    // File selection
    selectedFile,
    handleFileSelect,

    // File tree
    processedFiles,
    isLoadingFiles: isLoadingFileTree,
    filesError: fileTreeError,

    // File content
    displayContent,
    isLoadingContent,
    contentError,

    // Directory expansion
    expandedDirectories,
    handleDirectoryToggle,

    // Utilities
    forceRefresh,
    invalidateFileContent,
    loadingDirectories: new Set<string>(), // No longer needed with single API call

    // Debug info
    totalFiles: fileTreeData?.totalFiles ?? 0,
  };
};
