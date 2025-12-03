import React, { useRef, useEffect } from 'react';
import { Loader2, QrCode, RefreshCw, Smartphone } from 'lucide-react';
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
        <div style={{ width: '100%', height: '100%', minHeight: '600px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' }}>
          <div className="flex flex-col items-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            <span className="text-sm text-gray-600 font-medium">
              {devServerStatus === 'starting' ? 'Starting Expo...' : 'Waiting for dev server...'}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div style={{ width: '100%', height: '100%', minHeight: '600px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' }}>
        <span className="text-sm text-gray-500">No preview available</span>
      </div>
    );
  };

  const platformName = selectedPlatform === 'ios' ? 'iOS' : 'Android';

  return (
    <div className="h-full overflow-auto scrollbar-thin scrollbar-thumb-zinc-300 dark:scrollbar-thumb-zinc-700 scrollbar-track-transparent p-6">
      <div className="flex flex-col lg:flex-row gap-8 min-h-full">
        <div className="flex-1 flex justify-center items-start">
          <div className="flex flex-col items-center space-y-4">
            {selectedPlatform === 'ios' ? (
              <IPhoneMockup screenWidth={350} screenType="island">
                {renderMockupContent()}
              </IPhoneMockup>
            ) : (
              <AndroidMockup screenWidth={350}>
                {renderMockupContent()}
              </AndroidMockup>
            )}
          </div>
        </div>

        <div className="lg:w-80 flex flex-col space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Test on {platformName}
            </h3>
            
            <div className="aspect-square bg-white dark:bg-gray-100 rounded-lg flex items-center justify-center mb-4 p-4">
              {expoUrl ? (
                <div className="flex flex-col items-center">
                  <QRCodeSVG
                    value={expoUrl}
                    size={180}
                    level="M"
                    includeMargin={true}
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                  {onRefreshExpoUrl && (
                    <button
                      onClick={onRefreshExpoUrl}
                      className="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Refresh QR
                    </button>
                  )}
                </div>
              ) : devServerStatus === 'starting' || devServerStatus === 'stopped' ? (
                <div className="text-center">
                  <Loader2 className="h-10 w-10 animate-spin text-blue-500 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-600">
                    {devServerStatus === 'starting' ? 'Starting Expo tunnel...' : 'Waiting for dev server...'}
                  </p>
                </div>
              ) : (
                <div className="text-center">
                  <QrCode className="h-16 w-16 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 dark:text-gray-600">
                    QR code not available
                  </p>
                  {onRefreshExpoUrl && (
                    <button
                      onClick={onRefreshExpoUrl}
                      className="mt-2 flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Try again
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <h4 className="font-medium text-gray-900 dark:text-white">Scan QR code with Expo Go</h4>
              <div className="space-y-2">
                <p>To test on your {platformName} device:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Install <strong>Expo Go</strong> from {selectedPlatform === 'ios' ? 'App Store' : 'Play Store'}</li>
                  <li>Open {selectedPlatform === 'ios' ? 'Camera app or Expo Go' : 'Expo Go app'}</li>
                  <li>Scan the QR code above</li>
                  <li>Your app will load in Expo Go</li>
                </ol>
              </div>

              {expoUrl && (
                <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs break-all">
                  <span className="text-gray-500">URL: </span>
                  <span className="font-mono">{expoUrl}</span>
                </div>
              )}

              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <strong>Note:</strong> Browser preview lacks native functions & looks different.
                  Test on device with Expo Go for the best results.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};