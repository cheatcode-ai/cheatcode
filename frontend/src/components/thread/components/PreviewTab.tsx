import React, { useRef, useEffect } from 'react';
import { Loader2, Monitor, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ViewMode, DevServerStatus, ViewportDimensions } from '../types/app-preview';
import { MobilePreviewTab } from './MobilePreviewTab';

interface PreviewTabProps {
  previewUrl: string | null;
  currentUrl: string;
  urlInput: string;
  setUrlInput: (value: string) => void;
  isLoading: boolean;
  hasError: boolean;
  refreshKey: number;
  currentView: ViewMode;
  viewportDimensions: ViewportDimensions;
  devServerStatus: DevServerStatus;
  agentStatus: string;
  appType?: string;
  selectedPlatform?: 'ios' | 'android';
  onUrlSubmit: (e: React.FormEvent) => void;
  onIframeLoad: () => void;
  onIframeError: () => void;
  onRefresh: () => void;
  onOpenInNewTab: () => void;
  onCycleView: () => void;
  setIframeRef?: (ref: HTMLIFrameElement | null) => void;
}

export const PreviewTab: React.FC<PreviewTabProps> = ({
  previewUrl,
  currentUrl,
  urlInput,
  setUrlInput,
  isLoading,
  hasError,
  refreshKey,
  currentView,
  viewportDimensions,
  devServerStatus,
  agentStatus,
  appType,
  selectedPlatform = 'ios',
  onUrlSubmit,
  onIframeLoad,
  onIframeError,
  onRefresh,
  onOpenInNewTab,
  onCycleView,
  setIframeRef
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Register iframe ref with parent
  useEffect(() => {
    if (setIframeRef && iframeRef.current) {
      setIframeRef(iframeRef.current);
    }
  }, [setIframeRef]);

  // For mobile apps, use the specialized mobile preview layout
  if (appType === 'mobile') {
    return (
      <MobilePreviewTab
        previewUrl={previewUrl}
        currentUrl={currentUrl}
        urlInput={urlInput}
        setUrlInput={setUrlInput}
        isLoading={isLoading}
        hasError={hasError}
        refreshKey={refreshKey}
        currentView={currentView}
        viewportDimensions={viewportDimensions}
        devServerStatus={devServerStatus}
        agentStatus={agentStatus}
        selectedPlatform={selectedPlatform}
        onUrlSubmit={onUrlSubmit}
        onIframeLoad={onIframeLoad}
        onIframeError={onIframeError}
        onRefresh={onRefresh}
        onOpenInNewTab={onOpenInNewTab}
        onCycleView={onCycleView}
        setIframeRef={setIframeRef}
      />
    );
  }

  return (
    <div className={cn(
      "h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent p-2",
      currentView !== 'desktop' && "flex items-center justify-center"
    )}>
      <div className={cn(
        "relative bg-white dark:bg-zinc-900 rounded-lg border shadow-lg overflow-hidden",
        currentView === 'desktop' ? "w-full h-full" : "flex-shrink-0"
      )} style={currentView !== 'desktop' ? viewportDimensions : undefined}>
        {(isLoading || devServerStatus === 'starting') && (
          <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-zinc-900 z-10">
            <div className="flex flex-col items-center space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
              <span className="text-sm text-zinc-500">
                {devServerStatus === 'starting' ? 'Starting development server...' : 'Loading preview...'}
              </span>
            </div>
          </div>
        )}

        {devServerStatus === 'running' && previewUrl && (
          <iframe
            ref={iframeRef}
            key={`${currentView}-${refreshKey}`}
            src={previewUrl}
            className="w-full h-full border-0"
            onLoad={onIframeLoad}
            onError={onIframeError}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        )}
      </div>
    </div>
  );
}; 