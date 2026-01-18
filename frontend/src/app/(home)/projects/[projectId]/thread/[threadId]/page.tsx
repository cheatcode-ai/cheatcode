'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { ThreadProviders, useThreadState } from '../_contexts/ThreadProviders';
import { ThreadSkeleton } from '@/components/thread/content/ThreadSkeleton';
import {
  ThreadSiteHeader,
  ThreadChatInput,
  ThreadBillingAlerts,
  ThreadDebugIndicator,
  ThreadError
} from '../_components';
import { useLayout } from '../_contexts/LayoutContext';
import { Button } from '@/components/ui/button';
import { PanelRightOpen } from 'lucide-react';
import { AgentLoader } from '@/components/thread/content/loader';

// Dynamic imports for heavy components - improves initial load time
const ThreadContentWrapper = dynamic(
  () => import('../_components/ThreadContentWrapper').then(mod => ({ default: mod.ThreadContentWrapper })),
  {
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <AgentLoader />
      </div>
    ),
    ssr: false
  }
);

const ThreadAppPreview = dynamic(
  () => import('../_components/ThreadAppPreview').then(mod => ({ default: mod.ThreadAppPreview })),
  { ssr: false }
);

// SEO metadata is handled by Next.js metadata API in layout.tsx
// This is much cleaner than DOM manipulation in React components

export default function ThreadPage({
  params,
}: {
  params: Promise<{
    projectId: string;
    threadId: string;
  }>;
}) {
  const unwrappedParams = React.use(params);
  const { projectId, threadId } = unwrappedParams;

  return (
    <ThreadProviders threadId={threadId} projectId={projectId}>
      <ThreadPageContent />
    </ThreadProviders>
  );
}

function ThreadPageContent() {
  const { isLoading, error, initialLoadCompleted, messagesQuery } = useThreadState();
  const { isSidePanelOpen, isMobile, toggleSidePanel } = useLayout();

  // Show content as soon as messages are available (progressive loading)
  // Don't wait for all queries to complete
  const hasMessages = messagesQuery?.data !== undefined;
  const showSkeleton = !hasMessages && (isLoading || !initialLoadCompleted);

  if (showSkeleton) {
    return <ThreadSkeleton isSidePanelOpen={isSidePanelOpen} />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-screen">
        <ThreadSiteHeader />
        <div className="flex flex-col flex-1 overflow-hidden pt-14">
          <ThreadError error={error} />
        </div>
      </div>
    );
  }

  // Main layout - clean declarative composition
  return (
    <>
      <div className="flex h-screen">
        {/* Debug indicator */}
        <ThreadDebugIndicator />

        {/* Header */}
        <ThreadSiteHeader />

        {/* Main content area */}
        <div
          className={`flex flex-col flex-1 overflow-hidden transition-all duration-200 ease-in-out pt-14 bg-thread-panel relative ${
            isSidePanelOpen && hasMessages
              ? isMobile
                ? 'mr-2'
                : 'mr-[65vw]'
              : ''
          }`}
        >
          <ThreadContentWrapper />
          <ThreadChatInput />
        </div>

        {/* Side panel */}
        <ThreadAppPreview />

        {/* Floating Toggle Button - Visible only when panel is closed and not on mobile */}
        {!isSidePanelOpen && !isMobile && (
          <div className="fixed right-6 top-1/2 -translate-y-1/2 z-50 animate-in fade-in slide-in-from-right-4 duration-500">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidePanel}
              className="h-10 w-10 bg-zinc-950/80 backdrop-blur-md border border-zinc-800 shadow-2xl rounded-full text-zinc-500 hover:text-white hover:bg-zinc-900 transition-all group"
              title="Open Preview"
            >
              <PanelRightOpen className="h-5 w-5 transition-transform group-hover:scale-110" />
            </Button>
          </div>
        )}
      </div>

      {/* Overlays */}
      <ThreadBillingAlerts />
    </>
  );
}
 