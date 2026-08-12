import type { CheatcodeUIMessage } from "@cheatcode/types";
import type { QueryClient } from "@tanstack/react-query";
import type { ChatStatus } from "ai";
import { useEffect, useRef, useState } from "react";
import {
  type PendingSubmission,
  reconcileFailedSubmission,
  type SetChatMessages,
} from "@/components/chat/chat-panel-submission";
import { useAppStore } from "@/lib/store/app-store";

export function useConnectionStateSync(): void {
  useEffect(() => {
    const updateConnectionState = () => {
      useAppStore.getState().setConnectionState(navigator.onLine ? "online" : "offline");
    };
    updateConnectionState();
    window.addEventListener("online", updateConnectionState);
    window.addEventListener("offline", updateConnectionState);
    return () => {
      window.removeEventListener("online", updateConnectionState);
      window.removeEventListener("offline", updateConnectionState);
    };
  }, []);
}

export function useVisibleStreamResume(input: {
  activeRunId: null | string;
  resumeStream: () => Promise<void>;
  status: ChatStatus;
}): void {
  const [retryAttempt, setRetryAttempt] = useState(0);
  useEffect(() => {
    if (input.activeRunId === null) {
      if (retryAttempt !== 0) {
        setRetryAttempt(0);
      }
      return;
    }
    if (input.status === "streaming" || input.status === "submitted") {
      if (retryAttempt !== 0) {
        setRetryAttempt(0);
      }
      return;
    }
    const resumeVisibleStream = () => {
      const canResume = input.status === "ready" || input.status === "error";
      if (document.visibilityState === "visible" && canResume) {
        const delay = input.status === "error" ? reconnectDelay(retryAttempt) : 0;
        const timeout = window.setTimeout(() => {
          void input.resumeStream().finally(() => setRetryAttempt((attempt) => attempt + 1));
        }, delay);
        return () => window.clearTimeout(timeout);
      }
      return undefined;
    };
    let cancelPendingResume = resumeVisibleStream();
    const handleVisibilityChange = () => {
      cancelPendingResume?.();
      cancelPendingResume = resumeVisibleStream();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelPendingResume?.();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [input.activeRunId, input.resumeStream, input.status, retryAttempt]);
}

function reconnectDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.min(attempt, 4), 15_000);
}

export function useTerminalRunReconciliation(input: {
  activeRunId: null | string;
  persistedMessages: CheatcodeUIMessage[];
  setMessages: SetChatMessages;
  stopStream: () => void;
}): void {
  const previousRunIdRef = useRef(input.activeRunId);
  const isReconcilingRef = useRef(false);
  useEffect(() => {
    const previousRunId = previousRunIdRef.current;
    previousRunIdRef.current = input.activeRunId;
    if (input.activeRunId !== null) {
      isReconcilingRef.current = false;
      return;
    }
    if (previousRunId !== null) {
      isReconcilingRef.current = true;
      input.stopStream();
    }
    if (isReconcilingRef.current) {
      input.setMessages(input.persistedMessages);
    }
  }, [input.activeRunId, input.persistedMessages, input.setMessages, input.stopStream]);
}

export function useFailedSubmissionRecovery(input: {
  clearError: () => void;
  getToken: () => Promise<null | string>;
  hasSubmittedRef: { current: boolean };
  pendingSubmissionRef: { current: PendingSubmission | null };
  queryClient: QueryClient;
  resumeStream: () => Promise<void>;
  setDraft: (threadId: string, value: string) => void;
  setMessages: SetChatMessages;
  status: ChatStatus;
  threadId: string;
}): void {
  useEffect(() => {
    if (input.status !== "error") {
      return;
    }
    const pending = input.pendingSubmissionRef.current;
    if (!pending) {
      return;
    }
    input.pendingSubmissionRef.current = null;
    input.hasSubmittedRef.current = false;
    void reconcileFailedSubmission({
      clearError: input.clearError,
      getToken: input.getToken,
      pending,
      queryClient: input.queryClient,
      resumeStream: input.resumeStream,
      setDraft: input.setDraft,
      setMessages: input.setMessages,
      threadId: input.threadId,
    });
  }, [
    input.clearError,
    input.getToken,
    input.hasSubmittedRef,
    input.pendingSubmissionRef,
    input.queryClient,
    input.resumeStream,
    input.setDraft,
    input.setMessages,
    input.status,
    input.threadId,
  ]);
}
