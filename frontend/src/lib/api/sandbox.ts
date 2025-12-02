// Sandbox and File API Functions
import { handleApiError } from '../error-handler';
import { API_URL } from './config';
import { FileInfo, FileTreeResponse } from './types';

// Helper function to normalize file paths with Unicode characters
function normalizePathWithUnicode(path: string): string {
  try {
    return path.replace(/\\u([0-9a-fA-F]{4})/g, (_, hexCode) => {
      return String.fromCharCode(parseInt(hexCode, 16));
    });
  } catch (e) {
    console.error('Error processing Unicode escapes in path:', e);
    return path;
  }
}

export const createSandboxFile = async (
  sandboxId: string,
  filePath: string,
  content: string,
  clerkToken?: string,
): Promise<void> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const formData = new FormData();
    formData.append('path', filePath);

    const blob = new Blob([content], { type: 'application/octet-stream' });
    formData.append('file', blob, filePath.split('/').pop() || 'file');

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${clerkToken}`,
    };

    const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/files`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error creating sandbox file: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error creating sandbox file: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Failed to create sandbox file:', error);
    handleApiError(error, { operation: 'create file', resource: `file ${filePath}` });
    throw error;
  }
};

export const createSandboxFileJson = async (
  sandboxId: string,
  filePath: string,
  content: string,
  clerkToken?: string,
): Promise<void> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${clerkToken}`,
    };

    const response = await fetch(
      `${API_URL}/sandboxes/${sandboxId}/files/json`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          path: filePath,
          content: content,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error creating sandbox file (JSON): ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error creating sandbox file: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Failed to create sandbox file with JSON:', error);
    handleApiError(error, { operation: 'create file', resource: `file ${filePath}` });
    throw error;
  }
};

export const listSandboxFiles = async (
  sandboxId: string,
  path: string,
  clerkToken?: string,
): Promise<FileInfo[]> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/sandboxes/${sandboxId}/files`);

    const normalizedPath = normalizePathWithUnicode(path);
    url.searchParams.append('path', normalizedPath);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${clerkToken}`,
    };

    const response = await fetch(url.toString(), {
      headers,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error listing sandbox files: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error listing sandbox files: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error('Failed to list sandbox files:', error);
    throw error;
  }
};

export const listProjectFiles = async (
  projectId: string,
  path: string = "",
  clerkToken?: string,
): Promise<FileInfo[]> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/project/${projectId}/git/files`);
    url.searchParams.append('path', path);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details available');
      console.error(`Error listing project files: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Error listing project files: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
    console.error('Failed to list project files:', error);
    throw error;
  }
};

export const getProjectFileContent = async (
  projectId: string,
  filePath: string,
  clerkToken?: string,
): Promise<string> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/project/${projectId}/git/file-content`);
    url.searchParams.append('file_path', filePath);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details available');
      console.error(`Error getting project file content: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Error getting project file content: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    return data.content || '';
  } catch (error) {
    console.error('Failed to get project file content:', error);
    throw error;
  }
};

export const getSandboxFileContent = async (
  sandboxId: string,
  path: string,
  clerkToken?: string,
): Promise<string | Blob> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/sandboxes/${sandboxId}/files/content`);

    const normalizedPath = normalizePathWithUnicode(path);
    url.searchParams.append('path', normalizedPath);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${clerkToken}`,
    };

    const response = await fetch(url.toString(), {
      headers,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => 'No error details available');
      console.error(
        `Error getting sandbox file content: ${response.status} ${response.statusText}`,
        errorText,
      );
      throw new Error(
        `Error getting sandbox file content: ${response.statusText} (${response.status})`,
      );
    }

    const contentType = response.headers.get('content-type');
    const fileName = path.split('/').pop() || '';
    const extension = fileName.split('.').pop()?.toLowerCase() || '';

    const textExtensions = ['ts', 'tsx', 'js', 'jsx', 'css', 'html', 'json', 'md', 'txt', 'yml', 'yaml', 'toml', 'xml', 'csv'];
    const isTextFile = textExtensions.includes(extension);

    if (
      isTextFile ||
      (contentType && contentType.includes('text')) ||
      contentType?.includes('application/json')
    ) {
      return await response.text();
    } else {
      return await response.blob();
    }
  } catch (error) {
    console.error('Failed to get sandbox file content:', error);
    handleApiError(error, { operation: 'load file content', resource: `file ${path}` });
    throw error;
  }
};

/**
 * Get complete file tree in a single API call.
 *
 * This is the optimized endpoint that replaces multiple recursive list_files calls
 * with a single search_files call on the backend, dramatically improving performance.
 *
 * @param sandboxId - The sandbox ID
 * @param path - Optional base path (defaults to workspace path based on app type)
 * @param clerkToken - Authentication token
 * @returns FileTreeResponse with nested tree structure, total count, and base path
 */
export const getSandboxFileTree = async (
  sandboxId: string,
  path?: string,
  clerkToken?: string,
): Promise<FileTreeResponse> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const url = new URL(`${API_URL}/sandboxes/${sandboxId}/files/tree`);

    if (path) {
      const normalizedPath = normalizePathWithUnicode(path);
      url.searchParams.append('path', normalizedPath);
    }

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${clerkToken}`,
    };

    console.log('[FILE TREE API] Fetching complete file tree in single call');
    const startTime = performance.now();

    const response = await fetch(url.toString(), {
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details available');
      console.error(`Error getting file tree: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Error getting file tree: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();

    const endTime = performance.now();
    console.log(`[FILE TREE API] Loaded ${data.totalFiles} files in ${Math.round(endTime - startTime)}ms`);

    return data as FileTreeResponse;
  } catch (error) {
    console.error('Failed to get sandbox file tree:', error);
    handleApiError(error, { operation: 'load file tree', resource: 'project files' });
    throw error;
  }
};

/**
 * Download project code as a tar.gz archive.
 *
 * Uses optimized server-side archive creation instead of downloading
 * each file individually. Reduces 100+ API calls to a single request.
 */
export const downloadSandboxCode = async (
  sandboxId: string,
  projectName: string,
  clerkToken?: string,
  appType: 'web' | 'mobile' = 'web',
): Promise<void> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    console.log('[DOWNLOAD] Starting optimized server-side archive download');
    const startTime = performance.now();

    const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/download-archive`, {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details available');
      console.error(`Error downloading archive: ${response.status} ${response.statusText}`, errorText);
      throw new Error(`Error downloading archive: ${response.statusText} (${response.status})`);
    }

    // Get the blob from response
    const blob = await response.blob();

    const endTime = performance.now();
    console.log(`[DOWNLOAD] Archive received in ${Math.round(endTime - startTime)}ms, size: ${(blob.size / 1024).toFixed(1)}KB`);

    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    // Use filename from Content-Disposition header if available, otherwise generate one
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = `${projectName || 'project'}-code.zip`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match) {
        filename = match[1];
      }
    }

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`[DOWNLOAD] Download complete: ${filename}`);

  } catch (error) {
    console.error('Failed to download sandbox code:', error);
    handleApiError(error, { operation: 'download code', resource: 'project files' });
    throw error;
  }
};
