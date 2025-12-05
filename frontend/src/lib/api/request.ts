/**
 * Centralized API request utilities with authentication handling.
 */

import { API_URL } from './config';

export class AuthenticationError extends Error {
  constructor(message = 'Authentication required. Please sign in to continue.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ApiError extends Error {
  status: number;
  statusText: string;

  constructor(status: number, statusText: string, message?: string) {
    super(message || `HTTP ${status}: ${statusText}`);
    this.name = 'ApiError';
    this.status = status;
    this.statusText = statusText;
  }
}

/**
 * Make an authenticated fetch request to the API.
 * Automatically handles authentication and common error patterns.
 */
export async function authorizedFetch(
  endpoint: string,
  clerkToken: string | undefined,
  options?: RequestInit
): Promise<Response> {
  if (!clerkToken) {
    throw new AuthenticationError();
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${clerkToken}`,
      ...options?.headers,
    },
  });

  return response;
}

/**
 * Make an authenticated JSON fetch request to the API.
 * Automatically handles authentication, error parsing, and JSON conversion.
 */
export async function authorizedJsonFetch<T>(
  endpoint: string,
  clerkToken: string | undefined,
  options?: RequestInit
): Promise<T> {
  const response = await authorizedFetch(endpoint, clerkToken, options);

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'No error details available');
    let errorMessage: string;

    try {
      const errorData = JSON.parse(errorText);
      errorMessage = errorData.message || errorData.detail || errorText;
    } catch {
      errorMessage = errorText;
    }

    throw new ApiError(response.status, response.statusText, errorMessage);
  }

  return response.json();
}

/**
 * Make an authenticated POST request with JSON body.
 */
export async function authorizedPost<T>(
  endpoint: string,
  clerkToken: string | undefined,
  body: unknown
): Promise<T> {
  return authorizedJsonFetch<T>(endpoint, clerkToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Make an authenticated DELETE request.
 */
export async function authorizedDelete<T>(
  endpoint: string,
  clerkToken: string | undefined
): Promise<T> {
  return authorizedJsonFetch<T>(endpoint, clerkToken, {
    method: 'DELETE',
  });
}

/**
 * Make an authenticated PUT request with JSON body.
 */
export async function authorizedPut<T>(
  endpoint: string,
  clerkToken: string | undefined,
  body: unknown
): Promise<T> {
  return authorizedJsonFetch<T>(endpoint, clerkToken, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
