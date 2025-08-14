import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFileContentQuery, fileQueryKeys } from '@/hooks/react-query/files';
import { useAuth } from '@clerk/nextjs';
import { listSandboxFiles, listProjectFiles, getProjectFileContent, FileInfo } from '@/lib/api';
import { FileTreeItem } from '../types/app-preview';
import { processDirectoryFiles, findFirstSelectableFile, formatFileContent, isExcludedDirectory } from '../utils/file-utils';

interface UseFileExplorerProps {
  sandboxId?: string; // Keep for fallback compatibility
  projectId?: string; // New primary way to access files via Git
  isCodeTabActive: boolean;
  appType?: 'web' | 'mobile';
}

// Recursive function to fetch entire directory tree
const fetchCompleteDirectoryTree = async (
  sandboxId: string,
  rootPath: string,
  getToken: () => Promise<string | null>,
  workspacePath: string
): Promise<FileTreeItem[]> => {
  const token = await getToken();
  if (!token) throw new Error('No authentication token');

  const fetchDirectoryContents = async (dirPath: string): Promise<FileTreeItem[]> => {
    try {
      console.log(`[FILE TREE] Fetching directory: ${dirPath}`);
      const files = await listSandboxFiles(sandboxId, dirPath, token);
      
      const items: FileTreeItem[] = [];
      
      for (const file of files) {
        // Skip excluded directories EARLY - don't even process them
        if (file.is_dir && isExcludedDirectory(file.name)) {
          console.log(`[FILE TREE] Skipping excluded directory: ${file.name}`);
          continue;
        }
        
        // Skip unimportant files (but allow all non-excluded directories through)
        if (!file.is_dir) {
          const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
          const importantExtensions = ['tsx', 'ts', 'js', 'jsx', 'css', 'json', 'md', 'html', 'txt', 'yml', 'yaml', 'toml'];
          const importantFiles = ['package.json', 'next.config.ts', 'tailwind.config.ts', 'README.md', 'Dockerfile', '.gitignore'];
          
          const isImportant = importantFiles.includes(file.name) || 
                            importantExtensions.includes(fileExtension);
          
          if (!isImportant) continue;
        }

        const relativePath = file.path.replace(`${workspacePath}/`, '').replace(workspacePath, '') || file.name;
        
        const item: FileTreeItem = {
          name: file.name,
          type: file.is_dir ? ('directory' as const) : ('file' as const),
          path: relativePath,
          fullPath: file.path,
        };

        // Only recurse into directories that we want to show (already filtered above)
        if (file.is_dir) {
          try {
            console.log(`[FILE TREE] Recursively fetching directory: ${file.path}`);
            item.children = await fetchDirectoryContents(file.path);
          } catch (error) {
            console.warn(`Failed to fetch contents of directory ${file.path}:`, error);
            item.children = []; // Empty children for directories we can't access
          }
        }

        items.push(item);
      }

      // Sort items: directories first, then files, alphabetically within each group
      return items.sort((a, b) => {
        if (a.type === 'directory' && b.type === 'file') return -1;
        if (a.type === 'file' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
      
    } catch (error) {
      console.error(`Error fetching directory ${dirPath}:`, error);
      return [];
    }
  };

  return fetchDirectoryContents(rootPath);
};

export const useFileExplorer = ({ sandboxId, projectId, isCodeTabActive, appType = 'web' }: UseFileExplorerProps) => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<FileTreeItem[]>([]);
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(new Set());
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(new Set());
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  // Prefer sandboxId over projectId for Daytona SDK-based file access
  const useSandboxFiles = !!sandboxId;
  const sourceId = sandboxId || projectId;

  // Determine workspace path based on app type
  const workspacePath = appType === 'mobile' ? '/workspace/cheatcode-mobile' : '/workspace/cheatcode-app';

  // Clear file tree when sourceId or appType changes
  useEffect(() => {
    if (sourceId) {
      // Clear all state for new source
      setFileTree([]);
      setExpandedDirectories(new Set());
      setLoadingDirectories(new Set());
      setSelectedFile(null);
      
      // Invalidate cached queries only on source/app type change
      queryClient.invalidateQueries({ queryKey: ['complete-file-tree', sourceId] });
      queryClient.invalidateQueries({ queryKey: ['file-content', sourceId] });
    }
  }, [sourceId, appType, queryClient]);

  // Load directory contents function for lazy loading
  const loadDirectory = useCallback(async (path: string) => {
    if (!sourceId) return;

    // Mark directory as loading
    setLoadingDirectories(prev => new Set(prev).add(path));

    try {
      const token = await getToken();
      if (!token) throw new Error('No authentication token');

      let files: FileInfo[] = [];
      
      if (useSandboxFiles && sandboxId) {
        // Use Daytona sandbox API for files (primary)
        console.log('[FILE EXPLORER] Loading directory via Daytona sandbox API:', path);
        files = await listSandboxFiles(sandboxId, path, token);
      } else if (projectId) {
        // Fallback to Git-based API for project files
        console.log('[FILE EXPLORER] Loading directory via Git API:', path);
        files = await listProjectFiles(projectId, path, token);
      } else {
        throw new Error('No valid source for files');
      }

      // Convert files to FileTreeItem format, filtering out excluded items
      const processedFiles: FileTreeItem[] = files
        .filter(file => {
          // Skip excluded directories
          if (file.is_dir && isExcludedDirectory(file.name)) {
            return false;
          }
          
          // For files, only include important ones
          if (!file.is_dir) {
            const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';
            const importantExtensions = ['tsx', 'ts', 'js', 'jsx', 'css', 'json', 'md', 'html', 'txt', 'yml', 'yaml', 'toml'];
            const importantFiles = ['package.json', 'next.config.ts', 'tailwind.config.ts', 'README.md', 'Dockerfile', '.gitignore'];
            
            const isImportant = importantFiles.includes(file.name) || 
                              importantExtensions.includes(fileExtension);
            return isImportant;
          }
          
          return true; // Include all non-excluded directories
        })
        .map(file => ({
          name: file.name,
          type: file.is_dir ? 'directory' as const : 'file' as const,
          path: file.path,
          fullPath: file.path,
          children: file.is_dir ? [] : undefined, // Empty array for directories, undefined for files
        }));

      // Update the file tree state
      if (path === '') {
        // Root directory - replace entire tree
        setFileTree(processedFiles);
      } else {
        // Subdirectory - find and update the correct node
        setFileTree(prevTree => {
          const updateTreeNode = (nodes: FileTreeItem[]): FileTreeItem[] => {
            return nodes.map(node => {
              if (node.type === 'directory' && node.path === path) {
                // Found the target directory - update its children
                return { ...node, children: processedFiles };
              } else if (node.type === 'directory' && node.children && path.startsWith(node.path + '/')) {
                // This directory is in the path to the target - recurse
                return { ...node, children: updateTreeNode(node.children) };
              }
              return node;
            });
          };
          return updateTreeNode(prevTree);
        });
      }

      console.log(`[FILE EXPLORER] Loaded ${processedFiles.length} items for path: ${path}`);
    } catch (error) {
      console.error(`[FILE EXPLORER] Failed to load directory ${path}:`, error);
    } finally {
      // Remove from loading state
      setLoadingDirectories(prev => {
        const newSet = new Set(prev);
        newSet.delete(path);
        return newSet;
      });
    }
  }, [sourceId, useSandboxFiles, projectId, sandboxId, getToken]);

  // React Query for complete file tree (cached)
  const {
    data: cachedFileTree,
    isLoading: isLoadingFileTree,
    error: fileTreeError
  } = useQuery({
    queryKey: ['complete-file-tree', sourceId, useSandboxFiles ? 'sandbox' : 'git', appType],
    queryFn: async () => {
      if (!sourceId) return [];

      if (useSandboxFiles && sandboxId) {
        // Use recursive Daytona SDK approach for complete file tree
        console.log('[FILE EXPLORER] Loading complete directory tree via Daytona SDK');
        const completeTree = await fetchCompleteDirectoryTree(
          sandboxId,
          workspacePath,
          getToken,
          workspacePath
        );
        console.log(`[FILE EXPLORER] Loaded complete tree with ${completeTree.length} root items`);
        return completeTree;
      } else if (projectId) {
        // Fallback to Git-based lazy loading for projects without sandbox
        console.log('[FILE EXPLORER] Fallback to Git-based file access - no caching');
        return [];
      }
      return [];
    },
    enabled: isCodeTabActive && !!sourceId && useSandboxFiles && !!sandboxId,
    staleTime: 5 * 60 * 1000, // Cache file tree for 5 minutes
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes after unused
  });

  // Update local file tree state when cached data changes
  useEffect(() => {
    if (cachedFileTree && cachedFileTree.length > 0) {
      setFileTree(cachedFileTree);
    }
  }, [cachedFileTree]);

  // Initial load for Git-based projects (non-cached)
  useEffect(() => {
    const loadGitFiles = async () => {
      if (!isCodeTabActive || !sourceId || !projectId || useSandboxFiles) return;
      if (fileTree.length > 0) return;

      console.log('[FILE EXPLORER] Initial load for Git-based project');
      loadDirectory('');
    };

    loadGitFiles();
  }, [isCodeTabActive, sourceId, projectId, useSandboxFiles, fileTree.length, loadDirectory]);

  // Handle directory toggle (expand/collapse) - purely UI since all files are pre-loaded
  const handleDirectoryToggle = useCallback((directoryPath: string) => {
    console.log('[FILE EXPLORER] Directory toggle:', directoryPath);
    
    setExpandedDirectories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(directoryPath)) {
        // Collapsing - remove from expanded set
        newSet.delete(directoryPath);
      } else {
        // Expanding - add to expanded set (all data already loaded recursively)
        newSet.add(directoryPath);
      }
      return newSet;
    });
  }, []);

  // Auto-select first file when switching to code tab
  useEffect(() => {
    if (isCodeTabActive && fileTree.length > 0 && !selectedFile) {
      const firstFile = findFirstSelectableFile(fileTree);
      if (firstFile) {
        setSelectedFile(firstFile);
      }
    }
  }, [isCodeTabActive, fileTree, selectedFile]);

  // Loading state - true if file tree is loading or any directory is loading
  const isLoadingFiles = isLoadingFileTree || 
                         (fileTree.length === 0 && isCodeTabActive && !!sourceId) || 
                         loadingDirectories.size > 0;
  const filesError = fileTreeError; // Use the React Query error

  // React Query for file content (only load when file is selected)
  const {
    data: fileContentData,
    isLoading: isLoadingContent,
    error: contentError
  } = useQuery({
    queryKey: ['file-content', sourceId, useSandboxFiles ? 'sandbox' : 'git', selectedFile, appType],
    queryFn: async () => {
      if (!selectedFile || !sourceId) return null;
      
      if (useSandboxFiles && sandboxId) {
        // Use Daytona sandbox API for file content (primary)
        // Construct full path for API call
        const fullPath = `${workspacePath}/${selectedFile}`;
        console.log('[FILE EXPLORER] Using Daytona sandbox API for file content:', fullPath);
        const { getSandboxFileContent } = await import('@/lib/api');
        const token = await getToken();
        if (!token) throw new Error('No authentication token');
        const content = await getSandboxFileContent(sandboxId, fullPath, token);
        return typeof content === 'string' ? content : '[Binary file]';
      } else if (projectId) {
        // Fallback to Git-based API for file content
        console.log('[FILE EXPLORER] Using Git API for file content:', selectedFile);
        const token = await getToken();
        if (!token) throw new Error('No authentication token');
        
        const content = await getProjectFileContent(projectId, selectedFile, token);
        console.log('[FILE EXPLORER] Git API returned content length:', content?.length || 0);
        return content;
      } else {
        throw new Error('No valid source for file content');
      }
    },
    enabled: !!selectedFile && !!sourceId,
    staleTime: 2 * 60 * 1000, // Cache file content for 2 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes after unused
  });

  // Log warning for 404 errors (likely cache issue)
  useEffect(() => {
    if (contentError && selectedFile) {
      if (contentError.message?.includes('404') || contentError.message?.includes('Not Found')) {
        console.warn('File not found - possible cache issue. Try refreshing the page.', selectedFile);
      }
    }
  }, [contentError, selectedFile]);

  // Format content for display
  const displayContent = formatFileContent(fileContentData);

  // Handle file selection
  const handleFileSelect = useCallback((filePath: string) => {
    // Store just the relative path for the selected file
    setSelectedFile(filePath);
  }, []);

  // Force refresh function for cache issues and file changes
  const forceRefresh = useCallback(() => {
    console.log('[FILE EXPLORER] Force refreshing cache and file tree');
    // Clear all cached content for this source
    queryClient.removeQueries({ queryKey: ['file-content', sourceId] });
    queryClient.removeQueries({ queryKey: ['complete-file-tree', sourceId] });
    
    // Reset local state
    setFileTree([]);
    setExpandedDirectories(new Set());
    setLoadingDirectories(new Set());
    setSelectedFile(null);
    
    // Trigger reload of root directory
    if (isCodeTabActive && sourceId) {
      loadDirectory('');
    }
  }, [queryClient, isCodeTabActive, sourceId, loadDirectory]);

  // Invalidate just file content cache (for when files are modified by agents)
  const invalidateFileContent = useCallback(() => {
    console.log('[FILE EXPLORER] Invalidating file content cache');
    queryClient.invalidateQueries({ queryKey: ['file-content', sourceId] });
  }, [queryClient, sourceId]);

  return {
    selectedFile,
    processedFiles: fileTree,
    displayContent,
    isLoadingFiles,
    isLoadingContent,
    filesError,
    contentError,
    handleFileSelect,
    handleDirectoryToggle,
    expandedDirectories,
    forceRefresh,
    invalidateFileContent,
    loadingDirectories
  };
}; 