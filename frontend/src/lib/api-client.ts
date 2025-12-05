import { createClient } from '@/lib/supabase/client';
import { handleApiError, handleNetworkError, ErrorContext, ApiError } from './error-handler';
import { API_URL } from './api/config';

export interface ApiClientOptions {
  showErrors?: boolean;
  errorContext?: ErrorContext;
  timeout?: number;
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: ApiError;
  success: boolean;
}

export const apiClient = {
  async request<T = any>(
    url: string,
    options: RequestInit & ApiClientOptions = {}
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
        ...fetchOptions.headers as Record<string, string>,
      };

      const response = await fetch(url, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorDetails: any = null;
        
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
        data = await response.text() as T;
      } else {
        data = await response.blob() as T;
      }

      return {
        data,
        success: true,
      };

    } catch (error: any) {
      let apiError: ApiError;
      
      if (error.name === 'AbortError') {
        // Create a new Error object for timeout to avoid read-only message property issues
        apiError = new Error('Request timeout') as ApiError;
        apiError.name = 'AbortError';
        apiError.code = 'TIMEOUT';
      } else {
        apiError = (error instanceof Error ? error : new Error(String(error))) as ApiError;
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

  get: async <T = any>(
    url: string,
    options: Omit<RequestInit & ApiClientOptions, 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'GET',
    });
  },

  post: async <T = any>(
    url: string,
    data?: any,
    options: Omit<RequestInit & ApiClientOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  put: async <T = any>(
    url: string,
    data?: any,
    options: Omit<RequestInit & ApiClientOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  patch: async <T = any>(
    url: string,
    data?: any,
    options: Omit<RequestInit & ApiClientOptions, 'method'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    });
  },

  delete: async <T = any>(
    url: string,
    options: Omit<RequestInit & ApiClientOptions, 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> => {
    return apiClient.request<T>(url, {
      ...options,
      method: 'DELETE',
    });
  },

  upload: async <T = any>(
    url: string,
    formData: FormData,
    options: Omit<RequestInit & ApiClientOptions, 'method' | 'body'> = {}
  ): Promise<ApiResponse<T>> => {
    const { headers, ...restOptions } = options;
    
    const uploadHeaders = { ...headers as Record<string, string> };
    delete uploadHeaders['Content-Type'];

    return apiClient.request<T>(url, {
      ...restOptions,
      method: 'POST',
      body: formData,
      headers: uploadHeaders,
    });
  },
};

export const supabaseClient = {
  async execute<T = any>(
    queryFn: () => Promise<{ data: T | null; error: any }>,
    errorContext?: ErrorContext
  ): Promise<ApiResponse<T>> {
    try {
      const { data, error } = await queryFn();

      if (error) {
        const apiError = new Error(error.message || 'Database error') as ApiError;
        apiError.code = error.code;
        apiError.details = error;

        handleApiError(apiError, errorContext);

        return {
          error: apiError,
          success: false,
        };
      }

      return {
        data: data as T,
        success: true,
      };
    } catch (error: any) {
      const apiError = (error instanceof Error ? error : new Error(String(error))) as ApiError;
      handleApiError(apiError, errorContext);

      return {
        error: apiError,
        success: false,
      };
    }
  },
};

export const backendApi = {
  get: <T = any>(endpoint: string, options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>) =>
    apiClient.get<T>(`${API_URL}${endpoint}`, options),

  post: <T = any>(endpoint: string, data?: any, options?: Omit<RequestInit & ApiClientOptions, 'method'>) =>
    apiClient.post<T>(`${API_URL}${endpoint}`, data, options),

  put: <T = any>(endpoint: string, data?: any, options?: Omit<RequestInit & ApiClientOptions, 'method'>) =>
    apiClient.put<T>(`${API_URL}${endpoint}`, data, options),

  patch: <T = any>(endpoint: string, data?: any, options?: Omit<RequestInit & ApiClientOptions, 'method'>) =>
    apiClient.patch<T>(`${API_URL}${endpoint}`, data, options),

  delete: <T = any>(endpoint: string, options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>) =>
    apiClient.delete<T>(`${API_URL}${endpoint}`, options),

  upload: <T = any>(endpoint: string, formData: FormData, options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>) =>
    apiClient.upload<T>(`${API_URL}${endpoint}`, formData, options),
};

// Clerk-aware backend API that automatically adds authentication tokens
export const createClerkBackendApi = (getToken: () => Promise<string | null>) => ({
  get: async <T = any>(endpoint: string, options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>) => {
    const token = await getToken();
    const headers = {
      ...options?.headers as Record<string, string>,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.get<T>(`${API_URL}${endpoint}`, { ...options, headers });
  },

  post: async <T = any>(endpoint: string, data?: any, options?: Omit<RequestInit & ApiClientOptions, 'method'>) => {
    const token = await getToken();
    const headers = {
      ...options?.headers as Record<string, string>,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.post<T>(`${API_URL}${endpoint}`, data, { ...options, headers });
  },

  put: async <T = any>(endpoint: string, data?: any, options?: Omit<RequestInit & ApiClientOptions, 'method'>) => {
    const token = await getToken();
    const headers = {
      ...options?.headers as Record<string, string>,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.put<T>(`${API_URL}${endpoint}`, data, { ...options, headers });
  },

  patch: async <T = any>(endpoint: string, data?: any, options?: Omit<RequestInit & ApiClientOptions, 'method'>) => {
    const token = await getToken();
    const headers = {
      ...options?.headers as Record<string, string>,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.patch<T>(`${API_URL}${endpoint}`, data, { ...options, headers });
  },

  delete: async <T = any>(endpoint: string, options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>) => {
    const token = await getToken();
    const headers = {
      ...options?.headers as Record<string, string>,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.delete<T>(`${API_URL}${endpoint}`, { ...options, headers });
  },

  upload: async <T = any>(endpoint: string, formData: FormData, options?: Omit<RequestInit & ApiClientOptions, 'method' | 'body'>) => {
    const token = await getToken();
    const headers = {
      ...options?.headers as Record<string, string>,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    return apiClient.upload<T>(`${API_URL}${endpoint}`, formData, { ...options, headers });
  },
}); 