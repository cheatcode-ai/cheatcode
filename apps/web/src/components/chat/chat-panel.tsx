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
import { useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { MessageList } from "@/components/chat/message-list";
import { PromptComposer } from "@/components/chat/prompt-composer";
import { StreamReconnectBanner } from "@/components/chat/stream-reconnect-banner";
import { Plus } from "@/components/ui/icons";
import { agentModelRequestValue } from "@/lib/agent-models";
import { cancelRun, createChat, getThread } from "@/lib/api/project-thread";
import { type PreviewTab, useAppStore } from "@/lib/store/app-store";
import { rememberStreamSeq, streamResumeCursor } from "@/lib/stream/stream-seq";

const EMPTY_MESSAGES: CheatcodeUIMessage[] = [];

export function ChatPanel({
  autoSubmitPrompt,
  initialMessages = EMPTY_MESSAGES,
  onSubmitDraft,
  project,
  threadTitle,
  threadId,
}: {
  autoSubmitPrompt?: null | string;
  initialMessages?: CheatcodeUIMessage[];
  onSubmitDraft?: () => void;
  project: ProjectSummary | null;
  threadTitle?: null | string;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const draft = useAppStore((state) => state.draftByThread[threadId] ?? "");
  const activePreviewTab = useAppStore((state) => state.activePreviewTab);
  const agentModelId = useAppStore((state) => state.agentModelId);
  const resetConsole = useAppStore((state) => state.resetConsole);
  const resetPreviewNavigation = useAppStore((state) => state.resetPreviewNavigation);
  const setActivePreviewTab = useAppStore((state) => state.setActivePreviewTab);
  const setConnectionState = useAppStore((state) => state.setConnectionState);
  const setDraft = useAppStore((state) => state.setDraft);
  const setExpoUrl = useAppStore((state) => state.setExpoUrl);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  const setPreviewUrl = useAppStore((state) => state.setPreviewUrl);
  const setSandboxStatus = useAppStore((state) => state.setSandboxStatus);
  const transport = useMemo(() => createTransport(threadId, getToken), [getToken, threadId]);
  const selectedModel = agentModelRequestValue(agentModelId);
  const autoSubmittedPromptRef = useRef<string | null>(null);
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
          activePreviewTab,
          resetPreviewNavigation,
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
  // thread's preview/expo/console/nav state exactly once before the
  // message-derived effect runs.
  useEffect(() => {
    setPreviewUrl(null);
    setExpoUrl(null);
    setSandboxStatus("cold");
    setPreviewPanelOpen(false);
    resetConsole();
    resetPreviewNavigation();
  }, [
    resetConsole,
    resetPreviewNavigation,
    setExpoUrl,
    setPreviewPanelOpen,
    setPreviewUrl,
    setSandboxStatus,
  ]);

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
        activePreviewTab,
        resetPreviewNavigation,
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
    activePreviewTab,
    resetPreviewNavigation,
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
            ...(selectedModel ? { model: selectedModel } : {}),
          },
        },
      );
      setDraft(threadId, "");
      onSubmitDraft?.();
    },
    [onSubmitDraft, selectedModel, sendMessage, setDraft, threadId],
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
    <div className="relative flex min-h-0 flex-1 flex-col bg-white">
      <ChatContextRow project={project} title={threadTitle} />
      <StreamReconnectBanner />
      <MessageList messages={deferredMessages} />
      <PromptComposer
        onChange={(value) => setDraft(threadId, value)}
        onStop={stopRun}
        onSubmit={submitText}
        status={status}
        threadId={threadId}
        value={draft}
      />
    </div>
  );
}

function ChatContextRow({
  project,
  title,
}: {
  project: ProjectSummary | null;
  title: null | string | undefined;
}) {
  const titleText = title?.trim() || "New chat";
  const newChatLabel = project?.name ? `New chat in ${project.name}` : "New chat";
  const { getToken } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const newChatMutation = useMutation({
    mutationFn: (projectId: string) => createChat(getToken, { projectId }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't start a chat");
    },
    onSuccess: (thread) => {
      void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
      router.push(`/chats/${encodeURIComponent(thread.id)}`);
    },
  });

  return (
    <header className="hidden h-12 shrink-0 items-center px-2 py-1 text-[#1b1b1b] md:flex">
      <button
        className="min-w-0 max-w-[250px] truncate rounded-full px-3 py-1.5 text-left font-medium text-[#1b1b1b] text-[14px] leading-5 transition-colors hover:bg-[#f7f7f7]"
        title={titleText}
        type="button"
      >
        {titleText}
      </button>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          aria-label={newChatLabel}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b] disabled:opacity-50"
          disabled={!project || newChatMutation.isPending}
          onClick={() => {
            if (project) {
              newChatMutation.mutate(project.id);
            }
          }}
          type="button"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}

type SandboxStatusData = Extract<
  CheatcodeUIMessage["parts"][number],
  { type: "data-sandbox-status" }
>["data"];

interface SandboxStatusActions {
  activePreviewTab: PreviewTab;
  resetPreviewNavigation: () => void;
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
    actions.resetPreviewNavigation();
  }
  if (data.previewUrl) {
    actions.setPreviewUrl(data.previewUrl);
    actions.setExpoUrl(data.expoUrl ?? null);
    if (actions.activePreviewTab !== "files") {
      actions.setActivePreviewTab("app");
    }
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
      const cursor = cursorSource();
      // A non-zero resume cursor means this is a real reconnect (not a fresh
      // attach); surface it via the ephemeral store slice for the banner.
      if (cursor !== "0") {
        useAppStore.getState().setStreamReconnect({ at: Date.now(), fromSeq: Number(cursor) });
      }
      return {
        api: `${env.NEXT_PUBLIC_GATEWAY_URL}/v1/threads/${threadId}/runs/stream?lastSeq=${cursor}`,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      };
    },
    prepareSendMessagesRequest: ({ body, headers, messageId, messages }) => ({
      body: {
        agentName: body?.["agentName"],
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
