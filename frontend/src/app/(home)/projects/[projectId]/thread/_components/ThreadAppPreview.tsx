import { AppPreviewSidePanel } from '@/components/thread/app-preview-side-panel';
import { useThreadState } from '../_contexts/ThreadStateContext';
import { useThreadActions } from '../_contexts/ThreadActionsContext';
import { useLayout } from '../_contexts/LayoutContext';

export function ThreadAppPreview() {
  const { project, initialLoadCompleted, messagesQuery } = useThreadState();
  const { agentState } = useThreadActions();
  const {
    isSidePanelOpen,
    userClosedPanelRef,
    setIsSidePanelOpen,
    setAutoOpenedPanel
  } = useLayout();

  // Show panel when messages are available (progressive loading)
  const hasMessages = messagesQuery?.data !== undefined;
  const canShowPanel = initialLoadCompleted || hasMessages;

  const handleSidePanelClose = () => {
    setIsSidePanelOpen(false);
    userClosedPanelRef.current = true;
    setAutoOpenedPanel(true);
  };

  return (
    <AppPreviewSidePanel
      isOpen={isSidePanelOpen && canShowPanel}
      onClose={handleSidePanelClose}
      project={project || undefined}
      agentStatus={agentState.status}
    />
  );
}