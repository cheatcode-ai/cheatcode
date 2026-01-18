'use client';

import React, { forwardRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Paperclip, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@clerk/nextjs';
import { useQueryClient } from '@tanstack/react-query';
import { fileQueryKeys } from '@/hooks/react-query/files/use-file-queries';
// Tooltip removed to prevent ref compose loops
import { UploadedFile } from './chat-input';
import { normalizeFilenameToNFC } from '@/lib/utils/unicode';
import { API_URL } from '@/lib/api/config';

const isImageFile = (file: File): boolean => {
  // Check MIME type
  if (file.type && file.type.startsWith('image/')) {
    return true;
  }
  
  // Check file extension as fallback
  const fileName = file.name.toLowerCase();
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif'];
  return imageExtensions.some(ext => fileName.endsWith(ext));
};

const handleLocalFiles = (
  files: File[],
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>,
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
  appType: 'web' | 'mobile' = 'web',
) => {
  const filteredFiles = files.filter((file) => {
    if (!isImageFile(file)) {
      toast.error(`Only image files are allowed: ${file.name}`);
      return false;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error(`File size exceeds 50MB limit: ${file.name}`);
      return false;
    }
    return true;
  });

  setPendingFiles((prevFiles) => [...prevFiles, ...filteredFiles]);

  const workspacePath = appType === 'mobile' ? '/workspace/cheatcode-mobile' : '/workspace/cheatcode-app';
  
  const newUploadedFiles: UploadedFile[] = filteredFiles.map((file) => {
    // Normalize filename to NFC
    const normalizedName = normalizeFilenameToNFC(file.name);

    return {
      name: normalizedName,
      path: `${workspacePath}/${normalizedName}`,
      size: file.size,
      type: file.type || 'application/octet-stream',
      localUrl: URL.createObjectURL(file)
    };
  });

  setUploadedFiles((prev) => [...prev, ...newUploadedFiles]);
  filteredFiles.forEach((file) => {
    const normalizedName = normalizeFilenameToNFC(file.name);
    toast.success(`File attached: ${normalizedName}`);
  });
};

const uploadFiles = async (
  files: File[],
  sandboxId: string,
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
  setIsUploading: React.Dispatch<React.SetStateAction<boolean>>,
  messages: any[] = [], // Add messages parameter to check for existing files
  queryClient?: any, // Add queryClient parameter for cache invalidation
  getToken?: () => Promise<string | null>, // Add getToken function parameter
  appType: 'web' | 'mobile' = 'web',
) => {
  try {
    setIsUploading(true);

    const newUploadedFiles: UploadedFile[] = [];

    for (const file of files) {
      if (!isImageFile(file)) {
        toast.error(`Only image files are allowed: ${file.name}`);
        continue;
      }
      if (file.size > 50 * 1024 * 1024) {
        toast.error(`File size exceeds 50MB limit: ${file.name}`);
        continue;
      }

      // Normalize filename to NFC
      const normalizedName = normalizeFilenameToNFC(file.name);
      const workspacePath = appType === 'mobile' ? '/workspace/cheatcode-mobile' : '/workspace/cheatcode-app';
      const uploadPath = `${workspacePath}/${normalizedName}`;

      // Check if this filename already exists in chat messages
      const isFileInChat = messages.some(message => {
        const content = typeof message.content === 'string' ? message.content : '';
        return content.includes(`[Uploaded File: ${uploadPath}]`);
      });

      const formData = new FormData();
      // If the filename was normalized, append with the normalized name in the field name
      // The server will use the path parameter for the actual filename
      formData.append('file', file, normalizedName);
      formData.append('path', uploadPath);

      // Get Clerk token from the passed function
      if (!getToken) {
        throw new Error('Authentication not available. Please sign in to continue.');
      }
      
      const clerkToken = await getToken();
      if (!clerkToken) {
        throw new Error('Authentication required. Please sign in to continue.');
      }

      const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clerkToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      // If file was already in chat and we have queryClient, invalidate its cache
      if (isFileInChat && queryClient) {
        // Invalidate all content types for this file
        ['text', 'blob', 'json'].forEach(contentType => {
          const queryKey = fileQueryKeys.content(sandboxId, uploadPath, contentType);
          queryClient.removeQueries({ queryKey });
        });

        // Also invalidate directory listing
        const directoryPath = uploadPath.substring(0, uploadPath.lastIndexOf('/'));
        queryClient.invalidateQueries({
          queryKey: fileQueryKeys.directory(sandboxId, directoryPath),
        });
      }

      newUploadedFiles.push({
        name: normalizedName,
        path: uploadPath,
        size: file.size,
        type: file.type || 'application/octet-stream',
      });

      toast.success(`File uploaded: ${normalizedName}`);
    }

    setUploadedFiles((prev) => [...prev, ...newUploadedFiles]);
  } catch (error) {
    toast.error(
      typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : 'Failed to upload file',
    );
  } finally {
    setIsUploading(false);
  }
};

const handleFiles = async (
  files: File[],
  sandboxId: string | undefined,
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>,
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>,
  setIsUploading: React.Dispatch<React.SetStateAction<boolean>>,
  messages: any[] = [], // Add messages parameter
  queryClient?: any, // Add queryClient parameter
  getToken?: () => Promise<string | null>, // Add getToken function parameter
  appType: 'web' | 'mobile' = 'web',
) => {
  if (sandboxId) {
    // If we have a sandboxId, upload files directly
    await uploadFiles(files, sandboxId, setUploadedFiles, setIsUploading, messages, queryClient, getToken, appType);
  } else {
    // Otherwise, store files locally
    handleLocalFiles(files, setPendingFiles, setUploadedFiles, appType);
  }
};

interface FileUploadHandlerProps {
  loading: boolean;
  disabled: boolean;
  isAgentRunning: boolean;
  isUploading: boolean;
  sandboxId?: string;
  setPendingFiles: React.Dispatch<React.SetStateAction<File[]>>;
  setUploadedFiles: React.Dispatch<React.SetStateAction<UploadedFile[]>>;
  setIsUploading: React.Dispatch<React.SetStateAction<boolean>>;
  messages?: any[]; // Add messages prop
  isLoggedIn?: boolean;
  appType?: 'web' | 'mobile';
}

export const FileUploadHandler = forwardRef<
  HTMLInputElement,
  FileUploadHandlerProps
>(
  (
    {
      loading,
      disabled,
      isAgentRunning,
      isUploading,
      sandboxId,
      setPendingFiles,
      setUploadedFiles,
      setIsUploading,
      messages = [],
      isLoggedIn = true,
      appType = 'web',
    },
    ref,
  ) => {
    const queryClient = useQueryClient();
    const { getToken } = useAuth();
    
    // Clean up object URLs when component unmounts
    useEffect(() => {
      return () => {
        // Clean up any object URLs to avoid memory leaks
        setUploadedFiles(prev => {
          prev.forEach(file => {
            if (file.localUrl) {
              URL.revokeObjectURL(file.localUrl);
            }
          });
          return prev;
        });
      };
    }, []);

    const handleFileUpload = () => {
      if (ref && 'current' in ref && ref.current) {
        ref.current.click();
      }
    };

    const processFileUpload = async (
      event: React.ChangeEvent<HTMLInputElement>,
    ) => {
      if (!event.target.files || event.target.files.length === 0) return;

      const files = Array.from(event.target.files);
      // Use the helper function instead of the static method
      handleFiles(
        files,
        sandboxId,
        setPendingFiles,
        setUploadedFiles,
        setIsUploading,
        messages,
        queryClient,
        getToken,
        appType,
      );

      event.target.value = '';
    };

    return (
      <>
        <span className="inline-block">
          <Button
            type="button"
            onClick={handleFileUpload}
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 bg-transparent hover:bg-zinc-800/50 rounded-full text-zinc-400 hover:text-zinc-200 flex items-center justify-center transition-colors"
            disabled={
              !isLoggedIn || loading || (disabled && !isAgentRunning) || isUploading
            }
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </Button>
        </span>

        <input
          type="file"
          ref={ref}
          className="hidden"
          onChange={processFileUpload}
          multiple
          accept="image/*"
        />
      </>
    );
  },
);

FileUploadHandler.displayName = 'FileUploadHandler';
export { handleFiles };
