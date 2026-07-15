import type { CheatcodeUIMessage, ProjectSummary } from "@cheatcode/types";
import type { QueryClient } from "@tanstack/react-query";
import type { ChatStatus } from "ai";
import { useCallback } from "react";
import { toast } from "sonner";
import {
  type PendingSubmission,
  type PromptRouter,
  routePromptToProjectTarget,
  titleChatFromFirstPrompt,
} from "@/components/chat/chat-panel-submission";
import { assertUserMessageWithinLimit } from "@/lib/input/prompt-attachments";

type SendMessage = (
  message: CheatcodeUIMessage,
  options?: { body?: Record<string, unknown> },
) => Promise<void>;

interface ChatSubmissionInput {
  activeRunId: null | string;
  clearError: () => void;
  getToken: () => Promise<null | string>;
  hasReceivedStreamDataRef: { current: boolean };
  hasSubmittedRef: { current: boolean };
  onSubmitDraft?: (() => void) | undefined;
  pendingSubmissionRef: { current: PendingSubmission | null };
  project: ProjectSummary | null;
  queryClient: QueryClient;
  router: PromptRouter;
  selectedModel: null | string;
  sendMessage: SendMessage;
  setDraft: (threadId: string, value: string) => void;
  status: ChatStatus;
  threadId: string;
  threadTitle?: null | string | undefined;
}

export function useChatSubmission(input: ChatSubmissionInput): {
  continueRun: () => void;
  submitText: (text: string, targetProject: ProjectSummary | null) => boolean;
} {
  const submitText = useCallback(
    (text: string, targetProject: ProjectSummary | null): boolean => {
      if (!isValidUserMessage(text)) {
        return false;
      }
      if (!canStartSubmission(text, input)) {
        return false;
      }
      input.hasSubmittedRef.current = true;
      if (!isCurrentThreadTarget(input.project, targetProject)) {
        routeSubmissionToProject(input, text, targetProject);
        return true;
      }
      submitInCurrentThread(input, text);
      return true;
    },
    [input],
  );

  const continueRun = useCallback(() => {
    if (input.hasSubmittedRef.current) {
      return;
    }
    const text = "Continue from where you left off. Complete the remaining work and verify it.";
    const messageId = crypto.randomUUID();
    input.clearError();
    input.hasSubmittedRef.current = true;
    input.hasReceivedStreamDataRef.current = false;
    input.pendingSubmissionRef.current = pendingSubmission(messageId, text, false);
    void input.sendMessage(userMessage(messageId, text), modelBody(input.selectedModel));
  }, [input]);

  return { continueRun, submitText };
}

function submitInCurrentThread(input: ChatSubmissionInput, text: string): void {
  if (!input.threadTitle?.trim() || input.threadTitle.trim() === "New chat") {
    void titleChatFromFirstPrompt(input.getToken, input.queryClient, input.threadId, text);
  }
  input.hasReceivedStreamDataRef.current = false;
  const messageId = crypto.randomUUID();
  input.pendingSubmissionRef.current = pendingSubmission(messageId, text, true);
  void input.sendMessage(userMessage(messageId, text), modelBody(input.selectedModel));
  input.setDraft(input.threadId, "");
  input.onSubmitDraft?.();
}

function routeSubmissionToProject(
  input: ChatSubmissionInput,
  prompt: string,
  targetProject: ProjectSummary | null,
): void {
  void routePromptToProjectTarget({
    getToken: input.getToken,
    prompt,
    queryClient: input.queryClient,
    router: input.router,
    selectedModel: input.selectedModel,
    setDraft: input.setDraft,
    targetProject,
    threadId: input.threadId,
  }).then((didNavigate) => {
    if (!didNavigate) {
      input.hasSubmittedRef.current = false;
    }
  });
}

function canStartSubmission(text: string, input: ChatSubmissionInput): boolean {
  return (
    text.length > 0 &&
    !input.hasSubmittedRef.current &&
    input.activeRunId === null &&
    input.status !== "streaming" &&
    input.status !== "submitted"
  );
}

function isCurrentThreadTarget(
  project: ProjectSummary | null,
  targetProject: ProjectSummary | null,
): boolean {
  return (project === null && targetProject === null) || project?.id === targetProject?.id;
}

function isValidUserMessage(text: string): boolean {
  try {
    assertUserMessageWithinLimit(text);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "That message is too long.");
    return false;
  }
}

function pendingSubmission(
  messageId: string,
  text: string,
  restoreToComposer: boolean,
): PendingSubmission {
  return { messageId, restoreToComposer, submittedAt: Date.now(), text };
}

function userMessage(messageId: string, text: string): CheatcodeUIMessage {
  return { id: messageId, parts: [{ text, type: "text" }], role: "user" };
}

function modelBody(selectedModel: null | string): { body: { model?: string } } {
  return { body: { ...(selectedModel ? { model: selectedModel } : {}) } };
}
