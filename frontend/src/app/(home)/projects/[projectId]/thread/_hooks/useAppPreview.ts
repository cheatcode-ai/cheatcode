import { useCallback, useEffect, useRef, useState } from 'react';
import { UnifiedMessage, AgentStatus } from '../_types';

interface UseAppPreviewReturn {
  isSidePanelOpen: boolean;
  setIsSidePanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  autoOpenedPanel: boolean;
  setAutoOpenedPanel: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidePanel: () => void;
  userClosedPanelRef: React.MutableRefObject<boolean>;
}

export function useAppPreview(
  messages: UnifiedMessage[],
  setLeftSidebarOpen: (open: boolean) => void,
  agentStatus?: AgentStatus
): UseAppPreviewReturn {
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false);
  const [autoOpenedPanel, setAutoOpenedPanel] = useState(false);
  
  const userClosedPanelRef = useRef(false);

  const toggleSidePanel = useCallback(() => {
    setIsSidePanelOpen(prev => {
      const newState = !prev;
      if (!newState) {
        userClosedPanelRef.current = true;
        setAutoOpenedPanel(true);
      } else {
        userClosedPanelRef.current = false;
        setLeftSidebarOpen(false);
      }
      return newState;
    });
  }, [setAutoOpenedPanel, setLeftSidebarOpen]);

  // Auto-open panel when agent starts running if user hasn't closed it
  useEffect(() => {
    if (agentStatus === 'running' && !userClosedPanelRef.current) {
      setIsSidePanelOpen(true);
      setAutoOpenedPanel(false);
    }
  }, [agentStatus]);

  return {
    isSidePanelOpen,
    setIsSidePanelOpen,
    autoOpenedPanel,
    setAutoOpenedPanel,
    toggleSidePanel,
    userClosedPanelRef,
  };
} 