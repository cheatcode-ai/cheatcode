'use client';

import React from 'react';
import { ThreadStateProvider } from './ThreadStateContext';
import { ThreadActionsProvider } from './ThreadActionsContext';
import { ThreadBillingProvider } from './BillingContext';
import { LayoutProvider } from './LayoutContext';

interface ThreadProvidersProps {
  children: React.ReactNode;
  threadId: string;
  projectId: string;
}

export function ThreadProviders({ children, threadId, projectId }: ThreadProvidersProps) {
  return (
    <ThreadStateProvider threadId={threadId} projectId={projectId}>
      <ThreadBillingProvider>
        <LayoutProvider>
          <ThreadActionsProvider>
            {children}
          </ThreadActionsProvider>
        </LayoutProvider>
      </ThreadBillingProvider>
    </ThreadStateProvider>
  );
}

// Export all hooks for easy consumption
export { useThreadState } from './ThreadStateContext';
export { useThreadActions } from './ThreadActionsContext';
export { useThreadBilling } from './BillingContext';
export { useLayout } from './LayoutContext';