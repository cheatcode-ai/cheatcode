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
  const threadId = threadIdProp ?? null;
  const queryClient = useQueryClient();
  const threadQuery = useThreadQuery(getToken, threadId);
  const projectId = threadQuery.data?.projectId ?? null;
  const projectQuery = useProjectQuery(getToken, projectId);
  const initialMessagesQuery = useThreadMessagesQuery(getToken, threadId);
  const { clearPromptParams, prompt } = useInitialChatPrompt(
    threadQuery.data ?? null,
    initialMessagesQuery.data ?? null,
  );
  const hasProject = projectId !== null;
  const workspaceLayoutClass = useWorkspaceLayoutClass(hasProject);
  const chatColumnClass = useChatColumnClass(hasProject);
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const hasPreviewSurface = getHasPreviewSurface({
    hasProject,
    previewUrl,
    sandboxStatus,
  });
  const deliverableCount = countDeliverables(initialMessagesQuery.data ?? []);

  useDraftSeed(threadId, prompt);
  useRefreshThreadProjectOnSandboxChange({
    previewUrl,
    projectId,
    queryClient,
    sandboxStatus,
    threadId,
  });

  if (initialMessagesQuery.isError || projectQuery.isError || threadQuery.isError) {
    return <ChatErrorState />;
  }
  if (!threadId || initialMessagesQuery.isPending) {
    return <ChatLoadingState />;
  }

  return (
    <div
      className={workspaceLayoutClass}
      data-computer-open={previewPanelOpen ? "true" : "false"}
      data-preview-surface={hasPreviewSurface ? "true" : "false"}
    >
      <section className={cn("cc-agent-chat-pane", chatColumnClass)}>
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
      <RunPanelDivider hasProject={hasProject} />
      <PreviewSidePanel
        deliverableCount={deliverableCount}
        project={projectQuery.data ?? null}
        threadId={threadId}
      />
    </div>
  );
}

function countDeliverables(messages: readonly CheatcodeUIMessage[]): number {
  let count = 0;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-artifact") {
        count += 1;
      }
    }
  }
  return count;
}

function getHasPreviewSurface(input: {
  hasProject: boolean;
  previewUrl: null | string;
  sandboxStatus: ReturnType<typeof useAppStore.getState>["sandboxStatus"];
}): boolean {
  return input.hasProject || input.previewUrl !== null || input.sandboxStatus !== "cold";
}

function useInitialChatPrompt(
  thread: Thread | null,
  initialMessages: CheatcodeUIMessage[] | null,
): { clearPromptParams: () => void; prompt: null | string } {
  const [urlState, setUrlState] = useQueryStates(PROMPT_URL_STATE, {
    history: "replace",
    shallow: true,
  });
  const handoffPrompt = usePromptHandoff(urlState.promptKey);
  const explicitPrompt = urlState.prompt ?? handoffPrompt ?? null;
  const awaitingPromptHandoff = Boolean(urlState.promptKey) && handoffPrompt === undefined;
  const prompt = resolveInitialPrompt({
    awaitingPromptHandoff,
    explicitPrompt,
    initialMessages,
    thread,
  });
  const clearPromptParams = useCallback(() => {
    if (!hasPromptUrlState(urlState)) {
      return;
    }
    void setUrlState({
      model: null,
      prompt: null,
      promptKey: null,
      repo: null,
      surface: null,
    });
  }, [setUrlState, urlState]);
  return { clearPromptParams, prompt };
}

function useDraftSeed(threadId: null | string, prompt: null | string): void {
  const setDraft = useAppStore((state) => state.setDraft);
  const consumedPromptRef = useRef<string | null>(null);
  useEffect(() => {
    if (!threadId || !prompt || consumedPromptRef.current === prompt) {
      return;
    }
    consumedPromptRef.current = prompt;
    setDraft(threadId, prompt);
  }, [prompt, setDraft, threadId]);
}

function useRefreshThreadProjectOnSandboxChange(input: {
  previewUrl: null | string;
  projectId: null | string;
  queryClient: ReturnType<typeof useQueryClient>;
  sandboxStatus: ReturnType<typeof useAppStore.getState>["sandboxStatus"];
  threadId: null | string;
}): void {
  const { previewUrl, projectId, queryClient, sandboxStatus, threadId } = input;
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
}

function hasPromptUrlState(
  urlState: Record<keyof typeof PROMPT_URL_STATE, null | string>,
): boolean {
  return Boolean(
    urlState.model ?? urlState.prompt ?? urlState.promptKey ?? urlState.repo ?? urlState.surface,
  );
}

function useWorkspaceLayoutClass(hasProject: boolean): string {
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const hasPreviewSurface = hasProject || previewUrl !== null || sandboxStatus !== "cold";
  return cn(
    "cc-agent-run-layout min-h-0 min-w-0 flex-1",
    hasPreviewSurface && previewPanelOpen
      ? "flex flex-col motion-reduce:transition-none md:flex-row"
      : null,
    hasPreviewSurface && !previewPanelOpen
      ? "flex flex-col motion-reduce:transition-none md:flex-row"
      : null,
    !hasPreviewSurface ? "flex" : null,
  );
}

function RunPanelDivider({ hasProject }: { hasProject: boolean }) {
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const hasPreviewSurface = hasProject || previewUrl !== null || sandboxStatus !== "cold";
  if (!hasPreviewSurface) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        "group relative z-10 hidden w-px shrink-0 cursor-col-resize transition-opacity duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none md:block",
        "cc-agent-run-divider",
        previewPanelOpen ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="absolute inset-y-0 left-1/2 w-4 -translate-x-1/2" />
    </div>
  );
}

function useChatColumnClass(hasProject: boolean): string {
  const previewUrl = useAppStore((state) => state.previewUrl);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const hasPreviewSurface = hasProject || previewUrl !== null || sandboxStatus !== "cold";
  return cn("flex min-w-0 flex-col", hasPreviewSurface ? "min-h-0" : "flex-1");
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

function resolveInitialPrompt(input: {
  awaitingPromptHandoff: boolean;
  explicitPrompt: null | string;
  initialMessages: CheatcodeUIMessage[] | null;
  thread: Thread | null;
}): null | string {
  if (input.explicitPrompt) {
    return input.explicitPrompt;
  }
  if (input.awaitingPromptHandoff) {
    return null;
  }
  return recoverPendingInitialPrompt(input.thread, input.initialMessages);
}

function recoverPendingInitialPrompt(
  thread: Thread | null,
  initialMessages: CheatcodeUIMessage[] | null,
): null | string {
  if (!thread || initialMessages === null || initialMessages.length > 0 || thread.activeRunId) {
    return null;
  }
  const pending = thread.pendingInitialPrompt?.trim();
  if (pending) {
    return pending;
  }
  const title = thread.title?.trim();
  if (!title || title === "New chat") {
    return null;
  }
  return title;
}
