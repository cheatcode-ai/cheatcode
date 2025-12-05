import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/nextjs';
import { fileQueryKeys } from './use-file-queries';
import { toast } from 'sonner';
import { API_URL } from '@/lib/api/config';

function normalizePath(path: string): string {
  if (!path) return '/';

  // Remove any leading/trailing whitespace
  path = path.trim();

  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }

  // Remove duplicate slashes and normalize
  path = path.replace(/\/+/g, '/');

  // Remove trailing slash unless it's the root
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return path;
}

/**
 * Hook for uploading files
 */
export function useFileUpload() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sandboxId,
      file,
      targetPath,
    }: {
      sandboxId: string;
      file: File;
      targetPath: string;
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('No access token available');
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', targetPath);

      const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Upload failed');
      }

      return await response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate directory listing for the target directory
      const directoryPath = variables.targetPath.substring(0, variables.targetPath.lastIndexOf('/'));
      queryClient.invalidateQueries({
        queryKey: fileQueryKeys.directory(variables.sandboxId, directoryPath),
      });

      // Also invalidate all file listings to be safe
      queryClient.invalidateQueries({
        queryKey: fileQueryKeys.directories(),
      });

      toast.success(`Uploaded: ${variables.file.name}`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Upload failed: ${message}`);
    },
  });
}

/**
 * Hook for deleting files
 */
export function useFileDelete() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sandboxId,
      filePath,
    }: {
      sandboxId: string;
      filePath: string;
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('No access token available');
      }

      const response = await fetch(
        `${API_URL}/sandboxes/${sandboxId}/files?path=${encodeURIComponent(filePath)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Delete failed');
      }

      return await response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate directory listing for the parent directory
      const directoryPath = variables.filePath.substring(0, variables.filePath.lastIndexOf('/'));
      queryClient.invalidateQueries({
        queryKey: fileQueryKeys.directory(variables.sandboxId, directoryPath),
      });

      // Invalidate all directory listings to be safe
      queryClient.invalidateQueries({
        queryKey: fileQueryKeys.directories(),
      });

      // Invalidate all file content queries for this specific file
      // This covers all content types (text, blob, json) for the deleted file
      queryClient.invalidateQueries({
        predicate: (query) => {
          const queryKey = query.queryKey;
          // Check if this is a file content query for our sandbox and file
          return (
            queryKey.length >= 4 &&
            queryKey[0] === 'files' &&
            queryKey[1] === 'content' &&
            queryKey[2] === variables.sandboxId &&
            queryKey[3] === variables.filePath
          );
        },
      });

      // Also remove the specific queries from cache completely
      ['text', 'blob', 'json'].forEach(contentType => {
        const queryKey = fileQueryKeys.content(variables.sandboxId, variables.filePath, contentType);
        queryClient.removeQueries({ queryKey });
      });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Delete failed: ${message}`);
    },
  });
}

/**
 * Hook for creating files
 */
export function useFileCreate() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sandboxId,
      filePath,
      content,
    }: {
      sandboxId: string;
      filePath: string;
      content: string;
    }) => {
      const token = await getToken();
      if (!token) {
        throw new Error('No access token available');
      }

      const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/files`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: filePath,
          content,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || 'Create failed');
      }

      return await response.json();
    },
    onSuccess: (_, variables) => {
      // Invalidate directory listing for the parent directory
      const directoryPath = variables.filePath.substring(0, variables.filePath.lastIndexOf('/'));
      queryClient.invalidateQueries({
        queryKey: fileQueryKeys.directory(variables.sandboxId, directoryPath),
      });

      toast.success('File created successfully');
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Create failed: ${message}`);
    },
  });
} 