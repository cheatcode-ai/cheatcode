"use client";

import { useChat } from "@ai-sdk/react";
import { env } from "@cheatcode/env/web";
import {
  type CheatcodeUIMessage,
  ErrorResponseSchema,
  type ProjectSummary,
} from "@cheatcode/types";
import { ModalShell } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageList } from "@/components/chat/message-list";
import { PromptComposer } from "@/components/chat/prompt-composer";
import { StreamReconnectBanner } from "@/components/chat/stream-reconnect-banner";
import { Check, Globe, Link as LinkIcon, Monitor, SlidersHorizontal } from "@/components/ui/icons";
import { agentModelRequestValue } from "@/lib/agent-models";
import { cancelRun, getThread, updateProject } from "@/lib/api/project-thread";
import { createReplayShare, fetchReplayShareForThread, updateReplayShare } from "@/lib/api/replays";
import { useAppStore } from "@/lib/store/app-store";
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
  const queryClient = useQueryClient();
  const storedBudgetCapUsd = useAppStore((state) => state.budgetCapUsdByThread[threadId]);
  const draft = useAppStore((state) => state.draftByThread[threadId] ?? "");
  const agentModelId = useAppStore((state) => state.agentModelId);
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const resetConsole = useAppStore((state) => state.resetConsole);
  const resetPreviewNavigation = useAppStore((state) => state.resetPreviewNavigation);
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
        "relative flex h-screen min-h-0 flex-1 flex-col bg-white transition-[width] duration-200 ease-in-out",
        previewPanelOpen && hasPreviewSurface ? "xl:w-[584px] xl:flex-none" : "",
      )}
    >
      <ChatContextRow project={project} threadId={threadId} title={threadTitle} />
      <StreamReconnectBanner />
      <MessageList messages={deferredMessages} />
      <PromptComposer
        budgetCapUsd={budgetCapUsd}
        onBudgetChange={(value) => {
          setBudgetCapUsd(threadId, value);
          saveBudgetMutation.mutate(value);
        }}
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
  threadId,
  title,
}: {
  project: ProjectSummary | null;
  threadId: string;
  title: null | string | undefined;
}) {
  const projectName = project?.name?.trim() || "new project";
  const titleText = title?.trim() || "New task";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <header className="flex h-[54px] shrink-0 items-center gap-3 px-4 pt-3 text-[#1b1b1b]">
      <span className="inline-flex h-[30px] min-w-0 max-w-[160px] items-center gap-2 rounded-full border border-[#f1f1f1] bg-white px-3 text-[13px]">
        <Monitor aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#8a8a8a]" />
        <span className="truncate">{projectName}</span>
      </span>
      <h1 className="min-w-0 flex-1 truncate font-semibold text-[15px]">{titleText}</h1>
      {project ? (
        <button
          aria-label="Share this run"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[#8a8a8a] text-[13px] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
          onClick={() => setShareOpen(true)}
          type="button"
        >
          <LinkIcon aria-hidden="true" className="h-4 w-4" />
          <span className="hidden sm:inline">Share</span>
        </button>
      ) : null}
      {project ? (
        <button
          aria-label="Project settings"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#8a8a8a] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
          onClick={() => setSettingsOpen(true)}
          type="button"
        >
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
        </button>
      ) : null}
      <span className="shrink-0 text-[#8a8a8a] text-[13px]">$0.00</span>
      {project ? (
        <ProjectSettingsDialog
          onClose={() => setSettingsOpen(false)}
          open={settingsOpen}
          project={project}
        />
      ) : null}
      {project ? (
        <ShareRunDialog onClose={() => setShareOpen(false)} open={shareOpen} threadId={threadId} />
      ) : null}
    </header>
  );
}

function ShareRunDialog({
  onClose,
  open,
  threadId,
}: {
  onClose: () => void;
  open: boolean;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [shareId, setShareId] = useState<null | string>(null);
  const [copied, setCopied] = useState(false);
  const shareQueryKey = ["replay-share", threadId];

  // On open, look up any existing active share so the dialog shows the link + revoke
  // instead of always offering "create".
  const existingShareQuery = useQuery({
    enabled: open,
    queryFn: () => fetchReplayShareForThread(getToken, threadId),
    queryKey: shareQueryKey,
    staleTime: 0,
  });
  const fetchedShareId = existingShareQuery.data?.id ?? null;
  const shareFetched = existingShareQuery.isFetched;
  useEffect(() => {
    if (fetchedShareId) {
      setShareId(fetchedShareId);
    } else if (shareFetched) {
      setShareId(null);
    }
  }, [fetchedShareId, shareFetched]);

  const shareUrl = shareId
    ? `${typeof window === "undefined" ? "" : window.location.origin}/replay/${shareId}`
    : "";

  const createMutation = useMutation({
    mutationFn: () => createReplayShare(getToken, threadId),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create a share link"),
    onSuccess: (share) => {
      setShareId(share.id);
      queryClient.setQueryData(shareQueryKey, share);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => updateReplayShare(getToken, id, { revoke: true }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not stop sharing"),
    onSuccess: () => {
      setShareId(null);
      setCopied(false);
      queryClient.setQueryData(shareQueryKey, null);
      toast.success("Sharing stopped — the link no longer works");
    },
  });

  const copyLink = () => {
    if (!shareUrl) {
      return;
    }
    void navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => toast.error("Could not copy the link"));
  };

  return (
    <ModalShell
      ariaLabel="Share this run"
      className="m-auto w-full max-w-lg"
      onClose={onClose}
      open={open}
    >
      <div className="flex flex-col gap-4 p-5 text-[#1b1b1b]">
        <div className="flex items-center gap-2">
          <Globe aria-hidden="true" className="h-5 w-5 text-[#8a8a8a]" />
          <h2 className="font-semibold text-[18px]">Share this run</h2>
        </div>
        <p className="text-[#5f5f5f] text-[14px] leading-6">
          Publish a read-only replay of this run. Anyone with the link can watch the transcript and
          fork it into their own project — secrets, preview URLs, and download links are stripped.
        </p>
        {shareId ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-[#ececec] bg-[#f7f7f7] px-3 py-2">
              <input
                aria-label="Replay link"
                className="min-w-0 flex-1 bg-transparent text-[#1b1b1b] text-[13px] outline-none"
                readOnly
                value={shareUrl}
              />
              <button
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#1b1b1b] px-3 font-medium text-[13px] text-white transition-colors hover:bg-black"
                onClick={copyLink}
                type="button"
              >
                {copied ? (
                  <Check aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <LinkIcon aria-hidden="true" className="h-4 w-4" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex justify-between">
              <button
                className="text-[#b42318] text-[13px] hover:underline disabled:opacity-50"
                disabled={revokeMutation.isPending}
                onClick={() => revokeMutation.mutate(shareId)}
                type="button"
              >
                {revokeMutation.isPending ? "Stopping…" : "Stop sharing"}
              </button>
              <button
                className="rounded-md border border-[#ececec] px-3 py-1.5 text-[#1b1b1b] text-[14px] hover:bg-[#f7f7f7]"
                onClick={onClose}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              className="rounded-md border border-[#ececec] px-3 py-1.5 text-[#1b1b1b] text-[14px] hover:bg-[#f7f7f7]"
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md bg-[#1b1b1b] px-3 py-1.5 font-medium text-[14px] text-white transition-colors hover:bg-black disabled:opacity-50"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
              type="button"
            >
              {createMutation.isPending ? "Creating…" : "Create share link"}
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

function ProjectSettingsDialog({
  onClose,
  open,
  project,
}: {
  onClose: () => void;
  open: boolean;
  project: ProjectSummary;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [instructions, setInstructions] = useState(project.masterInstructions ?? "");
  const [model, setModel] = useState(project.defaultModel ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      updateProject(getToken, project.id, {
        defaultModel: model.trim() || null,
        masterInstructions: instructions.trim() || null,
      }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save project settings"),
    onSuccess: () => {
      toast.success("Project settings saved");
      void queryClient.invalidateQueries({ queryKey: ["projects", project.id] });
      onClose();
    },
  });

  return (
    <ModalShell
      ariaLabel="Project settings"
      className="m-auto w-full max-w-lg"
      onClose={onClose}
      open={open}
    >
      <form
        className="flex flex-col gap-4 p-5 text-[#1b1b1b]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!mutation.isPending) {
            mutation.mutate();
          }
        }}
      >
        <h2 className="font-semibold text-[18px]">Project settings</h2>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-[#5f5f5f] text-[12px]">Master instructions</span>
          <textarea
            className="min-h-[120px] w-full resize-y rounded-lg border border-[#ececec] bg-white px-3 py-2 text-[#1b1b1b] text-[14px] outline-none focus:border-[#1b1b1b]/40"
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Persistent guidance applied to every run in this project."
            value={instructions}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium text-[#5f5f5f] text-[12px]">Default model</span>
          <input
            className="h-9 w-full rounded-lg border border-[#ececec] bg-white px-3 text-[#1b1b1b] text-[14px] outline-none focus:border-[#1b1b1b]/40"
            onChange={(event) => setModel(event.target.value)}
            placeholder="e.g. claude-sonnet-4-6 (leave blank for Auto)"
            value={model}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            className="rounded-full border border-[#ececec] px-4 py-1.5 font-medium text-[13px] hover:bg-[#f7f7f7]"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-full bg-[#1b1b1b] px-4 py-1.5 font-medium text-[13px] text-white hover:bg-black disabled:opacity-50"
            disabled={mutation.isPending}
            type="submit"
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
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
