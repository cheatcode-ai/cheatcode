import React, { useRef, useEffect } from 'react';
import { Loader2, QrCode, RefreshCw, Smartphone, Monitor } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { ViewMode, DevServerStatus, ViewportDimensions } from '../types/app-preview';
import { AndroidMockup, IPhoneMockup } from 'react-device-mockup';

interface MobilePreviewTabProps {
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
  selectedPlatform: 'ios' | 'android';
  expoUrl?: string | null;
  onUrlSubmit: (e: React.FormEvent) => void;
  onIframeLoad: () => void;
  onIframeError: () => void;
  onRefresh: () => void;
  onOpenInNewTab: () => void;
  onCycleView: () => void;
  setIframeRef: (ref: HTMLIFrameElement | null) => void;
  onRefreshExpoUrl?: () => void;
}

export const MobilePreviewTab: React.FC<MobilePreviewTabProps> = ({
  previewUrl,
  isLoading,
  refreshKey,
  devServerStatus,
  selectedPlatform,
  expoUrl,
  onIframeLoad,
  onIframeError,
  setIframeRef,
  onRefreshExpoUrl
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (setIframeRef && iframeRef.current) {
      setIframeRef(iframeRef.current);
    }
  }, [setIframeRef]);

  const renderMockupContent = () => {
    // Prioritize showing preview if URL is available, even if status is 'starting'
    if (previewUrl) {
      return (
        <iframe
          ref={iframeRef}
          key={`mobile-${selectedPlatform}-${refreshKey}`}
          src={previewUrl}
          className="w-full h-full border-0 bg-white"
          onLoad={onIframeLoad}
          onError={onIframeError}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      );
    }

    // Only show loading if we don't have a preview URL yet
    if (isLoading || devServerStatus === 'starting' || devServerStatus === 'stopped') {
      return (
        <div className="w-full h-full min-h-[600px] flex items-center justify-center bg-zinc-100 dark:bg-zinc-900">
          <div className="flex flex-col items-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <span className="text-sm text-zinc-600 dark:text-zinc-400 font-medium">
              {devServerStatus === 'starting' ? 'Starting Expo...' : 'Waiting for dev server...'}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="w-full h-full min-h-[600px] flex items-center justify-center bg-zinc-100 dark:bg-zinc-900">
        <span className="text-sm text-zinc-500">No preview available</span>
      </div>
    );
  };

  const platformName = selectedPlatform === 'ios' ? 'iOS' : 'Android';

  return (
    <div className="h-full overflow-y-auto flex flex-col lg:flex-row bg-zinc-50 dark:bg-background">
      {/* Phone Preview Area */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-12 relative">
        
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-grid-zinc-200/50 dark:bg-grid-zinc-800/20 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)] pointer-events-none" />
        
        <div className="relative z-10 transform transition-transform duration-500 hover:scale-[1.02]">
          {selectedPlatform === 'ios' ? (
            <IPhoneMockup screenWidth={300} screenType="island">
              {renderMockupContent()}
            </IPhoneMockup>
          ) : (
            <AndroidMockup screenWidth={300}>
              {renderMockupContent()}
            </AndroidMockup>
          )}
        </div>
      </div>

      {/* Side Panel */}
      <div className="lg:w-96 border-t lg:border-t-0 lg:border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 overflow-y-auto">
        <div className="space-y-8">
          
          {/* Header */}
          <div>
            <h3 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Test on {platformName}
            </h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              Scan the QR code to preview on your device
            </p>
          </div>

          {/* QR Code Section */}
          <div className="flex flex-col items-center gap-6 py-2">
            <div className="p-4 bg-white rounded-2xl shadow-sm border border-zinc-100 dark:border-zinc-800">
              {expoUrl ? (
                <QRCodeSVG
                  value={expoUrl}
                  size={180}
                  level="M"
                  includeMargin={false}
                />
              ) : (
                 <div className="w-[180px] h-[180px] flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 rounded-lg">
                   {devServerStatus === 'starting' || devServerStatus === 'stopped' ? (
                     <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                   ) : (
                     <QrCode className="h-12 w-12 text-zinc-300 dark:text-zinc-700" />
                   )}
                 </div>
              )}
            </div>

            {onRefreshExpoUrl && (
              <button
                onClick={onRefreshExpoUrl}
                className="flex items-center gap-2 text-xs font-medium text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Refresh QR Code
              </button>
            )}
          </div>

          {/* Instructions */}
          <div className="space-y-8">
            <div className="space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <Smartphone className="h-3.5 w-3.5" />
                How to preview
              </h4>
              <ol className="relative border-l border-zinc-200 dark:border-zinc-800 ml-3 space-y-8">
                <li className="ml-6">
                  <span className="absolute flex items-center justify-center w-6 h-6 bg-zinc-100 dark:bg-zinc-900 rounded-full -left-3 ring-4 ring-white dark:ring-zinc-950 border border-zinc-200 dark:border-zinc-800">
                    <span className="text-[10px] font-mono font-medium text-zinc-500 dark:text-zinc-400">1</span>
                  </span>
                  <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-200">Install Expo Go</h5>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                    Download from the {selectedPlatform === 'ios' ? 'App Store' : 'Google Play Store'}.
                  </p>
                </li>
                <li className="ml-6">
                  <span className="absolute flex items-center justify-center w-6 h-6 bg-zinc-100 dark:bg-zinc-900 rounded-full -left-3 ring-4 ring-white dark:ring-zinc-950 border border-zinc-200 dark:border-zinc-800">
                    <span className="text-[10px] font-mono font-medium text-zinc-500 dark:text-zinc-400">2</span>
                  </span>
                  <h5 className="font-medium text-sm text-zinc-900 dark:text-zinc-200">Scan Code</h5>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed">
                    Use your camera or the Expo Go app to scan the QR code above.
                  </p>
                </li>
              </ol>
            </div>

            {expoUrl && (
               <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 p-3">
                 <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1 font-medium">Expo URL</p>
                 <code className="block text-xs font-mono text-zinc-600 dark:text-zinc-400 break-all select-all">
                   {expoUrl}
                 </code>
               </div>
            )}
            
            <div className="flex gap-3 items-start text-zinc-500 dark:text-zinc-400 px-1 pt-2">
              <Monitor className="h-4 w-4 mt-0.5 flex-shrink-0 text-zinc-400" />
              <p className="text-xs leading-relaxed">
                Preview may differ from native device. For accurate results, test on a real device.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};