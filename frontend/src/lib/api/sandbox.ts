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
      throw new Error(
        `Error creating sandbox file: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
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
      throw new Error(
        `Error creating sandbox file: ${response.statusText} (${response.status})`,
      );
    }

    const result = await response.json();
    return result;
  } catch (error) {
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
      throw new Error(
        `Error listing sandbox files: ${response.statusText} (${response.status})`,
      );
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
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
      throw new Error(`Error listing project files: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    return data.files || [];
  } catch (error) {
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
      throw new Error(`Error getting project file content: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();
    return data.content || '';
  } catch (error) {
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

    const response = await fetch(url.toString(), {
      headers,
    });

    if (!response.ok) {
      throw new Error(`Error getting file tree: ${response.statusText} (${response.status})`);
    }

    const data = await response.json();

    return data as FileTreeResponse;
  } catch (error) {
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
  _appType: 'web' | 'mobile' = 'web',
): Promise<void> => {
  try {
    if (!clerkToken) {
      throw new Error('Authentication required. Please sign in to continue.');
    }

    const response = await fetch(`${API_URL}/sandboxes/${sandboxId}/download-archive`, {
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error downloading archive: ${response.statusText} (${response.status})`);
    }

    // Get the blob from response
    const blob = await response.blob();

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

  } catch (error) {
    handleApiError(error, { operation: 'download code', resource: 'project files' });
    throw error;
  }
};
