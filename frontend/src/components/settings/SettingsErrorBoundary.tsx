'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface SettingsErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

interface SettingsErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<ErrorFallbackProps>;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorFallbackProps {
  error: Error;
  retry: () => void;
}

/**
 * Error boundary specifically designed for settings pages
 * Provides graceful degradation and recovery options
 */
export class SettingsErrorBoundary extends React.Component<
  SettingsErrorBoundaryProps,
  SettingsErrorBoundaryState
> {
  constructor(props: SettingsErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<SettingsErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({
      error,
      errorInfo,
    });

    // Call optional error handler
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Log to monitoring service (if available)
    if (typeof window !== 'undefined' && (window as any).Sentry) {
      (window as any).Sentry.captureException(error, {
        contexts: {
          errorBoundary: {
            componentStack: errorInfo.componentStack,
          },
        },
        tags: {
          section: 'settings',
        },
      });
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return (
          <FallbackComponent 
            error={this.state.error!} 
            retry={this.handleRetry}
          />
        );
      }

      // Default error UI
      return <DefaultSettingsErrorFallback error={this.state.error!} retry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

/**
 * Default error fallback component for settings
 */
function DefaultSettingsErrorFallback({ 
  error, 
  retry 
}: ErrorFallbackProps) {
  const router = useRouter();

  const isNetworkError = error.message?.includes('fetch') || 
                         error.message?.includes('network') ||
                         error.message?.includes('Failed to');

  const isAuthError = error.message?.includes('auth') || 
                      error.message?.includes('token') ||
                      error.message?.includes('unauthorized');

  const handleGoHome = () => {
    router.push('/');
  };

  const handleRefreshPage = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  const handleReportBug = () => {
    const subject = encodeURIComponent('Settings Error Report');
    const body = encodeURIComponent(
      `Error occurred in settings page:\n\n` +
      `Error: ${error.message}\n` +
      `Stack: ${error.stack || 'Not available'}\n` +
      `URL: ${typeof window !== 'undefined' ? window.location.href : 'Unknown'}\n` +
      `User Agent: ${typeof window !== 'undefined' ? window.navigator.userAgent : 'Unknown'}\n` +
      `Timestamp: ${new Date().toISOString()}`
    );
    
    if (typeof window !== 'undefined') {
      window.open(`mailto:support@cheatcode.ai?subject=${subject}&body=${body}`);
    }
  };

  return (
    <div className="space-y-6 w-full">
      <Card className="border-red-200 dark:border-red-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
            Settings Error
          </CardTitle>
          <CardDescription>
            Something went wrong while loading this settings page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {isNetworkError ? (
                "Network connection error. Please check your internet connection and try again."
              ) : isAuthError ? (
                "Authentication error. Please sign in again to continue."
              ) : (
                `Error: ${error.message || 'An unexpected error occurred'}`
              )}
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button 
              onClick={retry} 
              variant="default"
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
            
            <Button 
              onClick={handleRefreshPage} 
              variant="outline"
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Page
            </Button>
            
            <Button 
              onClick={handleGoHome} 
              variant="secondary"
              className="flex items-center gap-2"
            >
              <Home className="h-4 w-4" />
              Go Home
            </Button>
          </div>

          <div className="pt-4 border-t">
            <details className="space-y-2">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Show error details
              </summary>
              <div className="p-3 bg-muted rounded-lg">
                <pre className="text-xs text-muted-foreground overflow-auto max-h-32">
                  {error.stack || error.message}
                </pre>
              </div>
              <Button 
                onClick={handleReportBug} 
                variant="ghost" 
                size="sm"
                className="flex items-center gap-2 text-muted-foreground"
              >
                <Bug className="h-3 w-3" />
                Report this bug
              </Button>
            </details>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Hook to wrap components with error boundary
 */
export function useSettingsErrorHandler() {
  return React.useCallback((_error: Error, _errorInfo: React.ErrorInfo) => {
    // Could dispatch to global error store here
    // or send to analytics
  }, []);
}

/**
 * HOC to wrap components with settings error boundary
 */
export function withSettingsErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  fallback?: React.ComponentType<ErrorFallbackProps>
) {
  return function WrappedComponent(props: P) {
    return (
      <SettingsErrorBoundary fallback={fallback}>
        <Component {...props} />
      </SettingsErrorBoundary>
    );
  };
}

export default SettingsErrorBoundary;