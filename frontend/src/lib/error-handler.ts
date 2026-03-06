import { toast } from 'sonner';
import { BillingError } from './api';

export interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
  response?: Response;
}

export interface ErrorContext {
  operation?: string;
  resource?: string;
  silent?: boolean;
}

const getStatusMessage = (status: number): string => {
  switch (status) {
    case 400:
      return 'Invalid request. Please check your input and try again.';
    case 401:
      return 'Authentication required. Please sign in again.';
    case 403:
      return "Access denied. You don't have permission to perform this action.";
    case 404:
      return 'The requested resource was not found.';
    case 408:
      return 'Request timeout. Please try again.';
    case 409:
      return 'Conflict detected. The resource may have been modified by another user.';
    case 422:
      return 'Invalid data provided. Please check your input.';
    case 429:
      return 'Too many requests. Please wait a moment and try again.';
    case 500:
      return 'Server error. Our team has been notified.';
    case 502:
      return 'Service temporarily unavailable. Please try again in a moment.';
    case 503:
      return 'Service maintenance in progress. Please try again later.';
    case 504:
      return 'Request timeout. The server took too long to respond.';
    default:
      return 'An unexpected error occurred. Please try again.';
  }
};

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof BillingError) {
    return error.detail?.message || error.message || 'Billing issue detected';
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  const err = error as Record<string, unknown> | null | undefined;

  if (
    err?.response &&
    typeof (err.response as Record<string, unknown>)?.status === 'number'
  ) {
    return getStatusMessage(
      (err.response as Record<string, unknown>).status as number,
    );
  }

  if (typeof err?.status === 'number') {
    return getStatusMessage(err.status);
  }

  if (typeof err?.message === 'string') {
    return err.message;
  }

  if (err?.error) {
    return typeof err.error === 'string'
      ? err.error
      : ((err.error as Record<string, unknown>)?.message as string) ||
          'Unknown error';
  }

  return 'An unexpected error occurred';
};

const shouldShowError = (error: unknown, context?: ErrorContext): boolean => {
  if (context?.silent) {
    return false;
  }
  if (error instanceof BillingError) {
    return false;
  }

  const err = error as Record<string, unknown> | null | undefined;
  if (err?.status === 404 && context?.resource) {
    return false;
  }

  return true;
};

const formatErrorMessage = (
  message: string,
  context?: ErrorContext,
): string => {
  if (!context?.operation && !context?.resource) {
    return message;
  }

  const parts = [];

  if (context.operation) {
    parts.push(`Failed to ${context.operation}`);
  }

  if (context.resource) {
    parts.push(context.resource);
  }

  const prefix = parts.join(' ');

  if (message.toLowerCase().includes(context.operation?.toLowerCase() || '')) {
    return message;
  }

  return `${prefix}: ${message}`;
};

export const handleApiError = (
  error: unknown,
  context?: ErrorContext,
): void => {
  if (!shouldShowError(error, context)) {
    return;
  }

  // Skip toast notifications on server-side (e.g., in server actions)
  if (typeof window === 'undefined') {
    return;
  }

  // Special-case: route billing errors to modal instead of toast when possible
  if (typeof window !== 'undefined') {
    try {
      // Use dynamic import with promise to avoid async requirement
      const msg = extractErrorMessage(error).toLowerCase();
      if (
        msg.includes('payment required') ||
        msg.includes('upgrade required') ||
        msg.includes('insufficient credits')
      ) {
        import('@/hooks/use-modal-store')
          .then(({ useModal }) => {
            const { onOpen } = useModal.getState();
            onOpen('paymentRequiredDialog');
          })
          .catch(() => {
            // Fallback to regular toast if dynamic import fails
            const message = extractErrorMessage(error);
            toast.error(message, { duration: 5000 });
          });
        return; // Return early to prevent showing regular toast
      }
    } catch {}
  }

  const rawMessage = extractErrorMessage(error);
  const formattedMessage = formatErrorMessage(rawMessage, context);
  const errStatus = (error as Record<string, unknown> | null | undefined)
    ?.status as number | undefined;

  if (errStatus && errStatus >= 500) {
    toast.error(formattedMessage, {
      description: 'Our team has been notified and is working on a fix.',
      duration: 6000,
    });
  } else if (errStatus === 401) {
    toast.error(formattedMessage, {
      description: 'Please refresh the page and sign in again.',
      duration: 8000,
    });
  } else if (errStatus === 403) {
    toast.error(formattedMessage, {
      description: 'Contact support if you believe this is an error.',
      duration: 6000,
    });
  } else if (errStatus === 429) {
    toast.warning(formattedMessage, {
      description: 'Please wait a moment before trying again.',
      duration: 5000,
    });
  } else {
    toast.error(formattedMessage, {
      duration: 5000,
    });
  }
};

export const handleNetworkError = (
  error: unknown,
  context?: ErrorContext,
): void => {
  const errObj = error as Record<string, unknown> | null | undefined;
  const errMessage = typeof errObj?.message === 'string' ? errObj.message : '';
  const isNetworkError =
    errMessage.includes('fetch') ||
    errMessage.includes('network') ||
    errMessage.includes('connection') ||
    errObj?.code === 'NETWORK_ERROR' ||
    !navigator.onLine;

  if (isNetworkError) {
    toast.error('Connection error', {
      description: 'Please check your internet connection and try again.',
      duration: 6000,
    });
  } else {
    handleApiError(error, context);
  }
};

export const handleApiSuccess = (
  message: string,
  description?: string,
): void => {
  toast.success(message, {
    description,
    duration: 3000,
  });
};
