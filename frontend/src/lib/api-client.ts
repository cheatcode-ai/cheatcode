import {
  handleApiError,
  handleNetworkError,
  type ErrorContext,
  type ApiError,
} from './error-handler';
import { API_URL } from './api/config';

interface ApiClientOptions {
  showErrors?: boolean;
  errorContext?: ErrorContext;
  timeout?: number;
}

interface ApiResponse<T = unknown> {
  data?: T;
  error?: ApiError;
  success: boolean;
}

const apiClient = {
  async request<T = unknown>(
    url: string,
    options: RequestInit & ApiClientOptions = {},
  ): Promise<ApiResponse<T>> {
    const {
      showErrors = true,
      errorContext,
      timeout = 50000,
      ...fetchOptions
    } = options;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(fetchOptions.headers as Record<string, string>),
      };

      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorDetails: unknown = null;

        try {
          const errorData = await response.json();
          errorDetails = errorData;
          if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch {
          // Keep the default HTTP error message
        }

        const error = new Error(errorMessage) as ApiError;
        error.status = response.status;
        error.response = response;
        error.details = errorDetails;

        if (showErrors) {
          handleApiError(error, errorContext);
        }

        return {
          error,
          success: false,
        };
      }

      let data: T;
      const contentType = response.headers.get('content-type');

      if (contentType?.includes('application/json')) {
        data = await response.json();
      } else if (contentType?.includes('text/')) {
        data = (await response.text()) as T;
      } else {
        data = (await response.blob()) as T;
      }

      return {
        data,
        success: true,
      };
    } catch (error: unknown) {
      let apiError: ApiError;

      if (error instanceof Error && error.name === 'AbortError') {
        // Create a new Error object for timeout to avoid read-only message property issues
        apiError = new Error('Request timeout') as ApiError;
        apiError.name = 'AbortError';
        apiError.code = 'TIMEOUT';
      } else {
        apiError = (
          error instanceof Error ? error : new Error(String(error))
        ) as ApiError;
      }

      if (showErrors) {
        handleNetworkError(apiError, errorContext);
      }

      return {
        error: apiError,
        success: false,
      };
    }
  },

  get: async <T = unknown>(
    url: string,
    options: Omit<RequestInit & ApiClientOptions, 'method' | 'body'> = {},
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'GET',
    });
  },

  post: async <T = unknown>(
    url: string,
    data?: unknown,
    options: Omit<RequestInit & ApiClientOptions, 'method'> = {},
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  put: async <T = unknown>(
    url: string,
    data?: unknown,
    options: Omit<RequestInit & ApiClientOptions, 'method'> = {},
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  patch: async <T = unknown>(
    url: string,
    data?: unknown,
    options: Omit<RequestInit & ApiClientOptions, 'method'> = {},
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  delete: async <T = unknown>(
    url: string,
    options: Omit<RequestInit & ApiClientOptions, 'method' | 'body'> = {},
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'DELETE',
    });
  },

  upload: async <T = unknown>(
    url: string,
    formData: FormData,
    options: Omit<RequestInit & ApiClientOptions, 'method' | 'body'> = {},
  ): Promise<ApiResponse<T>> => {
    const { headers, ...restOptions } = options;

    const uploadHeaders = { ...(headers as Record<string, string>) };
    delete uploadHeaders['Content-Type'];

    return apiClient.request<T>(url, {
      ...restOptions,
      method: 'POST',
      body: formData,
      headers: uploadHeaders,
    });
  },
};

// Clerk-aware backend API that automatically adds authentication tokens
export const createClerkBackendApi = (
  getToken: () => Promise<string | null>,
) => ({
  get: async <T = unknown>(
    endpoint: string,
    options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>,
  ) => {
    const token = await getToken();
    const headers = {
      ...(options?.headers as Record<string, string>),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.get<T>(`${API_URL}${endpoint}`, { ...options, headers });
  },

  post: async <T = unknown>(
    endpoint: string,
    data?: unknown,
    options?: Omit<RequestInit & ApiClientOptions, 'method'>,
  ) => {
    const token = await getToken();
    const headers = {
      ...(options?.headers as Record<string, string>),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.post<T>(`${API_URL}${endpoint}`, data, {
      ...options,
      headers,
    });
  },

  put: async <T = unknown>(
    endpoint: string,
    data?: unknown,
    options?: Omit<RequestInit & ApiClientOptions, 'method'>,
  ) => {
    const token = await getToken();
    const headers = {
      ...(options?.headers as Record<string, string>),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.put<T>(`${API_URL}${endpoint}`, data, {
      ...options,
      headers,
    });
  },

  patch: async <T = unknown>(
    endpoint: string,
    data?: unknown,
    options?: Omit<RequestInit & ApiClientOptions, 'method'>,
  ) => {
    const token = await getToken();
    const headers = {
      ...(options?.headers as Record<string, string>),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.patch<T>(`${API_URL}${endpoint}`, data, {
      ...options,
      headers,
    });
  },

  delete: async <T = unknown>(
    endpoint: string,
    options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>,
  ) => {
    const token = await getToken();
    const headers = {
      ...(options?.headers as Record<string, string>),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.delete<T>(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });
  },

  upload: async <T = unknown>(
    endpoint: string,
    formData: FormData,
    options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>,
  ) => {
    const token = await getToken();
    const headers = {
      ...(options?.headers as Record<string, string>),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.upload<T>(`${API_URL}${endpoint}`, formData, {
      ...options,
      headers,
    });
  },
});
