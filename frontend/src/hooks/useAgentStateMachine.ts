'use client';

import { useReducer, useCallback, useMemo } from 'react';

// Agent State Types
export type AgentStatus = 
  | 'idle' 
  | 'connecting' 
  | 'running' 
  | 'completed' 
  | 'stopped' 
  | 'failed' 
  | 'error';

export interface AgentState {
  status: AgentStatus;
  runId: string | null;
  isSending: boolean;
  autoStartedRun: boolean;
  error: string | null;
  streamingTextContent: string;
  streamingToolCall: any | null;
}

// Agent Actions
export type AgentAction =
  | { type: 'START_SENDING' }
  | { type: 'STOP_SENDING' }
  | { type: 'CONNECT'; runId: string }
  | { type: 'START_STREAMING' }
  | { type: 'COMPLETE' }
  | { type: 'STOP' }
  | { type: 'FAIL'; error: string }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' }
  | { type: 'SET_AUTO_STARTED'; autoStarted: boolean }
  | { type: 'UPDATE_STREAMING_TEXT'; content: string }
  | { type: 'UPDATE_STREAMING_TOOL'; toolCall: any }
  | { type: 'CLEAR_STREAMING_CONTENT' };

// Initial State
const initialAgentState: AgentState = {
  status: 'idle',
  runId: null,
  isSending: false,
  autoStartedRun: false,
  error: null,
  streamingTextContent: '',
  streamingToolCall: null,
};

// Agent Reducer
function agentReducer(state: AgentState, action: AgentAction): AgentState {
  switch (action.type) {
    case 'START_SENDING':
      return {
        ...state,
        isSending: true,
        error: null,
      };

    case 'STOP_SENDING':
      return {
        ...state,
        isSending: false,
      };

    case 'CONNECT':
      return {
        ...state,
        status: 'connecting',
        runId: action.runId,
        isSending: false,
        error: null,
        streamingTextContent: '',
        streamingToolCall: null,
      };

    case 'START_STREAMING':
      return {
        ...state,
        status: 'running',
      };

    case 'COMPLETE':
      return {
        ...state,
        status: 'completed',
        isSending: false,
        streamingTextContent: '',
        streamingToolCall: null,
      };

    case 'STOP':
      return {
        ...state,
        status: 'stopped',
        isSending: false,
        streamingTextContent: '',
        streamingToolCall: null,
      };

    case 'FAIL':
      return {
        ...state,
        status: 'failed',
        isSending: false,
        error: action.error,
        streamingTextContent: '',
        streamingToolCall: null,
      };

    case 'ERROR':
      return {
        ...state,
        status: 'error',
        isSending: false,
        error: action.error,
        streamingTextContent: '',
        streamingToolCall: null,
      };

    case 'RESET':
      return {
        ...initialAgentState,
      };

    case 'SET_AUTO_STARTED':
      return {
        ...state,
        autoStartedRun: action.autoStarted,
      };

    case 'UPDATE_STREAMING_TEXT':
      return {
        ...state,
        streamingTextContent: action.content,
      };

    case 'UPDATE_STREAMING_TOOL':
      return {
        ...state,
        streamingToolCall: action.toolCall,
      };

    case 'CLEAR_STREAMING_CONTENT':
      return {
        ...state,
        streamingTextContent: '',
        streamingToolCall: null,
      };

    default:
      return state;
  }
}

// Hook
export function useAgentStateMachine() {
  const [state, dispatch] = useReducer(agentReducer, initialAgentState);

  // Action creators
  const actions = useMemo(() => ({
    startSending: () => dispatch({ type: 'START_SENDING' }),
    stopSending: () => dispatch({ type: 'STOP_SENDING' }),
    connect: (runId: string) => dispatch({ type: 'CONNECT', runId }),
    startStreaming: () => dispatch({ type: 'START_STREAMING' }),
    complete: () => dispatch({ type: 'COMPLETE' }),
    stop: () => dispatch({ type: 'STOP' }),
    fail: (error: string) => dispatch({ type: 'FAIL', error }),
    error: (error: string) => dispatch({ type: 'ERROR', error }),
    reset: () => dispatch({ type: 'RESET' }),
    setAutoStarted: (autoStarted: boolean) => dispatch({ type: 'SET_AUTO_STARTED', autoStarted }),
    updateStreamingText: (content: string) => dispatch({ type: 'UPDATE_STREAMING_TEXT', content }),
    updateStreamingTool: (toolCall: any) => dispatch({ type: 'UPDATE_STREAMING_TOOL', toolCall }),
    clearStreamingContent: () => dispatch({ type: 'CLEAR_STREAMING_CONTENT' }),
  }), []);

  // Derived state getters
  const getters = useMemo(() => ({
    isIdle: state.status === 'idle',
    isConnecting: state.status === 'connecting',
    isRunning: state.status === 'running',
    isCompleted: state.status === 'completed',
    isStopped: state.status === 'stopped',
    isFailed: state.status === 'failed',
    isError: state.status === 'error',
    isActive: state.status === 'connecting' || state.status === 'running',
    isTerminal: ['completed', 'stopped', 'failed', 'error'].includes(state.status),
    canStart: state.status === 'idle' && !state.isSending,
    canStop: state.status === 'connecting' || state.status === 'running',
  }), [state.status, state.isSending]);

  // Handle external status updates (from useAgentStream)
  const handleStatusUpdate = useCallback((hookStatus: string) => {
    switch (hookStatus) {
      case 'idle':
        dispatch({ type: 'RESET' });
        break;
      case 'connecting':
        // Don't override connecting state if we already have a runId
        if (state.status === 'idle') {
          dispatch({ type: 'CONNECT', runId: state.runId || '' });
        }
        break;
      case 'streaming':
        dispatch({ type: 'START_STREAMING' });
        break;
      case 'completed':
        dispatch({ type: 'COMPLETE' });
        break;
      case 'stopped':
        dispatch({ type: 'STOP' });
        break;
      case 'failed':
        dispatch({ type: 'FAIL', error: 'Agent run failed' });
        break;
      case 'error':
        dispatch({ type: 'ERROR', error: 'Agent run error' });
        break;
      case 'agent_not_running':
        dispatch({ type: 'RESET' });
        break;
    }
  }, [state.status, state.runId]);

  return {
    state,
    actions,
    getters,
    handleStatusUpdate,
  };
} 