import React from 'react';
import { AppPreviewSidePanel } from '@/components/thread/app-preview-side-panel';
import { useThreadState } from '../_contexts/ThreadStateContext';
import { useThreadActions } from '../_contexts/ThreadActionsContext';
import { useLayout } from '../_contexts/LayoutContext';

export function ThreadAppPreview() {
  const { project, initialLoadCompleted } = useThreadState();
  const { agentState } = useThreadActions(); // Removed agent - no longer available in context
  const { 
    isSidePanelOpen, 
    userClosedPanelRef, 
    setIsSidePanelOpen, 
    setAutoOpenedPanel 
  } = useLayout();

  const handleSidePanelClose = () => {
    setIsSidePanelOpen(false);
    userClosedPanelRef.current = true;
    setAutoOpenedPanel(true);
  };

  return (
    <AppPreviewSidePanel
      isOpen={isSidePanelOpen && initialLoadCompleted}
      onClose={handleSidePanelClose}
      project={project || undefined}
      agentStatus={agentState.status}
      // Removed agentName prop - custom agents no longer supported
    />
  );
}