"use client";

import type { CheatcodeUIMessage, ProjectSummary, Thread } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryStates } from "nuqs";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { PreviewSidePanel } from "@/components/preview/preview-side-panel";
import { getProject, getThread, listThreadMessages } from "@/lib/api/project-thread";
import { consumePromptHandoff } from "@/lib/input/prompt-handoff";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

const PROMPT_URL_STATE = {
  model: parseAsString,
  prompt: parseAsString,
  promptKey: parseAsString,
  repo: parseAsString,
  surface: parseAsString,
} as const;

export function ProjectsShell({ threadId: threadIdProp }: { threadId?: string }) {
  const { getToken } = useAuth();
  const [urlState, setUrlState] = useQueryStates(PROMPT_URL_STATE, {
    history: "replace",
    shallow: true,
  });
  const threadId = threadIdProp ?? null;
  const handoffPrompt = usePromptHandoff(urlState.promptKey);
  const prompt = urlState.prompt ?? handoffPrompt ?? null;
  const queryClient = useQueryClient();
  const threadQuery = useThreadQuery(getToken, threadId);
  const projectId = threadQuery.data?.projectId ?? null;
  const projectQuery = useProjectQuery(getToken, projectId);
  const initialMessagesQuery = useThreadMessagesQuery(getToken, threadId);
  const workspaceLayoutClass = useWorkspaceLayoutClass();
  const chatColumnClass = useChatColumnClass();
  const setDraft = useAppStore((state) => state.setDraft);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const consumedPromptRef = useRef<string | null>(null);

  const clearPromptParams = useCallback(() => {
    const hadPromptParams = Boolean(
      urlState.model ?? urlState.prompt ?? urlState.promptKey ?? urlState.repo ?? urlState.surface,
    );
    if (!hadPromptParams) {
      return;
    }
    void setUrlState({
      model: null,
      prompt: null,
      promptKey: null,
      repo: null,
      surface: null,
    });
  }, [
    setUrlState,
    urlState.model,
    urlState.prompt,
    urlState.promptKey,
    urlState.repo,
    urlState.surface,
  ]);

  useEffect(() => {
    if (!threadId || !prompt || consumedPromptRef.current === prompt) {
      return;
    }
    consumedPromptRef.current = prompt;
    setDraft(threadId, prompt);
  }, [prompt, setDraft, threadId]);

  // A project-less chat materializes its project lazily on the first run (the
  // sandbox is keyed by projectId). Once that run provisions a sandbox — and
  // again as it settles and the preview comes up — the locally cached thread
  // and project are stale, so refetch them. This flips the derived project from
  // null to attached, surfacing the project name and the Computer panel.
  useEffect(() => {
    const sandboxActive = sandboxStatus !== "cold" || previewUrl !== null;
    if (!threadId || !sandboxActive) {
      return;
    }
    void queryClient.invalidateQueries({ exact: true, queryKey: ["threads", threadId] });
    if (projectId) {
      void queryClient.invalidateQueries({ exact: true, queryKey: ["projects", projectId] });
    }
  }, [previewUrl, projectId, queryClient, sandboxStatus, threadId]);

  if (initialMessagesQuery.isError || projectQuery.isError || threadQuery.isError) {
    return <ChatErrorState />;
  }
  if (!threadId || initialMessagesQuery.isPending) {
    return <ChatLoadingState />;
  }

  return (
    <div className={workspaceLayoutClass}>
      <section className={chatColumnClass}>
        <ChatPanel
          autoSubmitPrompt={prompt}
          initialMessages={initialMessagesQuery.data ?? []}
          key={threadId}
          onSubmitDraft={clearPromptParams}
          project={projectQuery.data ?? null}
          threadTitle={threadQuery.data?.title ?? null}
          threadId={threadId}
        />
      </section>
      <RunPanelDivider />
      <PreviewSidePanel project={projectQuery.data ?? null} threadId={threadId} />
    </div>
  );
}

function useWorkspaceLayoutClass(): string {
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const hasPreviewSurface = previewUrl !== null || sandboxStatus !== "cold";
  return cn(
    "min-h-0 min-w-0 flex-1",
    previewPanelOpen && hasPreviewSurface
      ? "grid grid-cols-1 md:grid-cols-[minmax(0,30fr)_1px_minmax(0,70fr)]"
      : "flex",
  );
}

function RunPanelDivider() {
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const hasPreviewSurface = previewUrl !== null || sandboxStatus !== "cold";
  if (!(previewPanelOpen && hasPreviewSurface)) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      className="group relative z-10 hidden w-px shrink-0 cursor-col-resize md:block"
    >
      <div className="absolute inset-y-0 left-1/2 w-4 -translate-x-1/2" />
    </div>
  );
}

function useChatColumnClass(): string {
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const hasPreviewSurface = previewUrl !== null || sandboxStatus !== "cold";
  return cn("flex min-w-0 flex-col", previewPanelOpen && hasPreviewSurface ? "min-h-0" : "flex-1");
}

function useThreadQuery(getToken: () => Promise<null | string>, threadId: null | string) {
  return useQuery<Thread>({
    enabled: Boolean(threadId),
    queryFn: () => getThread(getToken, String(threadId)),
    queryKey: ["threads", threadId],
    retry: false,
    staleTime: 5_000,
  });
}

function useProjectQuery(getToken: () => Promise<null | string>, projectId: null | string) {
  return useQuery<ProjectSummary>({
    enabled: Boolean(projectId),
    queryFn: () => getProject(getToken, String(projectId)),
    queryKey: ["projects", projectId],
    retry: false,
    staleTime: 5_000,
  });
}

function useThreadMessagesQuery(getToken: () => Promise<null | string>, threadId: null | string) {
  const shouldFetch = Boolean(threadId);
  return useQuery<CheatcodeUIMessage[]>({
    enabled: shouldFetch,
    ...(shouldFetch ? {} : { initialData: [] }),
    queryFn: () => listThreadMessages(getToken, String(threadId)),
    queryKey: ["threads", threadId, "messages"],
    retry: false,
    staleTime: 5_000,
  });
}

function ChatLoadingState() {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-thread-panel font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.28em]">
      Loading chat
    </section>
  );
}

function ChatErrorState() {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-thread-panel font-mono text-[10px] text-red-300 uppercase tracking-[0.28em]">
      Chat unavailable
    </section>
  );
}

function usePromptHandoff(promptKey: null | string): null | string | undefined {
  const [prompt, setPrompt] = useState<null | string | undefined>(promptKey ? undefined : null);
  useEffect(() => {
    if (!promptKey) {
      setPrompt(null);
      return;
    }
    setPrompt(consumePromptHandoff(promptKey));
  }, [promptKey]);
  return prompt;
}
