'use client';

import { AlertTriangle, X, RefreshCw } from 'lucide-react';
import { useApiHealth } from '@/hooks/react-query/usage/use-health';
import { Button } from '@/components/ui/button';

interface ApiHealthBannerProps {
  onDismiss: () => void;
}

export function ApiHealthBanner({ onDismiss }: ApiHealthBannerProps) {
  const { refetch, isLoading } = useApiHealth();

  return (
    <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
          <p className="text-sm text-yellow-200">
            Some features may be unavailable. We&apos;re working on it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
            className="text-yellow-200 hover:text-yellow-100"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            Retry
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            className="text-yellow-200 hover:text-yellow-100"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
