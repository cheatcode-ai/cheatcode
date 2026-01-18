'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { X, Monitor, Tablet, Smartphone, RefreshCw, ExternalLink, Loader2, Download } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@clerk/nextjs';
import { downloadSandboxCode } from '@/lib/api';
import { toast } from 'sonner';
import { useModal } from '@/hooks/use-modal-store';

// Centralized thread color system
import { threadStyles } from '@/lib/theme/thread-colors';

// Import types
import { AppPreviewSidePanelProps, MainTab } from './types/app-preview';

// Import hooks
import { useDevServer } from './hooks/use-dev-server';
import { useFileExplorer } from './hooks/use-file-explorer';
import { usePreviewUrl } from './hooks/use-preview-url';
import { useBilling } from '@/contexts/BillingContext';

// Import components
import { LoadingScreen } from './components/LoadingScreen';
import { PreviewTab } from './components/PreviewTab';
import { CodeTab } from './components/CodeTab';

export function AppPreviewSidePanel({
  isOpen,
  onClose,
  project,
  agentStatus
}: AppPreviewSidePanelProps) {
  const [activeMainTab, setActiveMainTab] = useState<MainTab>('preview');
  const [isDownloading, setIsDownloading] = useState(false);
  const [selectedPlatform, setSelectedPlatform] = useState<'ios' | 'android'>('ios');
  const isMobile = useIsMobile();
  const { getToken } = useAuth();

  // Custom hooks
  const previewUrl = usePreviewUrl({
    sandboxId: project?.sandbox?.id
  });

  const devServer = useDevServer({
    sandboxId: project?.sandbox?.id,
    appType: project?.app_type || 'web',
    previewUrl: previewUrl.previewUrl,
    autoStart: true, // Dev server will auto-start when sandbox is available
    onPreviewUrlRetry: previewUrl.retryPreviewUrl // Coordinate preview URL retries with dev server status
  });

  const fileExplorer = useFileExplorer({
    sandboxId: project?.sandbox?.id,
    isCodeTabActive: activeMainTab === 'code',
    appType: project?.app_type || 'web'
  });

  const { planName, billingStatus } = useBilling();
  const isFreePlan = (planName || '').toLowerCase() === 'free' || billingStatus?.plan_id === 'free';
  const { onOpen } = useModal();


  // Show loading screen when agent is actively building OR no preview URL available
  // But prioritize showing preview if URL exists and agent isn't actively modifying code
  const shouldShowLoadingScreen = (
    !previewUrl.previewUrl || 
    agentStatus === 'running' || 
    agentStatus === 'connecting'
  ) && (activeMainTab === 'preview' || !previewUrl.previewUrl);

  // Switch to preview tab when loading starts if user is on code tab
  useEffect(() => {
    if (shouldShowLoadingScreen && activeMainTab === 'code') {
      setActiveMainTab('preview');
    }
  }, [shouldShowLoadingScreen, activeMainTab]);

  // Handle close with keyboard shortcut
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Handle code download
  const handleDownloadCode = useCallback(async () => {
    // If user is on free plan, show payment dialog
    if (isFreePlan) {
      onOpen('paymentRequiredDialog');
      return;
    }

    if (!project?.sandbox?.id) {
      toast.error('No sandbox available for download');
      return;
    }

    setIsDownloading(true);
    try {
      const token = await getToken();
      await downloadSandboxCode(
        project.sandbox.id,
        project.name || 'project',
        token ?? undefined,
        project.app_type || 'web'
      );
      toast.success('Code downloaded successfully!');
    } catch (err) {
      toast.error('Failed to download code. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  }, [project?.sandbox?.id, project?.name, project?.app_type, getToken, isFreePlan, onOpen]);

  // Keyboard shortcut for closing
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'i') {
        event.preventDefault();
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Helper functions for preview controls
  const getCurrentViewIcon = () => {
    switch (previewUrl.currentView) {
      case 'tablet': return <Tablet className="h-3.5 w-3.5" />;
      case 'mobile': return <Smartphone className="h-3.5 w-3.5" />;
      default: return <Monitor className="h-3.5 w-3.5" />;
    }
  };

  if (!isOpen) {
    return null;
  }

  // Disable code tab during loading
  const isCodeTabDisabled = shouldShowLoadingScreen;

  const renderContent = () => {
    return (
      <Tabs value={activeMainTab} onValueChange={(v) => setActiveMainTab(v as MainTab)} className="flex flex-col h-full">
        {/* Tab Header with Controls - Polarity/Frontier Style */}
        <div className={cn("pl-2 pr-4 h-9 flex items-center justify-between sticky top-0 z-20", threadStyles.header)}>
          <div className="flex items-center h-full">
            <TabsList className="h-full bg-transparent p-0 rounded-none border-none flex gap-0">
              <TabsTrigger
                value="preview"
                className={cn(
                  "h-full rounded-none !bg-transparent px-4 text-[10px] font-bold tracking-[0.2em] transition-all duration-200 border-none uppercase font-mono shadow-none",
                  "data-[state=active]:text-thread-text-primary text-thread-text-tertiary hover:text-thread-text-secondary"
                )}
              >
                Preview
              </TabsTrigger>
              <TabsTrigger
                value="code"
                disabled={isCodeTabDisabled}
                className={cn(
                  "h-full rounded-none !bg-transparent px-4 text-[10px] font-bold tracking-[0.2em] transition-all duration-200 border-none disabled:opacity-30 disabled:cursor-not-allowed uppercase font-mono shadow-none",
                  "data-[state=active]:text-thread-text-primary text-thread-text-tertiary hover:text-thread-text-secondary"
                )}
              >
                Code
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex items-center gap-4 flex-1 justify-end">
            {/* Preview Controls - only show when preview tab is active */}
            {activeMainTab === 'preview' && (
              <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-2 duration-300">
                {agentStatus === 'running' && (
                  <div className="hidden md:flex items-center gap-2 text-[9px] font-mono text-thread-text-tertiary uppercase tracking-widest mr-2">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    <span>Processing</span>
                  </div>
                )}

                {/* Web-specific controls: viewport toggle and URL navigation */}
                {project?.app_type !== 'mobile' && (
                  <>
                    <div className="relative group hidden md:block">
                      <Input
                        type="text"
                        placeholder="https://..."
                        value={previewUrl.urlInput}
                        onChange={(e) => previewUrl.setUrlInput(e.target.value)}
                        className={cn(
                          "h-7 w-[220px] text-[11px] px-3 transition-all rounded-md font-mono shadow-none focus-visible:ring-0",
                          threadStyles.input
                        )}
                        onKeyDown={(e) => e.key === 'Enter' && previewUrl.handleUrlSubmit(e as any)}
                      />
                    </div>

                    <div className="flex items-center gap-1">
                      <TooltipProvider delayDuration={0}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={previewUrl.cycleView}
                              className={cn("h-7 w-7 flex items-center justify-center rounded-md transition-all", threadStyles.buttonGhost)}
                            >
                              {getCurrentViewIcon()}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className={cn("text-[10px] rounded-sm font-mono px-2 py-1", threadStyles.tooltip)}>VIEWPORT</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      <TooltipProvider delayDuration={0}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={previewUrl.handleRefresh}
                              className={cn("h-7 w-7 flex items-center justify-center rounded-md transition-all", threadStyles.buttonGhost)}
                            >
                              <RefreshCw className="h-3 w-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className={cn("text-[10px] rounded-sm font-mono px-2 py-1", threadStyles.tooltip)}>REFRESH</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      {previewUrl.previewUrl && (
                        <TooltipProvider delayDuration={0}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={previewUrl.openInNewTab}
                                className={cn("h-7 w-7 flex items-center justify-center rounded-md transition-all", threadStyles.buttonGhost)}
                              >
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className={cn("text-[10px] rounded-sm font-mono px-2 py-1", threadStyles.tooltip)}>OPEN IN NEW TAB</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </>
                )}

                {/* Mobile platform toggle */}
                {project?.app_type === 'mobile' && (
                  <div className="flex items-center gap-1 border border-thread-border rounded-md p-1 bg-thread-surface-subtle">
                    <button
                      onClick={() => setSelectedPlatform('ios')}
                      className={cn(
                        'px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-all rounded-[3px]',
                        selectedPlatform === 'ios'
                          ? 'bg-thread-text-primary text-thread-panel shadow-sm'
                          : 'text-thread-text-tertiary hover:text-thread-text-secondary'
                      )}
                    >
                      iOS
                    </button>
                    <button
                      onClick={() => setSelectedPlatform('android')}
                      className={cn(
                        'px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-all rounded-[3px]',
                        selectedPlatform === 'android'
                          ? 'bg-thread-text-primary text-thread-panel shadow-sm'
                          : 'text-thread-text-tertiary hover:text-thread-text-secondary'
                      )}
                    >
                      Android
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Code Controls */}
            {activeMainTab === 'code' && (
              <div className="animate-in fade-in slide-in-from-right-2 duration-300">
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleDownloadCode}
                        disabled={isDownloading || !project?.sandbox?.id}
                        className={cn(
                          "h-7 w-7 flex items-center justify-center rounded-md transition-all",
                          threadStyles.buttonGhost,
                          (isDownloading || !project?.sandbox?.id) && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className={cn("text-[10px] rounded-sm font-mono px-2 py-1", threadStyles.tooltip)}>DOWNLOAD CODE</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            {/* Close button - always visible */}
            <div className="pl-1">
              <button
                onClick={handleClose}
                className={cn("h-7 w-7 flex items-center justify-center rounded-md transition-all", threadStyles.buttonGhost)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden bg-[var(--background)]">
          <TabsContent value="preview" className="h-full mt-0">
            {shouldShowLoadingScreen ? (
              <LoadingScreen
                agentStatus={agentStatus}
                onClose={handleClose}
              />
            ) : (
              <PreviewTab
                previewUrl={previewUrl.previewUrl}
                currentUrl={previewUrl.currentUrl}
                urlInput={previewUrl.urlInput}
                setUrlInput={previewUrl.setUrlInput}
                isLoading={previewUrl.isLoading}
                hasError={previewUrl.hasError}
                refreshKey={previewUrl.refreshKey}
                currentView={previewUrl.currentView}
                viewportDimensions={previewUrl.viewportDimensions}
                devServerStatus={devServer.status}
                agentStatus={agentStatus}
                appType={project?.app_type}
                selectedPlatform={selectedPlatform}
                expoUrl={devServer.expoUrl}
                onUrlSubmit={previewUrl.handleUrlSubmit}
                onIframeLoad={previewUrl.handleIframeLoad}
                onIframeError={previewUrl.handleIframeError}
                onRefresh={previewUrl.handleRefresh}
                onOpenInNewTab={previewUrl.openInNewTab}
                onCycleView={previewUrl.cycleView}
                setIframeRef={previewUrl.setIframeRef}
                onRefreshExpoUrl={devServer.fetchExpoUrl}
              />
            )}
          </TabsContent>

          <TabsContent value="code" className="h-full mt-0">
            <CodeTab
              files={fileExplorer.processedFiles}
              selectedFile={fileExplorer.selectedFile}
              content={fileExplorer.displayContent}
              isLoadingFiles={fileExplorer.isLoadingFiles}
              isLoadingContent={fileExplorer.isLoadingContent}
              filesError={fileExplorer.filesError}
              contentError={fileExplorer.contentError}
              onFileSelect={fileExplorer.handleFileSelect}
              onDirectoryToggle={fileExplorer.handleDirectoryToggle}
              expandedDirectories={fileExplorer.expandedDirectories}
              loadingDirectories={fileExplorer.loadingDirectories}
              appType={project?.app_type}
            />
          </TabsContent>
        </div>
      </Tabs>
    );
  };

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          key="preview-panel"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{
            type: "spring",
            stiffness: 400,
            damping: 40
          }}
          className={cn(
            'fixed top-14 right-0 bottom-0 flex flex-col z-30 shadow-none overflow-hidden',
            threadStyles.sidePanel,
            isMobile
              ? 'left-0 right-0 bottom-14'
              : 'w-[65vw]',
          )}
        >
            {renderContent()}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
