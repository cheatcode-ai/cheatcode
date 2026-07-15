import type { QueryClient } from "@tanstack/react-query";
import type { ChatStatus } from "ai";
import { useEffect } from "react";
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
  useEffect(() => {
    const resumeVisibleStream = () => {
      const canResume = input.activeRunId !== null && input.status === "ready";
      if (document.visibilityState === "visible" && canResume) {
        void input.resumeStream();
      }
    };
    resumeVisibleStream();
    document.addEventListener("visibilitychange", resumeVisibleStream);
    return () => {
      document.removeEventListener("visibilitychange", resumeVisibleStream);
    };
  }, [input.activeRunId, input.resumeStream, input.status]);
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
