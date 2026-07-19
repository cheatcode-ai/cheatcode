"use client";

import {
  type CheatcodeUIMessage,
  coalesceTranscriptUIMessages,
  hasIncompleteTranscriptUIMessages,
  type ProjectSummary,
  type RunIntent,
  type Thread,
} from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryStates } from "nuqs";
import { useCallback, useEffect, useMemo } from "react";
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
import { usePromptHandoff } from "@/lib/hooks/use-prompt-handoff";
import { useAppStore } from "@/lib/store/app-store";

const PROMPT_URL_STATE = {
  intent: parseAsString,
  model: parseAsString,
  promptKey: parseAsString,
  repo: parseAsString,
  surface: parseAsString,
} as const;

export function ProjectsShell({ threadId: threadIdProp }: { threadId?: string }) {
  const shell = useProjectsShell(threadIdProp);
  if (shell.hasError) {
    return <ChatUnavailableState isRetrying={shell.isRetrying} onRetry={shell.retry} />;
  }
  if (
    !shell.threadId ||
    shell.initialMessagesQuery.isPending ||
    shell.initialMessagesQuery.isTranscriptContinuationPending
  ) {
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
  const retry = useProjectsRetry({ initialMessagesQuery, projectId, projectQuery, threadQuery });
  const initialMessages = useMemo(
    () => chronologicalMessages(initialMessagesQuery.data?.pages ?? []),
    [initialMessagesQuery.data?.pages],
  );
  const { clearPromptParams, prompt, runIntent } = useInitialChatPrompt(
    threadQuery.data ?? null,
    initialMessagesQuery.isPending ? null : initialMessages,
  );
  const hasProject = projectId !== null;
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const hasPreviewSurface = hasProject || sandboxStatus !== "cold";
  const deliverableCount = countDeliverables(initialMessages);
  const loadOlderMessages = useOlderThreadMessagesLoader(initialMessagesQuery);

  useRefreshThreadProjectOnSandboxChange({
    projectId,
    queryClient,
    sandboxStatus,
    threadId,
  });
  return {
    clearPromptParams,
    deliverableCount,
    hasError:
      initialMessagesQuery.isError ||
      initialMessagesQuery.hasTranscriptIntegrityError ||
      projectQuery.isError ||
      threadQuery.isError,
    hasPreviewSurface,
    initialMessages,
    initialMessagesQuery,
    isRetrying: retry.isRetrying,
    loadOlderMessages,
    previewPanelOpen,
    projectQuery,
    prompt,
    runIntent,
    retry: retry.run,
    threadId,
    threadQuery,
  };
}

function useProjectsRetry(input: {
  initialMessagesQuery: ReturnType<typeof useThreadMessagesQuery>;
  projectId: null | string;
  projectQuery: ReturnType<typeof useProjectQuery>;
  threadQuery: ReturnType<typeof useThreadQuery>;
}) {
  const run = useCallback(() => {
    const requests: Promise<unknown>[] = [
      input.threadQuery.refetch(),
      input.initialMessagesQuery.refetch(),
    ];
    if (input.projectId) {
      requests.push(input.projectQuery.refetch());
    }
    void Promise.all(requests);
  }, [
    input.initialMessagesQuery.refetch,
    input.projectId,
    input.projectQuery.refetch,
    input.threadQuery.refetch,
  ]);
  return {
    isRetrying:
      input.initialMessagesQuery.isFetching ||
      input.projectQuery.isFetching ||
      input.threadQuery.isFetching,
    run,
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
          activeRunId={shell.threadQuery.data?.activeRunId ?? null}
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
          initialRunIntent={shell.runIntent}
          key={threadId}
          latestModelId={shell.threadQuery.data?.latestModelId ?? null}
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
): { clearPromptParams: () => void; prompt: null | string; runIntent: RunIntent | null } {
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
  const runIntent = urlState.intent === "skill-creator" ? urlState.intent : null;
  const clearPromptParams = useCallback(() => {
    if (!hasPromptUrlState(urlState)) {
      return;
    }
    void setUrlState({
      intent: null,
      model: null,
      promptKey: null,
      repo: null,
      surface: null,
    });
  }, [setUrlState, urlState]);
  return { clearPromptParams, prompt, runIntent };
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
  return Boolean(
    urlState.intent ?? urlState.model ?? urlState.promptKey ?? urlState.repo ?? urlState.surface,
  );
}

function useThreadQuery(getToken: () => Promise<null | string>, threadId: null | string) {
  return useQuery<Thread>({
    enabled: Boolean(threadId),
    queryFn: ({ signal }) => getThread(getToken, String(threadId), signal),
    queryKey: ["threads", threadId],
    retry: false,
    staleTime: 5_000,
  });
}

function useProjectQuery(getToken: () => Promise<null | string>, projectId: null | string) {
  return useQuery<ProjectSummary>({
    enabled: Boolean(projectId),
    queryFn: ({ signal }) => getProject(getToken, String(projectId), signal),
    queryKey: ["projects", projectId],
    retry: false,
    staleTime: 5_000,
  });
}

function useThreadMessagesQuery(getToken: () => Promise<null | string>, threadId: null | string) {
  const shouldFetch = Boolean(threadId);
  const query = useInfiniteQuery({
    enabled: shouldFetch,
    getNextPageParam: (page: CursorPage<CheatcodeUIMessage>) =>
      page.has_more ? (page.next_cursor ?? undefined) : undefined,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      listThreadMessagesPage(getToken, String(threadId), pageParam, signal),
    queryKey: ["threads", threadId, "messages"],
    retry: false,
    staleTime: 5_000,
  });
  const loaded = query.data?.pages.flatMap((page) => page.data) ?? [];
  const hasIncompleteTranscript = hasIncompleteTranscriptUIMessages(loaded);
  const isTranscriptContinuationPending =
    hasIncompleteTranscript &&
    !query.isFetchNextPageError &&
    (query.hasNextPage || query.isFetchingNextPage);
  const hasTranscriptIntegrityError =
    hasIncompleteTranscript &&
    query.data !== undefined &&
    !query.hasNextPage &&
    !query.isFetchingNextPage;
  useEffect(() => {
    if (
      hasIncompleteTranscript &&
      query.hasNextPage &&
      !query.isFetchingNextPage &&
      !query.isFetchNextPageError
    ) {
      void query.fetchNextPage();
    }
  }, [
    hasIncompleteTranscript,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchNextPageError,
    query.isFetchingNextPage,
  ]);
  return { ...query, hasTranscriptIntegrityError, isTranscriptContinuationPending };
}

function useOlderThreadMessagesLoader(query: ReturnType<typeof useThreadMessagesQuery>) {
  return useCallback(async () => {
    let result = await query.fetchNextPage();
    while (
      !result.isError &&
      !result.isFetchNextPageError &&
      result.hasNextPage &&
      hasIncompleteTranscriptUIMessages(result.data?.pages.flatMap((page) => page.data) ?? [])
    ) {
      result = await query.fetchNextPage();
    }
    return chronologicalMessages(result.data?.pages ?? []);
  }, [query.fetchNextPage]);
}

function chronologicalMessages(
  pages: readonly CursorPage<CheatcodeUIMessage>[],
): CheatcodeUIMessage[] {
  return coalesceTranscriptUIMessages([...pages].reverse().flatMap((page) => page.data));
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
