'use client';

import React, { createContext, useContext } from 'react';
import { UnifiedMessage, Project, AgentStatus } from '../_types';
import { useThreadData } from '../_hooks';

interface ThreadStateContextValue {
  // Core data
  threadId: string;
  projectId: string;
  messages: UnifiedMessage[];
  setMessages: React.Dispatch<React.SetStateAction<UnifiedMessage[]>>;
  project: Project | null;
  sandboxId: string | null;
  projectName: string;

  // Agent state
  agentStatus: AgentStatus;
  setAgentStatus: React.Dispatch<React.SetStateAction<AgentStatus>>;
  agentRunId: string | null;
  setAgentRunId: React.Dispatch<React.SetStateAction<string | null>>;

  // Loading states
  isLoading: boolean;
  error: string | null;
  initialLoadCompleted: boolean;

  // React Query objects for refetching
  threadQuery: any;
  messagesQuery: any;
  projectQuery: any;
  agentRunsQuery: any;
}

const ThreadStateContext = createContext<ThreadStateContextValue | null>(null);

export function useThreadState() {
  const context = useContext(ThreadStateContext);
  if (!context) {
    throw new Error('useThreadState must be used within ThreadStateProvider');
  }
  return context;
}

interface ThreadStateProviderProps {
  children: React.ReactNode;
  threadId: string;
  projectId: string;
}

export function ThreadStateProvider({ children, threadId, projectId }: ThreadStateProviderProps) {
  const {
    messages,
    setMessages,
    project,
    sandboxId,
    projectName,
    agentStatus,
    setAgentStatus,
    agentRunId,
    setAgentRunId,
    isLoading,
    error,
    initialLoadCompleted,
    threadQuery,
    messagesQuery,
    projectQuery,
    agentRunsQuery,
  } = useThreadData(threadId, projectId);

  // Note: SEO metadata is now handled by Next.js metadata API in layout.tsx
  // This is much cleaner than DOM manipulation in React components

  const value: ThreadStateContextValue = {
    threadId,
    projectId,
    messages,
    setMessages,
    project,
    sandboxId,
    projectName,
    agentStatus,
    setAgentStatus,
    agentRunId,
    setAgentRunId,
    isLoading,
    error,
    initialLoadCompleted,
    threadQuery,
    messagesQuery,
    projectQuery,
    agentRunsQuery,
  };

  return (
    <ThreadStateContext.Provider value={value}>
      {children}
    </ThreadStateContext.Provider>
  );
}