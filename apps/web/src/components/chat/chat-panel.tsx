"use client";

import { useChat } from "@ai-sdk/react";
import { env } from "@cheatcode/env/web";
import {
  type CheatcodeUIMessage,
  ErrorResponseSchema,
  type ProjectSummary,
  type Thread,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageList } from "@/components/chat/message-list";
import { PromptComposer } from "@/components/chat/prompt-composer";
import { StreamReconnectBanner } from "@/components/chat/stream-reconnect-banner";
import { BudTooltip } from "@/components/ui/bud-tooltip";
import { FolderOpen, Plus, Search } from "@/components/ui/icons";
import { agentModelRequestValue } from "@/lib/agent-models";
import { buildExistingProjectParams, launchIntoProject } from "@/lib/api/home-launch";
import {
  cancelRun,
  createChat,
  getThread,
  listProjectThreads,
  threadTitle,
} from "@/lib/api/project-thread";
import { type PreviewTab, useAppStore } from "@/lib/store/app-store";
import { rememberStreamSeq, streamResumeCursor } from "@/lib/stream/stream-seq";
import { cn } from "@/lib/ui/cn";

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
  const router = useRouter();
  const queryClient = useQueryClient();
  const draft = useAppStore((state) => state.draftByThread[threadId] ?? "");
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
  const latestSandboxSnapshotKey = [
    latestSandboxStatusValue,
    latestSandboxPreviewUrl,
    latestSandboxExpoUrl,
  ].join("|");
  const appliedSandboxSnapshotRef = useRef<string | null>(null);
  const defaultedProjectFilesRef = useRef<string | null>(null);

  // ChatPanel remounts per thread (key={threadId}); reset the previous thread's
  // console + preview-nav on mount. These don't overlap the sandbox surface below,
  // and resetting twice (React dev double-invoke) is idempotent.
  useEffect(() => {
    resetConsole();
    resetPreviewNavigation();
  }, [resetConsole, resetPreviewNavigation]);

  // Single owner of the thread's sandbox/preview surface, derived from its messages:
  // restore a live preview (or sandbox status) when the thread has one, otherwise
  // reset to cold. Guarded by a per-distinct-state ref so it applies once — not on
  // every streamed message, and idempotent under React's dev double-invoke of effects
  // (a previously separate unguarded reset would clobber the just-restored preview,
  // showing "No preview available" after a reload — see preview re-hydration).
  useEffect(() => {
    if (appliedSandboxSnapshotRef.current === latestSandboxSnapshotKey) {
      return;
    }
    appliedSandboxSnapshotRef.current = latestSandboxSnapshotKey;
    if (!latestSandboxStatusValue) {
      setPreviewUrl(null);
      setExpoUrl(null);
      setSandboxStatus("cold");
      setPreviewPanelOpen(false);
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
    latestSandboxSnapshotKey,
    latestSandboxStatusValue,
    setActivePreviewTab,
    setExpoUrl,
    setPreviewPanelOpen,
    setPreviewUrl,
    setSandboxStatus,
  ]);

  useEffect(() => {
    if (!project || latestSandboxStatusValue || latestSandboxPreviewUrl) {
      return;
    }
    if (defaultedProjectFilesRef.current === project.id) {
      return;
    }
    defaultedProjectFilesRef.current = project.id;
    setActivePreviewTab("files");
  }, [latestSandboxPreviewUrl, latestSandboxStatusValue, project, setActivePreviewTab]);

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
    (text: string, targetProject: ProjectSummary | null) => {
      if (text.length === 0) {
        return;
      }
      const shouldSendInCurrentThread =
        (project === null && targetProject === null) || project?.id === targetProject?.id;
      if (!shouldSendInCurrentThread) {
        void routePromptToProjectTarget({
          getToken,
          prompt: text,
          queryClient,
          router,
          selectedModel: selectedModel ?? null,
          setDraft,
          targetProject,
          threadId,
        });
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
      ).catch(() => {
        hasSubmittedRef.current = false;
        setDraft(threadId, text);
      });
      setDraft(threadId, "");
      onSubmitDraft?.();
    },
    [
      getToken,
      onSubmitDraft,
      project,
      queryClient,
      router,
      selectedModel,
      sendMessage,
      setDraft,
      threadId,
    ],
  );

  function stopRun() {
    stop();
    cancelRunMutation.mutate();
  }

  useEffect(() => {
    const prompt = autoSubmitPrompt?.trim();
    if (!prompt || autoSubmittedPromptRef.current === prompt) {
      return;
    }
    autoSubmittedPromptRef.current = prompt;
    if (draft.trim() !== prompt) {
      setDraft(threadId, prompt);
    }
    submitText(prompt, project);
  }, [autoSubmitPrompt, draft, project, setDraft, submitText, threadId]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-white">
      <ChatContextRow project={project} threadId={threadId} title={threadTitle} />
      <StreamReconnectBanner />
      <MessageList isStreaming={status === "streaming"} messages={deferredMessages} />
      <PromptComposer
        onChange={(value) => setDraft(threadId, value)}
        onStop={stopRun}
        onSubmit={submitText}
        project={project}
        status={status}
        threadId={threadId}
        value={draft}
      />
    </div>
  );
}

function ChatContextRow({
  project,
  threadId,
  title,
}: {
  project: ProjectSummary | null;
  threadId: string;
  title: null | string | undefined;
}) {
  const titleText = title?.trim() || "New chat";
  const newChatLabel = project?.name ? `New chat in ${project.name}` : "New chat";
  const { getToken } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const folderChatsRef = useRef<HTMLDivElement | null>(null);
  const folderContextKey = `${pathname}:${project?.id ?? "no-project"}:${threadId}`;
  const previousFolderContextKey = useRef(folderContextKey);
  const [folderChatsOpen, setFolderChatsOpen] = useState(false);
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

  useEffect(() => {
    if (previousFolderContextKey.current === folderContextKey) {
      return;
    }
    previousFolderContextKey.current = folderContextKey;
    setFolderChatsOpen(false);
  }, [folderContextKey]);

  useEffect(() => {
    if (!folderChatsOpen) {
      return;
    }

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (folderChatsRef.current?.contains(target)) {
        return;
      }
      setFolderChatsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFolderChatsOpen(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [folderChatsOpen]);

  return (
    <div className="contents" ref={folderChatsRef}>
      <header className="hidden h-12 shrink-0 items-center px-2 py-1 text-[#1b1b1b] md:flex">
        <button
          className="min-w-0 max-w-[250px] truncate rounded-full px-3 py-1.5 text-left font-medium text-[#1b1b1b] text-[14px] leading-5 transition-colors hover:bg-[#f7f7f7]"
          title={titleText}
          type="button"
        >
          {titleText}
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <BudTooltip label={newChatLabel} side="bottom">
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
          </BudTooltip>
          <BudTooltip label="Folder chats" side="bottom">
            <button
              aria-label="Folder chats"
              aria-pressed={folderChatsOpen}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b] disabled:opacity-50"
              disabled={!project}
              onClick={() => setFolderChatsOpen((current) => !current)}
              type="button"
            >
              <FolderOpen aria-hidden="true" className="h-4 w-4" />
            </button>
          </BudTooltip>
        </div>
      </header>
      {folderChatsOpen && project ? (
        <FolderChatsSearch
          activeThreadId={threadId}
          onSelect={() => setFolderChatsOpen(false)}
          project={project}
        />
      ) : null}
    </div>
  );
}

function FolderChatsSearch({
  activeThreadId,
  onSelect,
  project,
}: {
  activeThreadId: string;
  onSelect: () => void;
  project: ProjectSummary;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const threadQuery = useQuery({
    enabled: Boolean(project.id),
    queryFn: () => listProjectThreads(getToken, project.id, 50),
    queryKey: ["folder-chats", project.id],
    retry: false,
    staleTime: 30_000,
  });
  const visibleThreads = filterFolderThreads(threadQuery.data ?? [], query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="absolute top-12 right-2 left-2 z-30 hidden md:block">
      <div className="rounded-[18px] border border-[#f1f1f1] bg-white p-1 shadow-[0_14px_36px_rgba(0,0,0,0.08)]">
        <label className="relative block">
          <span className="sr-only">Search...</span>
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#8a8a8a]"
          />
          <input
            aria-label="Search..."
            className="h-10 w-full rounded-[14px] bg-[#f7f7f7] pr-3 pl-9 font-medium text-[#1b1b1b] text-[14px] outline-none placeholder:text-[#a0a0a0] focus:bg-white focus:shadow-[0_0_0_1px_#dedede]"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search..."
            ref={inputRef}
            value={query}
          />
        </label>
        <div className="mt-1 max-h-52 overflow-y-auto">
          {threadQuery.isPending ? (
            <p className="px-3 py-2 text-[#a0a0a0] text-[12px]">Loading chats...</p>
          ) : visibleThreads.length === 0 ? (
            <p className="px-3 py-2 text-[#a0a0a0] text-[12px]">No chats in {project.name}</p>
          ) : (
            visibleThreads.map((thread) => {
              const title = thread.title?.trim() || "New chat";
              return (
                <button
                  aria-current={thread.id === activeThreadId ? "page" : undefined}
                  className={cn(
                    "flex h-9 w-full items-center rounded-[12px] px-3 text-left font-medium text-[13px] transition-colors",
                    thread.id === activeThreadId
                      ? "bg-[#f7f7f7] text-[#1b1b1b]"
                      : "text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#1b1b1b]",
                  )}
                  key={thread.id}
                  onClick={() => {
                    onSelect();
                    router.push(`/chats/${encodeURIComponent(thread.id)}`);
                  }}
                  type="button"
                >
                  <span className="min-w-0 truncate">{title}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

async function routePromptToProjectTarget({
  getToken,
  prompt,
  queryClient,
  router,
  selectedModel,
  setDraft,
  targetProject,
  threadId,
}: {
  getToken: () => Promise<null | string>;
  prompt: string;
  queryClient: ReturnType<typeof useQueryClient>;
  router: ReturnType<typeof useRouter>;
  selectedModel: null | string;
  setDraft: (threadId: string, value: string) => void;
  targetProject: ProjectSummary | null;
  threadId: string;
}) {
  try {
    const targetThreadId = targetProject
      ? await threadIdForExistingProject(getToken, targetProject, prompt)
      : await threadIdForNewProject(getToken, prompt, selectedModel);
    if (!targetThreadId) {
      return;
    }
    const handoff = buildExistingProjectParams(prompt).toString();
    setDraft(threadId, "");
    void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
    void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
    router.push(`/chats/${encodeURIComponent(targetThreadId)}?${handoff}`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not open that folder.");
  }
}

async function threadIdForExistingProject(
  getToken: () => Promise<null | string>,
  project: ProjectSummary,
  prompt: string,
): Promise<null | string> {
  const result = await launchIntoProject(getToken, project.id, prompt);
  if (result.busy) {
    toast.error(
      "That project's latest chat is busy - wait for the run to finish or pick another folder.",
    );
    return null;
  }
  return result.threadId;
}

async function threadIdForNewProject(
  getToken: () => Promise<null | string>,
  prompt: string,
  selectedModel: null | string,
): Promise<string> {
  const thread = await createChat(getToken, {
    initialPrompt: prompt,
    title: threadTitle(prompt),
    ...(selectedModel ? { defaultModel: selectedModel } : {}),
  });
  return thread.id;
}

function filterFolderThreads(threads: readonly Thread[], query: string): readonly Thread[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return threads;
  }
  return threads.filter((thread) => (thread.title ?? "New chat").toLowerCase().includes(trimmed));
}

type SandboxStatusData = Extract<
  CheatcodeUIMessage["parts"][number],
  { type: "data-sandbox-status" }
>["data"];

interface SandboxStatusActions {
  setActivePreviewTab: (tab: PreviewTab) => void;
  setExpoUrl: (url: null | string) => void;
  setPreviewPanelOpen: (open: boolean) => void;
  setPreviewUrl: (url: null | string) => void;
  setSandboxStatus: (status: SandboxStatusData["status"]) => void;
}

function applySandboxStatus(data: SandboxStatusData, actions: SandboxStatusActions): void {
  actions.setSandboxStatus(data.status);
  // Which Computer tab opens follows what the run produces (bud parity):
  //   web app with a live dev server → Browser tab (the running preview);
  //   docs / data / file work with no preview → Files tab (the workspace).
  // A running preview is STICKY for the life of the thread — every sandbox tool call
  // emits its own starting/ready pair, so we never null the URL or flip away from an
  // established preview mid-run. Only a NEW previewUrl replaces it; thread switch resets.
  if (data.previewUrl) {
    actions.setPreviewUrl(data.previewUrl);
    actions.setExpoUrl(data.expoUrl ?? null);
    actions.setActivePreviewTab("app");
    actions.setPreviewPanelOpen(true);
    return;
  }
  if (data.status === "starting") {
    actions.setPreviewPanelOpen(true);
    return;
  }
  // Ready/working with no preview: a docs/data/file run → surface the Files workspace,
  // unless a live preview is already established for this thread (web app, sticky).
  if (data.status !== "cold" && useAppStore.getState().previewUrl === null) {
    actions.setActivePreviewTab("files");
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
