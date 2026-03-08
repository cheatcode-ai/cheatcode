/**
 * Centralized cache, timeout, and retry configuration for React Query and API calls.
 */

/**
 * Cache duration constants for React Query staleTime and gcTime.
 */
export const CACHE_DURATIONS = {
  /** 5 minutes - for frequently changing data */
  SHORT: 5 * 60 * 1000,
  /** 10 minutes - default for most queries */
  MEDIUM: 10 * 60 * 1000,
  /** 15 minutes - for rarely changing data */
  LONG: 15 * 60 * 1000,
  /** 30 minutes - for very stable data */
  VERY_LONG: 30 * 60 * 1000,
} as const;

/**
 * API timeout constants in milliseconds.
 */
export const API_TIMEOUTS = {
  /** 10 seconds - for quick operations */
  SHORT: 10000,
  /** 50 seconds - default for most API calls */
  DEFAULT: 50000,
  /** 2 minutes - for long-running operations */
  LONG: 120000,
  /** 5 minutes - for very long operations (file uploads, etc.) */
  VERY_LONG: 300000,
} as const;

/**
 * Retry attempt constants for failed requests.
 */
export const RETRY_ATTEMPTS = {
  /** Default retry count */
  DEFAULT: 2,
  /** For network-related errors */
  NETWORK_ERROR: 5,
  /** For server errors (5xx) */
  SERVER_ERROR: 2,
  /** For rate limiting (429) */
  RATE_LIMIT: 1,
  /** No retries */
  NONE: 0,
} as const;

/**
 * Polling intervals for various use cases.
 */
export const POLLING_INTERVALS = {
  /** 1 second - for real-time updates */
  FAST: 1000,
  /** 5 seconds - for moderately frequent updates */
  MEDIUM: 5000,
  /** 30 seconds - for infrequent updates */
  SLOW: 30000,
} as const;
