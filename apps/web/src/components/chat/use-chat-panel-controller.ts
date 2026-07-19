"use client";

import { useChat } from "@ai-sdk/react";
import {
  CHEATCODE_DATA_SCHEMAS,
  type CheatcodeUIMessage,
  type ProjectSummary,
  type Thread,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChatOnDataCallback, ChatStatus } from "ai";
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  mergeLoadedMessageHistory,
  type PendingSubmission,
} from "@/components/chat/chat-panel-submission";
import { chatErrorMessage, createChatTransport } from "@/components/chat/chat-transport";
import {
  useConnectionStateSync,
  useFailedSubmissionRecovery,
  useVisibleStreamResume,
} from "@/components/chat/use-chat-lifecycle";
import { useChatSubmission } from "@/components/chat/use-chat-submission";
import type { OlderMessagesLoadResult } from "@/components/chat/use-message-list-scroll";
import {
  applySandboxStatus,
  isBrowserToolName,
  type SandboxStatusActions,
  useSandboxSurfaceSync,
} from "@/components/chat/use-sandbox-surface-sync";
import { agentModelRequestValue } from "@/lib/agent-models";
import { cancelRun, getThread } from "@/lib/api/project-thread";
import { USER_SKILLS_QUERY } from "@/lib/api/skills";
import { useAppStore } from "@/lib/store/app-store";
import { rememberStreamSeq, streamResumeCursor } from "@/lib/stream/stream-seq";

const EMPTY_MESSAGES: CheatcodeUIMessage[] = [];

export interface ChatPanelProps {
  activeRunId: null | string;
  autoSubmitPrompt?: null | string | undefined;
  hasOlderMessages: boolean;
  initialMessages?: CheatcodeUIMessage[] | undefined;
  initialRunIntent?: import("@cheatcode/types").RunIntent | null | undefined;
  isLoadingOlderMessages: boolean;
  latestModelId: null | string;
  onLoadOlderMessages: () => Promise<CheatcodeUIMessage[]>;
  onSubmitDraft?: (() => void) | undefined;
  project: ProjectSummary | null;
  threadId: string;
  threadTitle?: null | string | undefined;
}

export function useChatPanelController(input: ChatPanelProps) {
  const runtime = useChatPanelRuntime(input);
  const submission = usePanelSubmission(input, runtime);
  useAutoSubmitPrompt(input, runtime, submission.submitText);
  return {
    actions: useChatPanelActions(input, runtime, submission),
    state: chatPanelState(input, runtime),
  };
}

function useChatPanelRuntime(input: ChatPanelProps) {
  const store = useChatPanelStore(input.threadId);
  const runtime = useChatRuntimeBase(input, store);
  const resumeStream = useSerializedResume(runtime.chat.resumeStream);
  const messages = useDeferredValue(runtime.chat.messages);
  const loadOlderMessages = useOlderMessageLoader(
    input.onLoadOlderMessages,
    messages,
    runtime.chat.setMessages,
  );
  useChatPanelEffects(input, store, runtime.chat, messages, {
    getToken: runtime.getToken,
    hasSubmittedRef: runtime.hasSubmittedRef,
    pendingSubmissionRef: runtime.pendingSubmissionRef,
    queryClient: runtime.queryClient,
    resumeStream,
  });
  return { ...runtime, loadOlderMessages, messages, store };
}

function useChatRuntimeBase(input: ChatPanelProps, store: ReturnType<typeof useChatPanelStore>) {
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const hasReceivedStreamDataRef = useRef(false);
  const hasSubmittedRef = useRef(false);
  const pendingSubmissionRef = useRef<PendingSubmission | null>(null);
  const transport = useMemo(
    () => createChatTransport(input.threadId, getToken),
    [getToken, input.threadId],
  );
  const cancelRunMutation = useCancelRun(input.threadId, getToken);
  const chat = useChatSession({
    activeRunId: input.activeRunId,
    getToken,
    hasReceivedStreamDataRef,
    hasSubmittedRef,
    initialMessages: input.initialMessages ?? EMPTY_MESSAGES,
    pendingSubmissionRef,
    queryClient,
    sandboxActions: store,
    threadId: input.threadId,
    transport,
  });
  transport.setCursorSource(() =>
    streamResumeCursor(input.threadId, hasReceivedStreamDataRef.current),
  );
  return {
    cancelRunMutation,
    chat,
    getToken,
    hasReceivedStreamDataRef,
    hasSubmittedRef,
    pendingSubmissionRef,
    queryClient,
    router,
  };
}

function usePanelSubmission(
  input: ChatPanelProps,
  runtime: ReturnType<typeof useChatPanelRuntime>,
) {
  const selectedModel = agentModelRequestValue(runtime.store.agentModelId) ?? null;
  const submissionInput = useMemo(
    () => ({
      activeRunId: input.activeRunId,
      clearError: runtime.chat.clearError,
      getToken: runtime.getToken,
      hasReceivedStreamDataRef: runtime.hasReceivedStreamDataRef,
      hasSubmittedRef: runtime.hasSubmittedRef,
      initialRunIntent: input.initialRunIntent ?? null,
      onSubmitDraft: input.onSubmitDraft,
      pendingSubmissionRef: runtime.pendingSubmissionRef,
      project: input.project,
      queryClient: runtime.queryClient,
      router: runtime.router,
      selectedModel,
      sendMessage: runtime.chat.sendMessage,
      setDraft: runtime.store.setDraft,
      status: runtime.chat.status,
      threadId: input.threadId,
      threadTitle: input.threadTitle,
    }),
    [
      input.activeRunId,
      input.onSubmitDraft,
      input.initialRunIntent,
      input.project,
      input.threadId,
      input.threadTitle,
      runtime.chat.clearError,
      runtime.chat.sendMessage,
      runtime.chat.status,
      runtime.getToken,
      runtime.hasReceivedStreamDataRef,
      runtime.hasSubmittedRef,
      runtime.pendingSubmissionRef,
      runtime.queryClient,
      runtime.router,
      runtime.store.setDraft,
      selectedModel,
    ],
  );
  return useChatSubmission(submissionInput);
}

function useAutoSubmitPrompt(
  input: ChatPanelProps,
  runtime: ReturnType<typeof useChatPanelRuntime>,
  submitText: ReturnType<typeof useChatSubmission>["submitText"],
): void {
  const autoSubmittedPromptRef = useRef<string | null>(null);
  useEffect(() => {
    const prompt = input.autoSubmitPrompt?.trim();
    if (!prompt || autoSubmittedPromptRef.current === prompt) {
      return;
    }
    if (runtime.store.draft.trim() !== prompt) {
      runtime.store.setDraft(input.threadId, prompt);
    }
    if (submitText(prompt, input.project)) {
      autoSubmittedPromptRef.current = prompt;
    }
  }, [
    input.autoSubmitPrompt,
    input.project,
    input.threadId,
    runtime.store.draft,
    runtime.store.setDraft,
    submitText,
  ]);
}

function useChatPanelActions(
  input: ChatPanelProps,
  runtime: ReturnType<typeof useChatPanelRuntime>,
  submission: ReturnType<typeof useChatSubmission>,
) {
  const stopRun = useCallback(() => {
    runtime.chat.stop();
    runtime.cancelRunMutation.mutate(input.activeRunId);
  }, [input.activeRunId, runtime.cancelRunMutation, runtime.chat.stop]);
  const setDraft = useCallback(
    (value: string) => runtime.store.setDraft(input.threadId, value),
    [input.threadId, runtime.store.setDraft],
  );
  return {
    ...submission,
    loadOlderMessages: runtime.loadOlderMessages,
    setDraft,
    stopRun,
  };
}

function chatPanelState(input: ChatPanelProps, runtime: ReturnType<typeof useChatPanelRuntime>) {
  const isRunActive = isActiveRunStatus(runtime.chat.status) || input.activeRunId !== null;
  return {
    composerStatus: composerRunStatus(
      runtime.chat.status,
      input.activeRunId !== null || runtime.cancelRunMutation.isPending,
    ),
    draft: runtime.store.draft,
    isMessageListStreaming: isRunActive || runtime.cancelRunMutation.isPending,
    messages: runtime.messages,
  };
}

function useChatPanelStore(threadId: string) {
  return {
    agentModelId: useAppStore((state) => state.agentModelId),
    draft: useAppStore((state) => state.draftByThread[threadId] ?? ""),
    resetConsole: useAppStore((state) => state.resetConsole),
    resetPreviewNavigation: useAppStore((state) => state.resetPreviewNavigation),
    setActivePreviewTab: useAppStore((state) => state.setActivePreviewTab),
    setDraft: useAppStore((state) => state.setDraft),
    setExpoUrl: useAppStore((state) => state.setExpoUrl),
    setPreviewPanelOpen: useAppStore((state) => state.setPreviewPanelOpen),
    setPreviewUrl: useAppStore((state) => state.setPreviewUrl),
    setSandboxStatus: useAppStore((state) => state.setSandboxStatus),
  };
}

function useCancelRun(threadId: string, getToken: () => Promise<null | string>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (knownRunId: null | string) => {
      const runId = knownRunId ?? (await getThread(getToken, threadId)).activeRunId;
      if (runId) {
        await cancelRun(getToken, runId);
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Run cancellation failed");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["threads", threadId] });
      void queryClient.invalidateQueries({ queryKey: ["threads", threadId, "messages"] });
    },
  });
}

function useChatSession(input: {
  activeRunId: null | string;
  getToken: () => Promise<null | string>;
  hasReceivedStreamDataRef: { current: boolean };
  hasSubmittedRef: { current: boolean };
  initialMessages: CheatcodeUIMessage[];
  pendingSubmissionRef: { current: PendingSubmission | null };
  queryClient: ReturnType<typeof useQueryClient>;
  sandboxActions: SandboxStatusActions;
  threadId: string;
  transport: ReturnType<typeof createChatTransport>;
}) {
  return useChat<CheatcodeUIMessage>({
    experimental_throttle: 50,
    id: input.threadId,
    messages: input.initialMessages,
    onData: (part) => handleStreamData(part, input),
    onError: (error) => {
      if (input.hasSubmittedRef.current) {
        toast.error(chatErrorMessage(error.message));
      }
    },
    onFinish: ({ isError }) => handleStreamFinish(isError, input),
    resume: false,
    transport: input.transport,
  });
}

function useSerializedResume(resumeStream: () => Promise<void>): () => Promise<void> {
  const pendingRef = useRef<Promise<void> | null>(null);
  return useCallback(() => {
    if (pendingRef.current) {
      return pendingRef.current;
    }
    const pending = resumeStream().finally(() => {
      if (pendingRef.current === pending) {
        pendingRef.current = null;
      }
    });
    pendingRef.current = pending;
    return pending;
  }, [resumeStream]);
}

function handleStreamData(
  part: Parameters<ChatOnDataCallback<CheatcodeUIMessage>>[0],
  input: Parameters<typeof useChatSession>[0],
): void {
  input.hasReceivedStreamDataRef.current = true;
  input.pendingSubmissionRef.current = null;
  if (part.type === "data-seq") {
    handleSequenceData(part.data, input.threadId);
  }
  if (part.type === "data-sandbox-status") {
    handleSandboxStatusData(part.data, input.sandboxActions);
  }
  if (part.type === "data-tool") {
    handleToolData(part.data, input.sandboxActions);
  }
  if (part.type === "data-project-created") {
    handleProjectCreatedData(part.data, input);
  }
  if (part.type === "data-skill-created") {
    handleSkillCreatedData(part.data, input.queryClient, input.sandboxActions);
  }
}

function handleSequenceData(data: unknown, threadId: string): void {
  const parsed = CHEATCODE_DATA_SCHEMAS.seq.safeParse(data);
  if (parsed.success) {
    rememberStreamSeq(threadId, parsed.data.seq);
  }
}

function handleSandboxStatusData(data: unknown, actions: SandboxStatusActions): void {
  const parsed = CHEATCODE_DATA_SCHEMAS["sandbox-status"].safeParse(data);
  if (parsed.success) {
    applySandboxStatus(parsed.data, actions);
  }
}

function handleToolData(data: unknown, actions: SandboxStatusActions): void {
  const parsed = CHEATCODE_DATA_SCHEMAS.tool.safeParse(data);
  if (parsed.success && isBrowserToolName(parsed.data.toolName)) {
    actions.setActivePreviewTab("app");
    actions.setPreviewPanelOpen(true);
  }
}

function handleProjectCreatedData(
  data: unknown,
  input: Parameters<typeof useChatSession>[0],
): void {
  const parsed = CHEATCODE_DATA_SCHEMAS["project-created"].safeParse(data);
  if (parsed.success) {
    handleProjectCreated(parsed.data.projectId, input);
  }
}

function handleSkillCreatedData(
  data: unknown,
  queryClient: ReturnType<typeof useQueryClient>,
  actions: SandboxStatusActions,
): void {
  const parsed = CHEATCODE_DATA_SCHEMAS["skill-created"].safeParse(data);
  if (parsed.success) {
    void queryClient.invalidateQueries({ queryKey: USER_SKILLS_QUERY });
    actions.setActivePreviewTab("files");
    actions.setPreviewPanelOpen(true);
  }
}

function handleProjectCreated(
  projectId: string,
  input: Parameters<typeof useChatSession>[0],
): void {
  input.queryClient.setQueryData<Thread>(["threads", input.threadId], (thread) =>
    thread ? { ...thread, projectId } : thread,
  );
  input.sandboxActions.setActivePreviewTab("files");
  input.sandboxActions.setPreviewPanelOpen(true);
  for (const queryKey of [
    ["threads", input.threadId],
    ["projects", projectId],
    ["sidebar-projects"],
    ["sidebar-project-threads"],
    ["sidebar-chats"],
  ]) {
    void input.queryClient.invalidateQueries({ queryKey });
  }
}

function handleStreamFinish(isError: boolean, input: Parameters<typeof useChatSession>[0]): void {
  if (!isError) {
    input.pendingSubmissionRef.current = null;
  }
  input.hasSubmittedRef.current = false;
  for (const queryKey of [
    ["threads", input.threadId],
    ["threads", input.threadId, "messages"],
    ["sidebar-chats"],
    ["sidebar-projects"],
    ["sidebar-project-threads"],
  ]) {
    void input.queryClient.invalidateQueries({ queryKey });
  }
}

function useOlderMessageLoader(
  onLoadOlderMessages: () => Promise<CheatcodeUIMessage[]>,
  messages: readonly CheatcodeUIMessage[],
  setMessages: ReturnType<typeof useChat<CheatcodeUIMessage>>["setMessages"],
) {
  return useCallback(async (): Promise<OlderMessagesLoadResult> => {
    try {
      const loadedMessages = await onLoadOlderMessages();
      setMessages((currentMessages) => mergeLoadedMessageHistory(loadedMessages, currentMessages));
      return olderMessagesLoadResult(loadedMessages, messages);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load older messages.");
      return { status: "failed" };
    }
  }, [messages, onLoadOlderMessages, setMessages]);
}

function olderMessagesLoadResult(
  loadedMessages: readonly CheatcodeUIMessage[],
  currentMessages: readonly CheatcodeUIMessage[],
): OlderMessagesLoadResult {
  const loadedFirst = loadedMessages[0];
  if (!loadedFirst) {
    return { status: "unchanged" };
  }
  const currentFirstId = currentMessages[0]?.id;
  if (!currentFirstId) {
    return { firstMessageId: loadedFirst.id, status: "prepended" };
  }
  const currentFirstIndex = loadedMessages.findIndex((message) => message.id === currentFirstId);
  return currentFirstIndex > 0
    ? { firstMessageId: loadedFirst.id, status: "prepended" }
    : { status: "unchanged" };
}

function useChatPanelEffects(
  input: ChatPanelProps,
  store: ReturnType<typeof useChatPanelStore>,
  chat: ReturnType<typeof useChatSession>,
  messages: readonly CheatcodeUIMessage[],
  shared: {
    getToken: () => Promise<null | string>;
    hasSubmittedRef: { current: boolean };
    pendingSubmissionRef: { current: PendingSubmission | null };
    queryClient: ReturnType<typeof useQueryClient>;
    resumeStream: () => Promise<void>;
  },
): void {
  useSandboxSurfaceSync({
    chatStatus: chat.status,
    messages,
    project: input.project,
    resetConsole: store.resetConsole,
    resetPreviewNavigation: store.resetPreviewNavigation,
    setActivePreviewTab: store.setActivePreviewTab,
    setExpoUrl: store.setExpoUrl,
    setPreviewPanelOpen: store.setPreviewPanelOpen,
    setPreviewUrl: store.setPreviewUrl,
    setSandboxStatus: store.setSandboxStatus,
  });
  useConnectionStateSync();
  useVisibleStreamResume({
    activeRunId: input.activeRunId,
    resumeStream: shared.resumeStream,
    status: chat.status,
  });
  useFailedSubmissionRecovery({
    ...shared,
    clearError: chat.clearError,
    resumeStream: shared.resumeStream,
    setDraft: store.setDraft,
    setMessages: chat.setMessages,
    status: chat.status,
    threadId: input.threadId,
  });
}

function isActiveRunStatus(status: ChatStatus): boolean {
  return status === "streaming" || status === "submitted";
}

function composerRunStatus(status: ChatStatus, hasActiveRun: boolean): ChatStatus {
  return hasActiveRun && !isActiveRunStatus(status) ? "submitted" : status;
}
