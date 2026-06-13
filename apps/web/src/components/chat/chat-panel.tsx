"use client";

import { useChat } from "@ai-sdk/react";
import { env } from "@cheatcode/env/web";
import {
  type CheatcodeUIMessage,
  ErrorResponseSchema,
  type ProjectSummary,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { MessageList } from "@/components/chat/message-list";
import { PromptComposer } from "@/components/chat/prompt-composer";
import { agentModelLabel, agentModelRequestValue } from "@/lib/agent-models";
import { cancelRun, getThread, updateProject } from "@/lib/api/project-thread";
import { useAppStore } from "@/lib/store/app-store";
import { rememberStreamSeq, streamResumeCursor } from "@/lib/stream/stream-seq";
import { cn } from "@/lib/ui/cn";

export function ChatPanel({
  autoSubmitPrompt,
  initialMessages = [],
  onSubmitDraft,
  project,
  threadId,
}: {
  autoSubmitPrompt?: null | string;
  initialMessages?: CheatcodeUIMessage[];
  onSubmitDraft?: () => void;
  project: ProjectSummary | null;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const storedBudgetCapUsd = useAppStore((state) => state.budgetCapUsdByThread[threadId]);
  const draft = useAppStore((state) => state.draftByThread[threadId] ?? "");
  const agentModelId = useAppStore((state) => state.agentModelId);
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const setActivePreviewTab = useAppStore((state) => state.setActivePreviewTab);
  const setBudgetCapUsd = useAppStore((state) => state.setBudgetCapUsd);
  const setConnectionState = useAppStore((state) => state.setConnectionState);
  const setDraft = useAppStore((state) => state.setDraft);
  const setExpoUrl = useAppStore((state) => state.setExpoUrl);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  const setPreviewUrl = useAppStore((state) => state.setPreviewUrl);
  const setSandboxStatus = useAppStore((state) => state.setSandboxStatus);
  const transport = useMemo(() => createTransport(threadId, getToken), [getToken, threadId]);
  const selectedModel = agentModelRequestValue(agentModelId);
  const budgetCapUsd = effectiveBudgetCap(storedBudgetCapUsd, project);
  const autoSubmittedPromptRef = useRef<string | null>(null);
  const saveBudgetMutation = useMutation({
    mutationFn: (value: null | number) => {
      if (!project) {
        return Promise.resolve(null);
      }
      return updateProject(getToken, project.id, { budgetCapUsd: value });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Budget update failed");
    },
    onSuccess: (updatedProject) => {
      if (!updatedProject) {
        return;
      }
      queryClient.setQueryData(["projects", updatedProject.id], updatedProject);
    },
  });
  const cancelRunMutation = useMutation({
    mutationFn: async () => {
      const thread = await getThread(getToken, threadId);
      if (!thread.activeRunId) {
        return;
      }
      await cancelRun(getToken, thread.activeRunId);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Run cancellation failed");
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["threads", threadId] });
      void queryClient.invalidateQueries({ queryKey: ["threads", threadId, "messages"] });
    },
  });
  const hasReceivedStreamDataRef = useRef(false);
  const hasSubmittedRef = useRef(false);
  const hasPreviewSurface = previewUrl !== null || sandboxStatus !== "cold";
  const { messages, resumeStream, sendMessage, status, stop } = useChat<CheatcodeUIMessage>({
    experimental_throttle: 50,
    id: threadId,
    messages: initialMessages,
    onData: (part) => {
      hasReceivedStreamDataRef.current = true;
      if (part.type === "data-seq") {
        rememberStreamSeq(threadId, part.data.seq);
      }
      if (part.type === "data-sandbox-status") {
        applySandboxStatus(part.data, {
          setActivePreviewTab,
          setExpoUrl,
          setPreviewPanelOpen,
          setPreviewUrl,
          setSandboxStatus,
        });
      }
    },
    onError: (error) => {
      if (hasSubmittedRef.current) {
        toast.error(chatErrorMessage(error.message));
      }
    },
    resume: false,
    transport,
  });
  transport.setCursorSource(() => streamResumeCursor(threadId, hasReceivedStreamDataRef.current));

  const deferredMessages = useDeferredValue(messages);
  const latestSandboxStatus = latestSandboxStatusFromMessages(deferredMessages);
  const latestSandboxPreview = latestSandboxPreviewFromMessages(deferredMessages);
  const latestSandboxPreviewUrl = latestSandboxPreview?.previewUrl ?? null;
  const latestSandboxExpoUrl = latestSandboxPreview?.expoUrl ?? null;
  const latestSandboxStatusValue = latestSandboxStatus?.status ?? null;

  // ChatPanel remounts per thread (key={threadId}), so this clears the previous
  // thread's preview/expo state exactly once before the message-derived effect runs.
  useEffect(() => {
    setPreviewUrl(null);
    setExpoUrl(null);
    setSandboxStatus("cold");
    setPreviewPanelOpen(false);
  }, [setExpoUrl, setPreviewPanelOpen, setPreviewUrl, setSandboxStatus]);

  useEffect(() => {
    if (!latestSandboxStatusValue) {
      return;
    }
    applySandboxStatus(
      latestSandboxPreviewUrl
        ? {
            v: 1,
            status: latestSandboxStatusValue,
            previewUrl: latestSandboxPreviewUrl,
            ...(latestSandboxExpoUrl ? { expoUrl: latestSandboxExpoUrl } : {}),
          }
        : { v: 1, status: latestSandboxStatusValue },
      {
        setActivePreviewTab,
        setExpoUrl,
        setPreviewPanelOpen,
        setPreviewUrl,
        setSandboxStatus,
      },
    );
  }, [
    latestSandboxExpoUrl,
    latestSandboxPreviewUrl,
    latestSandboxStatusValue,
    setActivePreviewTab,
    setExpoUrl,
    setPreviewPanelOpen,
    setPreviewUrl,
    setSandboxStatus,
  ]);

  useEffect(() => {
    const updateConnectionState = () => {
      setConnectionState(navigator.onLine ? "online" : "offline");
    };
    updateConnectionState();
    window.addEventListener("online", updateConnectionState);
    window.addEventListener("offline", updateConnectionState);
    return () => {
      window.removeEventListener("online", updateConnectionState);
      window.removeEventListener("offline", updateConnectionState);
    };
  }, [setConnectionState]);

  useEffect(() => {
    const resumeVisibleStream = () => {
      if (document.visibilityState === "visible" && status === "streaming") {
        void resumeStream();
      }
    };
    document.addEventListener("visibilitychange", resumeVisibleStream);
    return () => {
      document.removeEventListener("visibilitychange", resumeVisibleStream);
    };
  }, [resumeStream, status]);

  const submitText = useCallback(
    (text: string) => {
      if (text.length === 0) {
        return;
      }
      hasSubmittedRef.current = true;
      hasReceivedStreamDataRef.current = false;
      void sendMessage(
        { text },
        {
          body: {
            ...(budgetCapUsd === null ? {} : { budgetCapUsd }),
            ...(selectedModel ? { model: selectedModel } : {}),
          },
        },
      );
      setDraft(threadId, "");
      onSubmitDraft?.();
    },
    [budgetCapUsd, onSubmitDraft, selectedModel, sendMessage, setDraft, threadId],
  );

  function stopRun() {
    stop();
    cancelRunMutation.mutate();
  }

  useEffect(() => {
    const prompt = autoSubmitPrompt?.trim();
    if (!prompt || autoSubmittedPromptRef.current === prompt || draft.trim() !== prompt) {
      return;
    }
    autoSubmittedPromptRef.current = prompt;
    submitText(prompt);
  }, [autoSubmitPrompt, draft, submitText]);

  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col bg-thread-panel font-mono transition-[margin] duration-200 ease-in-out",
        previewPanelOpen && hasPreviewSurface ? "xl:w-[35vw]" : "",
      )}
    >
      <MessageList messages={deferredMessages} />
      <PromptComposer
        budgetCapUsd={budgetCapUsd}
        modelLabel={agentModelLabel(agentModelId)}
        onBudgetChange={(value) => {
          setBudgetCapUsd(threadId, value);
          saveBudgetMutation.mutate(value);
        }}
        onChange={(value) => setDraft(threadId, value)}
        onStop={stopRun}
        onSubmit={submitText}
        status={status}
        value={draft}
      />
    </div>
  );
}

function effectiveBudgetCap(
  threadBudgetCapUsd: null | number | undefined,
  project: ProjectSummary | null,
): null | number {
  if (threadBudgetCapUsd !== undefined) {
    return threadBudgetCapUsd;
  }
  return project?.budgetCapUsd ?? null;
}

type SandboxStatusData = Extract<
  CheatcodeUIMessage["parts"][number],
  { type: "data-sandbox-status" }
>["data"];

interface SandboxStatusActions {
  setActivePreviewTab: (tab: "app") => void;
  setExpoUrl: (url: null | string) => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setPreviewUrl: (url: null | string) => void;
  setSandboxStatus: (status: SandboxStatusData["status"]) => void;
}

function applySandboxStatus(data: SandboxStatusData, actions: SandboxStatusActions): void {
  actions.setSandboxStatus(data.status);
  if (data.status === "starting") {
    actions.setPreviewUrl(null);
    actions.setExpoUrl(null);
    actions.setPreviewPanelOpen(true);
  }
  if (data.previewUrl) {
    actions.setPreviewUrl(data.previewUrl);
    actions.setExpoUrl(data.expoUrl ?? null);
    actions.setActivePreviewTab("app");
    actions.setPreviewPanelOpen(true);
  }
}

function latestSandboxStatusFromMessages(
  messages: readonly CheatcodeUIMessage[],
): SandboxStatusData | null {
  return latestSandboxPartMatching(messages, () => true);
}

function latestSandboxPreviewFromMessages(
  messages: readonly CheatcodeUIMessage[],
): SandboxStatusData | null {
  return latestSandboxPartMatching(messages, (data) => Boolean(data.previewUrl));
}

function latestSandboxPartMatching(
  messages: readonly CheatcodeUIMessage[],
  matches: (data: SandboxStatusData) => boolean,
): SandboxStatusData | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message) {
      continue;
    }
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part?.type === "data-sandbox-status" && matches(part.data)) {
        return part.data;
      }
    }
  }
  return null;
}

type CheatcodeChatTransport = DefaultChatTransport<CheatcodeUIMessage> & {
  setCursorSource: (source: () => string) => void;
};

interface ReconnectRequest {
  api: string;
  headers: Record<string, string>;
}

function createTransport(
  threadId: string,
  getToken: () => Promise<null | string>,
): CheatcodeChatTransport {
  let cursorSource = () => "0";
  const transport = new DefaultChatTransport<CheatcodeUIMessage>({
    api: `${env.NEXT_PUBLIC_GATEWAY_URL}/v1/threads/${threadId}/runs`,
    headers: async () => {
      const token = await getToken();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
    prepareReconnectToStreamRequest: async (): Promise<ReconnectRequest> => {
      const token = await getToken();
      return {
        api: `${env.NEXT_PUBLIC_GATEWAY_URL}/v1/threads/${threadId}/runs/stream?lastSeq=${cursorSource()}`,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      };
    },
    prepareSendMessagesRequest: ({ body, headers, messageId, messages }) => ({
      body: {
        agentName: body?.["agentName"],
        budgetCapUsd: body?.["budgetCapUsd"],
        message: messages.at(-1),
        model: body?.["model"],
      },
      headers: {
        ...headers,
        "Idempotency-Key": runIdempotencyKey(threadId, messageId ?? messages.at(-1)?.id),
      },
    }),
  });
  return Object.assign(transport, {
    setCursorSource(source: () => string) {
      cursorSource = source;
    },
  });
}

function runIdempotencyKey(threadId: string, messageId: string | undefined): string {
  const key = `run-${threadId}-${messageId ?? crypto.randomUUID()}`;
  return key.length <= 255 ? key : key.slice(0, 255);
}

function chatErrorMessage(message: string): string {
  const parsedJson = safeJsonParse(message);
  const parsedResponse = ErrorResponseSchema.safeParse(parsedJson);
  if (!parsedResponse.success) {
    return message;
  }
  const hint = parsedResponse.data.error.hint;
  return hint ? `${parsedResponse.data.error.message}. ${hint}` : parsedResponse.data.error.message;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
