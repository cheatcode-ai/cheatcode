'use client';

import React, { createContext, useContext, useCallback, useEffect } from 'react';
import { BillingError } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@clerk/nextjs';
import { useAgentStream } from '@/hooks/useAgentStream';
import { useAgentStateMachine } from '@/hooks/useAgentStateMachine';
import { useAddUserMessageMutation } from '@/hooks/react-query/threads/use-messages';
import { useStartAgentMutation, useStopAgentMutation } from '@/hooks/react-query/threads/use-agent-run';
// Removed useThreadAgent import - agent display is now hardcoded to "cheatcode"
import { UnifiedMessage } from '../_types';
import { useThreadState } from './ThreadStateContext';
import { useBilling } from './BillingContext';

interface SendMessageOptions {
  model_name?: string;
  enable_thinking?: boolean;
  app_type?: 'web' | 'mobile';
}

interface AgentStateMachineState {
  status: string;
  runId: string | null;
  streamingTextContent: string;
  streamingToolCall: any;
  isSending: boolean;
  autoStartedRun: boolean;
}

interface AgentStateMachineActions {
  startSending: () => void;
  stopSending: () => void;
  connect: (runId: string) => void;
  stop: () => void;
  reset: () => void;
  setAutoStarted: (started: boolean) => void;
  updateStreamingText: (content: string) => void;
  updateStreamingTool: (tool: any) => void;
  clearStreamingContent: () => void;
}

interface AgentStateMachineGetters {
  isActive: boolean;
  isRunning: boolean;
  isIdle: boolean;
  isTerminal: boolean;
  canStop: boolean;
}

interface ThreadActionsContextValue {
  // Agent state
  agentState: AgentStateMachineState;
  agentActions: AgentStateMachineActions;
  agentGetters: AgentStateMachineGetters;
  // Removed agent from context value
  
  // Streaming content
  streamingTextContent: string;
  streamingToolCall: any;
  streamHookStatus: string;
  
  // Actions
  sendMessage: (message: string, options?: SendMessageOptions) => Promise<void>;
  stopAgent: () => Promise<void>;
}

const ThreadActionsContext = createContext<ThreadActionsContextValue | null>(null);

export function useThreadActions() {
  const context = useContext(ThreadActionsContext);
  if (!context) {
    throw new Error('useThreadActions must be used within ThreadActionsProvider');
  }
  return context;
}

interface ThreadActionsProviderProps {
  children: React.ReactNode;
}

export function ThreadActionsProvider({ children }: ThreadActionsProviderProps) {
  const {
    threadId,
    projectId,
    messages,
    setMessages,
    project,
    messagesQuery,
    agentRunsQuery,
  } = useThreadState();
  
  const { setBillingData, setShowBillingAlert } = useBilling();
  const { getToken } = useAuth();

  // Agent State Machine
  const { state: agentState, actions: agentActions, getters: agentGetters, handleStatusUpdate } = useAgentStateMachine();

  const addUserMessageMutation = useAddUserMessageMutation();
  const startAgentMutation = useStartAgentMutation();
  const stopAgentMutation = useStopAgentMutation();
  // Removed useThreadAgent hook call and agent variable

  const handleNewMessageFromStream = useCallback((message: UnifiedMessage) => {
    console.log(
      `[STREAM HANDLER] Received message: ID=${message.message_id}, Type=${message.type}`,
    );

    if (!message.message_id) {
      console.warn(
        `[STREAM HANDLER] Received message is missing ID: Type=${message.type}, Content=${message.content?.substring(0, 50)}...`,
      );
    }

    setMessages((prev) => {
      const messageExists = prev.some(
        (m) => m.message_id === message.message_id,
      );
      if (messageExists) {
        return prev.map((m) =>
          m.message_id === message.message_id ? message : m,
        );
      } else {
        return [...prev, message];
      }
    });
  }, [setMessages]);

  const handleStreamStatusChange = useCallback((hookStatus: string) => {
    console.log(`[ACTIONS] Hook status changed: ${hookStatus}`);
    handleStatusUpdate(hookStatus);
  }, [handleStatusUpdate]);

  const handleStreamError = useCallback((errorMessage: string) => {
    console.error(`[ACTIONS] Stream hook error: ${errorMessage}`);
    
    // Suppress common expected errors that shouldn't show user notifications
    const suppressErrors = [
      'not found',
      'agent run is not running',
      'is not running',
      'agent run.*is not running',
      'not active',
      'completed',
      'stopped'
    ];
    
    const shouldSuppressError = suppressErrors.some(pattern => 
      errorMessage.toLowerCase().includes(pattern.toLowerCase())
    );
    
    if (!shouldSuppressError) {
      toast.error(`Stream Error: ${errorMessage}`);
    }
  }, []);

  const handleStreamClose = useCallback(() => {
    console.log(`[ACTIONS] Stream hook closed with final status: ${agentState.status}`);
  }, [agentState.status]);

  // Agent stream hook with state machine integration
  const {
    status: streamHookStatus,
    textContent: streamingTextContent,
    toolCall: streamingToolCall,
    error: streamError,
    agentRunId: currentHookRunId,
    startStreaming,
    stopStreaming,
  } = useAgentStream(
    {
      onMessage: handleNewMessageFromStream,
      onStatusChange: handleStreamStatusChange,
      onError: handleStreamError,
      onClose: handleStreamClose,
    },
    threadId,
    setMessages,
    {
      updateStreamingText: agentActions.updateStreamingText,
      updateStreamingTool: agentActions.updateStreamingTool,
      clearStreamingContent: agentActions.clearStreamingContent,
    },
    getToken
  );

  const sendMessage = useCallback(
    async (
      message: string,
      options?: SendMessageOptions,
    ) => {
      if (!message.trim() || agentState.isSending || agentGetters.isActive) {
        return;
      }

      const optimisticUserMessage: UnifiedMessage = {
        message_id: `temp-${Date.now()}`,
        thread_id: threadId,
        type: 'user',
        is_llm_message: false,
        content: message,
        metadata: '{}',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, optimisticUserMessage]);
      agentActions.startSending();

      try {
        // First, save the user message to the database
        await addUserMessageMutation.mutateAsync({
          threadId,
          message
        });

        // Then start the agent (this prevents race condition)
        const agentResult = await startAgentMutation.mutateAsync({
          threadId,
          options: {
            app_type: project?.app_type || 'web', // Use project's app_type, fallback to 'web'
            ...options
          }
        });

        try {
          agentActions.connect(agentResult.agent_run_id);
          
          // Immediately start streaming for this agent run
          startStreaming(agentResult.agent_run_id);
          
          // Note: Removed messagesQuery.refetch() to prevent overriding optimistic messages
          // Messages will be updated through the EventSource (SSE) stream instead
          agentRunsQuery.refetch();
        } catch (connectError) {
          console.error('Error connecting to agent or starting stream:', connectError);
          throw connectError; // Re-throw to be caught by outer catch block
        }

      } catch (err) {
        console.error('Error sending message or starting agent:', err);
        
        if (err instanceof BillingError) {
          console.log("Caught BillingError:", err.detail);
          setBillingData({
            currentUsage: err.detail.currentUsage as number | undefined,
            limit: err.detail.limit as number | undefined,
            message: err.detail.message || 'Monthly usage limit reached. Please upgrade.',
            accountId: project?.account_id || null
          });
          setShowBillingAlert(true);
          setMessages(prev => prev.filter(m => m.message_id !== optimisticUserMessage.message_id));
          return;
        }
        
        toast.error(err instanceof Error ? err.message : 'Operation failed');
        setMessages((prev) =>
          prev.filter((m) => m.message_id !== optimisticUserMessage.message_id),
        );
      } finally {
        agentActions.stopSending();
      }
    },
    [threadId, project?.account_id, project?.app_type, addUserMessageMutation, startAgentMutation, agentRunsQuery, setMessages, setBillingData, setShowBillingAlert, agentState.isSending, agentGetters.isActive, agentActions, startStreaming],
  );

  const stopAgent = useCallback(async () => {
    console.log(`[ACTIONS] Requesting agent stop via hook.`);
    agentActions.stop();

    await stopStreaming();

    if (agentState.runId) {
      try {
        await stopAgentMutation.mutateAsync(agentState.runId);
        agentRunsQuery.refetch();
      } catch (error) {
        console.error('Error stopping agent:', error);
      }
    }
  }, [stopStreaming, agentState.runId, stopAgentMutation, agentRunsQuery, agentActions]);

  // Auto-start agent effect - only stream if agent is active and no stream is already running
  useEffect(() => {
    if (
      agentState.runId && 
      agentState.runId !== currentHookRunId &&
      agentGetters.isActive && // Only stream if agent is connecting or running
      streamHookStatus === 'idle' // Only start if no stream is currently active
    ) {
      console.log(
        `[ACTIONS] Target agentRunId set to ${agentState.runId}, initiating stream...`,
      );
      startStreaming(agentState.runId);
    }
  }, [agentState.runId, startStreaming, currentHookRunId, agentGetters.isActive, streamHookStatus]);

  // Stop streaming when agent reaches terminal state
  useEffect(() => {
    if (agentGetters.isTerminal && currentHookRunId) {
      console.log(
        `[ACTIONS] Agent reached terminal state (${agentState.status}), stopping stream...`
      );
      stopStreaming();
      
      // Clear runId after a delay to allow final status updates
      setTimeout(() => {
        if (agentGetters.isTerminal) {
          agentActions.reset();
        }
      }, 1000);
    }
  }, [agentGetters.isTerminal, agentState.status, currentHookRunId, stopStreaming, agentActions]);

  // Auto-connect to running agent or auto-start for new threads
  useEffect(() => {
    if (agentRunsQuery.isLoading || agentRunsQuery.isFetching) return;
    if (agentState.autoStartedRun || !agentGetters.isIdle || agentState.runId) return;
    if (agentState.isSending || startAgentMutation.isPending) return;

    const runs = agentRunsQuery.data || [];
    const runningRun = runs.find(r => r.status === 'running' || r.status === 'queued');
    const hasCompletedRuns = runs.some(r => ['completed', 'error', 'stopped'].includes(r.status));
    const hasAssistantMessages = messages.some(m => m.type === 'assistant' || m.type === 'tool');
    const lastIsUser = messages.length > 0 && messages[messages.length - 1].type === 'user';

    // Connect to existing running agent
    if (runningRun) {
      agentActions.setAutoStarted(true);
      agentActions.connect(runningRun.run_id);
      startStreaming(runningRun.run_id);
      return;
    }

    // Auto-start only for new threads with pending user message
    if (lastIsUser && !hasCompletedRuns && !hasAssistantMessages) {
      agentActions.setAutoStarted(true);
      startAgentMutation.mutate(
        { threadId, options: { app_type: project?.app_type || 'web' } },
        {
          onSuccess: (data) => {
            if (data.agent_run_id) {
              agentActions.connect(data.agent_run_id);
              startStreaming(data.agent_run_id);
            }
          },
          onError: () => agentActions.setAutoStarted(false),
        }
      );
    }
  }, [
    agentState.autoStartedRun, agentGetters.isIdle, agentState.runId, agentState.isSending,
    messages, startAgentMutation, threadId, project?.app_type, agentActions, startStreaming,
    agentRunsQuery.data, agentRunsQuery.isLoading, agentRunsQuery.isFetching
  ]);

  const value: ThreadActionsContextValue = {
    agentState,
    agentActions,
    agentGetters,
    streamingTextContent,
    streamingToolCall,
    streamHookStatus,
    sendMessage,
    stopAgent,
  };

  return (
    <ThreadActionsContext.Provider value={value}>
      {children}
    </ThreadActionsContext.Provider>
  );
}