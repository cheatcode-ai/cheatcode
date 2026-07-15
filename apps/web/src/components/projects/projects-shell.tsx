"use client";

import type { CheatcodeUIMessage, ProjectSummary, Thread } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryStates } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { PreviewSidePanel } from "@/components/preview/preview-side-panel";
import {
  ChatUnavailableState,
  WorkspaceLoadingState,
} from "@/components/workspace/workspace-route-state";
import { WorkspaceRunLayout } from "@/components/workspace/workspace-run-layout";
import {
  type CursorPage,
  getProject,
  getThread,
  listThreadMessagesPage,
} from "@/lib/api/project-thread";
import { consumePromptHandoff } from "@/lib/input/prompt-handoff";
import { useAppStore } from "@/lib/store/app-store";

const PROMPT_URL_STATE = {
  model: parseAsString,
  promptKey: parseAsString,
  repo: parseAsString,
  surface: parseAsString,
} as const;

export function ProjectsShell({ threadId: threadIdProp }: { threadId?: string }) {
  const shell = useProjectsShell(threadIdProp);
  if (shell.hasError) {
    return <ChatUnavailableState />;
  }
  if (!shell.threadId || shell.initialMessagesQuery.isPending) {
    return <WorkspaceLoadingState />;
  }
  return <ProjectsWorkspace shell={shell} threadId={shell.threadId} />;
}

function useProjectsShell(threadIdProp: string | undefined) {
  const { getToken } = useAuth();
  const threadId = threadIdProp ?? null;
  const queryClient = useQueryClient();
  const threadQuery = useThreadQuery(getToken, threadId);
  const projectId = threadQuery.data?.projectId ?? null;
  const projectQuery = useProjectQuery(getToken, projectId);
  const initialMessagesQuery = useThreadMessagesQuery(getToken, threadId);
  const initialMessages = useMemo(
    () => chronologicalMessages(initialMessagesQuery.data?.pages ?? []),
    [initialMessagesQuery.data?.pages],
  );
  const { clearPromptParams, prompt } = useInitialChatPrompt(
    threadQuery.data ?? null,
    initialMessagesQuery.isPending ? null : initialMessages,
  );
  const hasProject = projectId !== null;
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const hasPreviewSurface = hasProject || sandboxStatus !== "cold";
  const deliverableCount = countDeliverables(initialMessages);
  const loadOlderMessages = useCallback(async () => {
    const result = await initialMessagesQuery.fetchNextPage();
    return chronologicalMessages(result.data?.pages ?? []);
  }, [initialMessagesQuery.fetchNextPage]);

  useDraftSeed(threadId, prompt);
  useRefreshThreadProjectOnSandboxChange({
    projectId,
    queryClient,
    sandboxStatus,
    threadId,
  });
  return {
    clearPromptParams,
    deliverableCount,
    hasError: initialMessagesQuery.isError || projectQuery.isError || threadQuery.isError,
    hasPreviewSurface,
    initialMessages,
    initialMessagesQuery,
    loadOlderMessages,
    previewPanelOpen,
    projectQuery,
    prompt,
    threadId,
    threadQuery,
  };
}

function ProjectsWorkspace({
  shell,
  threadId,
}: {
  shell: ReturnType<typeof useProjectsShell>;
  threadId: string;
}) {
  return (
    <WorkspaceRunLayout
      computer={
        <PreviewSidePanel
          deliverableCount={shell.deliverableCount}
          project={shell.projectQuery.data ?? null}
          threadId={threadId}
        />
      }
      computerOpen={shell.previewPanelOpen}
      content={
        <ChatPanel
          activeRunId={shell.threadQuery.data?.activeRunId ?? null}
          autoSubmitPrompt={shell.prompt}
          hasOlderMessages={Boolean(shell.initialMessagesQuery.hasNextPage)}
          initialMessages={shell.initialMessages}
          isLoadingOlderMessages={shell.initialMessagesQuery.isFetchingNextPage}
          key={threadId}
          onLoadOlderMessages={shell.loadOlderMessages}
          onSubmitDraft={shell.clearPromptParams}
          project={shell.projectQuery.data ?? null}
          threadTitle={shell.threadQuery.data?.title ?? null}
          threadId={threadId}
        />
      }
      hasPreviewSurface={shell.hasPreviewSurface}
    />
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

function useInitialChatPrompt(
  thread: Thread | null,
  initialMessages: CheatcodeUIMessage[] | null,
): { clearPromptParams: () => void; prompt: null | string } {
  const [urlState, setUrlState] = useQueryStates(PROMPT_URL_STATE, {
    history: "replace",
    shallow: true,
  });
  const handoffPrompt = usePromptHandoff(urlState.promptKey);
  const explicitPrompt = handoffPrompt ?? null;
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
  projectId: null | string;
  queryClient: ReturnType<typeof useQueryClient>;
  sandboxStatus: ReturnType<typeof useAppStore.getState>["sandboxStatus"];
  threadId: null | string;
}): void {
  const { projectId, queryClient, sandboxStatus, threadId } = input;
  useEffect(() => {
    if (!threadId || sandboxStatus === "cold") {
      return;
    }
    void queryClient.invalidateQueries({ exact: true, queryKey: ["threads", threadId] });
    if (projectId) {
      void queryClient.invalidateQueries({ exact: true, queryKey: ["projects", projectId] });
    }
  }, [projectId, queryClient, sandboxStatus, threadId]);
}

function hasPromptUrlState(
  urlState: Record<keyof typeof PROMPT_URL_STATE, null | string>,
): boolean {
  return Boolean(urlState.model ?? urlState.promptKey ?? urlState.repo ?? urlState.surface);
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
  return useInfiniteQuery({
    enabled: shouldFetch,
    getNextPageParam: (page: CursorPage<CheatcodeUIMessage>) =>
      page.has_more ? (page.next_cursor ?? undefined) : undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listThreadMessagesPage(getToken, String(threadId), pageParam),
    queryKey: ["threads", threadId, "messages"],
    retry: false,
    staleTime: 5_000,
  });
}

function chronologicalMessages(
  pages: readonly CursorPage<CheatcodeUIMessage>[],
): CheatcodeUIMessage[] {
  return [...pages].reverse().flatMap((page) => page.data);
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
  return pending || null;
}
