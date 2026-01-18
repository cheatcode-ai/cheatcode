'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAppPreview, useKeyboardShortcuts } from '../_hooks';
import { useThreadState } from './ThreadStateContext';

interface LayoutContextValue {
  // Mobile/responsive
  isMobile: boolean;
  debugMode: boolean;
  
  // App preview & layout
  isSidePanelOpen: boolean;
  setIsSidePanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  toggleSidePanel: () => void;
  userClosedPanelRef: React.MutableRefObject<boolean>;
  autoOpenedPanel: boolean;
  setAutoOpenedPanel: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Project rename
  handleProjectRenamed: (newName: string) => void;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within LayoutProvider');
  }
  return context;
}

interface LayoutProviderProps {
  children: React.ReactNode;
}

export function LayoutProvider({ children }: LayoutProviderProps) {
  const { messages, initialLoadCompleted, messagesQuery, agentStatus } = useThreadState();
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();

  const [debugMode, setDebugMode] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
  const [initialPanelOpenAttempted, setInitialPanelOpenAttempted] = useState(false);
  const initialLayoutAppliedRef = useRef(false);

  const leftSidebarState = leftSidebarOpen ? 'expanded' : 'collapsed';

  const {
    isSidePanelOpen,
    setIsSidePanelOpen,
    autoOpenedPanel,
    setAutoOpenedPanel,
    toggleSidePanel,
    userClosedPanelRef,
  } = useAppPreview(messages, setLeftSidebarOpen, agentStatus);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    isSidePanelOpen,
    setIsSidePanelOpen,
    leftSidebarState,
    setLeftSidebarOpen,
    userClosedPanelRef,
  });

  const handleProjectRenamed = useCallback((_newName: string) => {
    // Implementation for project renaming
  }, []);

  // Initialize layout
  useEffect(() => {
    if (!initialLayoutAppliedRef.current) {
      setLeftSidebarOpen(false);
      initialLayoutAppliedRef.current = true;
    }
  }, []);

  // Auto-open panel when messages are available (progressive loading)
  const hasMessages = messagesQuery?.data !== undefined;
  useEffect(() => {
    if ((initialLoadCompleted || hasMessages) && !initialPanelOpenAttempted) {
      setInitialPanelOpenAttempted(true);

      if (messages.length > 0) {
        setIsSidePanelOpen(true);
      }
    }
  }, [initialPanelOpenAttempted, messages, initialLoadCompleted, hasMessages, setIsSidePanelOpen]);

  // Debug mode from URL params
  useEffect(() => {
    const debugParam = searchParams.get('debug');
    setDebugMode(debugParam === 'true');
  }, [searchParams]);

  const value: LayoutContextValue = {
    isMobile,
    debugMode,
    isSidePanelOpen,
    setIsSidePanelOpen,
    toggleSidePanel,
    userClosedPanelRef,
    autoOpenedPanel,
    setAutoOpenedPanel,
    handleProjectRenamed,
  };

  return (
    <LayoutContext.Provider value={value}>
      {children}
    </LayoutContext.Provider>
  );
}