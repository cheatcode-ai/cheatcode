'use client';

import React from 'react';
import { ThreadProviders, useThreadState } from '../_contexts/ThreadProviders';
import { ThreadSkeleton } from '@/components/thread/content/ThreadSkeleton';
import { 
  ThreadSiteHeader,
  ThreadContentWrapper,
  ThreadChatInput,
  ThreadAppPreview,
  ThreadBillingAlerts,
  ThreadDebugIndicator,
  ThreadError
} from '../_components';
import { useLayout } from '../_contexts/LayoutContext';

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
  const { isLoading, error, initialLoadCompleted } = useThreadState();
  const { isSidePanelOpen, isMobile } = useLayout();

  // Loading state
  if (!initialLoadCompleted || isLoading) {
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
          className={`flex flex-col flex-1 overflow-hidden transition-all duration-200 ease-in-out pt-14 ${
            isSidePanelOpen && initialLoadCompleted
              ? isMobile 
                ? 'mr-2' 
                : 'mr-[60vw]'
              : ''
          }`}
        >
          <ThreadContentWrapper />
          <ThreadChatInput />
        </div>

        {/* Side panel */}
        <ThreadAppPreview />
      </div>

      {/* Overlays */}
      <ThreadBillingAlerts />
    </>
  );
} 