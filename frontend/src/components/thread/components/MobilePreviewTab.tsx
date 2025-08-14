import React, { useRef, useEffect } from 'react';
import { Loader2, QrCode } from 'lucide-react';
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
  onUrlSubmit: (e: React.FormEvent) => void;
  onIframeLoad: () => void;
  onIframeError: () => void;
  onRefresh: () => void;
  onOpenInNewTab: () => void;
  onCycleView: () => void;
  setIframeRef: (ref: HTMLIFrameElement | null) => void;
}

export const MobilePreviewTab: React.FC<MobilePreviewTabProps> = ({
  previewUrl,
  isLoading,
  refreshKey,
  devServerStatus,
  selectedPlatform,
  onIframeLoad,
  onIframeError,
  setIframeRef
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (setIframeRef && iframeRef.current) {
      setIframeRef(iframeRef.current);
    }
  }, [setIframeRef]);

  const renderMockupContent = () => {
    if (isLoading || devServerStatus === 'starting') {
      return (
        <div className="flex items-center justify-center h-full bg-gray-50">
          <div className="flex flex-col items-center space-y-2">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            <span className="text-sm text-gray-500">
              {devServerStatus === 'starting' ? 'Starting development server...' : 'Loading preview...'}
            </span>
          </div>
        </div>
      );
    }

    if (devServerStatus === 'running' && previewUrl) {
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

    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
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
            
            <div className="aspect-square bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center mb-4">
              <div className="text-center">
                <QrCode className="h-16 w-16 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {platformName} QR code will appear here
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <h4 className="font-medium text-gray-900 dark:text-white">Scan QR code to test</h4>
              <div className="space-y-2">
                <p>To test on your {platformName} device:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Open Camera app</li>
                  <li>Scan the QR code above</li>
                  <li>Follow the link to test your app</li>
                </ol>
              </div>
              
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <strong>Note:</strong> Browser preview lacks native functions & looks different. 
                  Test on device for the best results.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};