'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Eye, Code, X, Monitor, Tablet, Smartphone, RefreshCw, ExternalLink, Loader2, Download } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@clerk/nextjs';
import { downloadSandboxCode } from '@/lib/api';
import { toast } from 'sonner';
import { useModal } from '@/hooks/use-modal-store';

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
  // Removed unused agentName prop - custom agents no longer supported
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
    isPreviewTabActive: activeMainTab === 'preview',
    appType: project?.app_type || 'web',
    previewUrl: previewUrl.previewUrl
  });

  const fileExplorer = useFileExplorer({
    projectId: project?.project_id, // Primary: Use Git-based file access
    sandboxId: project?.sandbox?.id, // Fallback: Use sandbox-based file access
    isCodeTabActive: activeMainTab === 'code',
    appType: project?.app_type || 'web'
  });

  const { planName, billingStatus } = useBilling();
  const isFreePlan = (planName || '').toLowerCase() === 'free' || billingStatus?.plan_id === 'free';
  const { onOpen } = useModal();

  // Debug logging for mobile projects
  useEffect(() => {
    if (project?.app_type === 'mobile') {
      console.log('[MOBILE DEBUG] Preview state:', {
        appType: project?.app_type,
        previewUrl: previewUrl.previewUrl,
        devServerStatus: devServer.status,
        agentStatus,
        activeTab: activeMainTab
      });
    }
  }, [project?.app_type, previewUrl.previewUrl, devServer.status, agentStatus, activeMainTab]);

  // Show loading screen when agent is building, no preview URL yet, or dev server not running
  const shouldShowLoadingScreen = (
    !previewUrl.previewUrl || 
    agentStatus === 'running' || 
    agentStatus === 'connecting' ||
    devServer.status !== 'running'
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
        token,
        project.app_type || 'web'
      );
      toast.success('Code downloaded successfully!');
    } catch (error) {
      console.error('Failed to download code:', error);
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
        {/* Tab Header with Controls */}
        <motion.div className="p-2">
          <div className="flex items-center justify-between gap-2">
            {/* Left side - Tabs */}
            <div className="flex items-center gap-2">
              <TabsList className="h-8 bg-zinc-100/70 dark:bg-zinc-800/70 rounded-lg">
                <TabsTrigger value="preview" className="rounded-md data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:text-primary px-3 text-xs">
                  <Eye className={cn("h-3.5 w-3.5 mr-1", activeMainTab === 'preview' ? 'text-yellow-400' : 'text-zinc-400')} />
                  Preview
                </TabsTrigger>
                <TabsTrigger 
                  value="code" 
                  disabled={isCodeTabDisabled}
                  className="rounded-md data-[state=active]:bg-white dark:data-[state=active]:bg-zinc-900 data-[state=active]:text-primary px-3 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Code className={cn("h-3.5 w-3.5 mr-1", activeMainTab === 'code' ? 'text-red-400' : 'text-zinc-400')} />
                  Code
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Right side - Controls */}
            <div className="flex items-center gap-2">
              {/* Preview Controls - only show when preview tab is active */}
              {activeMainTab === 'preview' && (
                <>
                  {agentStatus === 'running' && (
                    <div className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Building</span>
                    </div>
                  )}

                  {/* Web-specific controls: viewport toggle and URL navigation */}
                  {project?.app_type !== 'mobile' && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={previewUrl.cycleView}
                        className="p-1.5 h-8 w-8"
                        title={`Switch to ${previewUrl.currentView === 'desktop' ? 'tablet' : previewUrl.currentView === 'tablet' ? 'mobile' : 'desktop'} view`}
                      >
                        {getCurrentViewIcon()}
                      </Button>

                      <form onSubmit={previewUrl.handleUrlSubmit} className="max-w-32">
                        <Input
                          type="text"
                          value={previewUrl.urlInput}
                          onChange={(e) => previewUrl.setUrlInput(e.target.value)}
                          placeholder="/path"
                          className="h-8 text-xs"
                        />
                      </form>
                    </>
                  )}

                  {/* Mobile platform toggle - only show for mobile projects */}
                  {project?.app_type === 'mobile' && (
                    <div
                      className="relative inline-flex h-8 items-center rounded-full p-0.5 bg-zinc-800/70 ring-1 ring-white/10 backdrop-blur-md shadow-inner overflow-hidden"
                      role="tablist"
                      aria-label="Select mobile platform"
                    >
                      {/* No sliding indicator */}

                      {/* iOS btn */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPlatform('ios')}
                        role="tab"
                        aria-selected={selectedPlatform === 'ios'}
                        className={cn(
                          'relative z-10 h-7 px-3 text-xs rounded-full transition-colors flex items-center',
                          selectedPlatform === 'ios'
                            ? 'bg-zinc-900 text-white'
                            : 'text-gray-400 hover:text-white'
                        )}
                      >
                        <svg className={cn('w-3 h-3 mr-1', selectedPlatform === 'ios' ? 'text-white' : 'text-gray-400')} viewBox="0 0 24 24" fill="currentColor">
                          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
                        </svg>
                        iOS
                      </Button>

                      {/* Android btn */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedPlatform('android')}
                        role="tab"
                        aria-selected={selectedPlatform === 'android'}
                        className={cn(
                          'relative z-10 h-7 px-3 text-xs rounded-full transition-colors flex items-center',
                          selectedPlatform === 'android'
                            ? 'bg-zinc-900 text-white'
                            : 'text-gray-400 hover:text-white'
                        )}
                      >
                        <svg className={cn('w-3 h-3 mr-1', selectedPlatform === 'android' ? 'text-green-400' : 'text-gray-400')} viewBox="0 0 24 24" fill="currentColor">
                          <path d="M17.523 15.3414c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993.0001.5511-.4482.9997-.9993.9997m-11.046 0c-.5511 0-.9993-.4486-.9993-.9997s.4482-.9993.9993-.9993c.5511 0 .9993.4482.9993.9993 0 .5511-.4482.9997-.9993.9997m11.4045-6.02l1.9973-3.4592a.416.416 0 00-.1518-.5972.416.416 0 00-.5972.1518l-2.0223 3.5046C15.5207 8.2926 13.8961 7.8 12.0015 7.8s-3.5192.4926-5.1954 1.0141L4.7837 5.2952a.416.416 0 00-.5972-.1518.416.416 0 00-.1518.5972L6.0320 9.3214C2.6148 11.2632.5 15.0982.5 19.35h23c0-4.2518-2.1148-8.0868-5.5320-10.0286" />
                        </svg>
                        Android
                      </Button>
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={previewUrl.handleRefresh}
                    className="h-8 w-8"
                    title="Refresh preview"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={previewUrl.openInNewTab}
                    className="h-8 w-8"
                    title="Open in new tab"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </>
              )}

              {/* Code Controls - only show when code tab is active */}
              {activeMainTab === 'code' && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleDownloadCode}
                        disabled={isDownloading || !project?.sandbox?.id}
                        className={cn(
                          "h-8 px-2 text-[11px] rounded-full flex items-center gap-1.5 transition-colors leading-none",
                          "bg-zinc-900/80 text-white hover:bg-zinc-900/90 ring-1 ring-white/10 backdrop-blur-md shadow-sm",
                          (isDownloading || !project?.sandbox?.id) && "opacity-60 cursor-not-allowed"
                        )}
                        aria-label="Download code as ZIP"
                        aria-busy={isDownloading}
                      >
                        {isDownloading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                        ) : (
                          <Download className="h-3.5 w-3.5 text-white" />
                        )}
                        <span className="font-medium">Download code</span>
                        {isFreePlan && (
                          <span className="ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-pink-300 bg-pink-500/10 ring-1 ring-pink-500/20">
                            PRO
                          </span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Download code as ZIP
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Close button - hide when agent is building for immersive experience */}
              {agentStatus !== 'running' && agentStatus !== 'connecting' && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClose}
                  className="h-8 w-8"
                  title="Close preview panel"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Tab Content */}
        <div className="flex-1 overflow-hidden">
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
                onUrlSubmit={previewUrl.handleUrlSubmit}
                onIframeLoad={previewUrl.handleIframeLoad}
                onIframeError={previewUrl.handleIframeError}
                onRefresh={previewUrl.handleRefresh}
                onOpenInNewTab={previewUrl.openInNewTab}
                onCycleView={previewUrl.cycleView}
                setIframeRef={previewUrl.setIframeRef}
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            opacity: { duration: 0.15 },
          }}
          className={cn(
            'fixed top-14 right-2 bottom-2 border rounded-3xl flex flex-col z-30 bg-background dark:bg-neutral-900',
            isMobile
              ? 'left-2'
              : 'w-[60vw]',
          )}
          style={{
            overflow: 'hidden',
          }}
        >
          <div className="flex-1 flex flex-col overflow-hidden bg-background dark:bg-neutral-900">
            {renderContent()}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
} 