"use client";

import type { CheatcodeUIMessage, ProjectSummary, Thread } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { parseAsString, useQueryStates } from "nuqs";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { PreviewSidePanel } from "@/components/preview/preview-side-panel";
import {
  bootstrapProjectThread,
  getProject,
  getThread,
  listThreadMessages,
  type ProjectThreadBootstrapInput,
} from "@/lib/api/project-thread";
import { consumePromptHandoff } from "@/lib/input/prompt-handoff";
import { useAppStore } from "@/lib/store/app-store";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROJECT_URL_STATE = {
  model: parseAsString,
  new: parseAsString,
  prompt: parseAsString,
  promptKey: parseAsString,
  repo: parseAsString,
  surface: parseAsString,
  thread: parseAsString,
} as const;

export function ProjectsShell() {
  const { getToken } = useAuth();
  const [urlState, setUrlState] = useQueryStates(PROJECT_URL_STATE, {
    history: "replace",
    shallow: true,
  });
  const requestedThread = resolveThread(urlState.thread);
  const handoffPrompt = usePromptHandoff(urlState.promptKey);
  const isPromptHandoffPending = Boolean(urlState.promptKey && handoffPrompt === undefined);
  const prompt = urlState.prompt ?? handoffPrompt ?? null;
  const bootstrapNonceRef = useRef<string | null>(null);
  bootstrapNonceRef.current ??= createBootstrapNonce();
  const bootstrapInput = {
    ...(urlState.model ? { defaultModel: urlState.model } : {}),
    ...(urlState.repo ? { importRepoUrl: urlState.repo } : {}),
    prompt,
    surface: urlState.surface,
  } satisfies ProjectThreadBootstrapInput;
  const bootstrapQuery = useBootstrapProjectThreadQuery(
    getToken,
    bootstrapInput,
    requestedThread,
    urlState.new ?? bootstrapNonceRef.current,
    !isPromptHandoffPending,
  );
  const threadId = activeThreadId(requestedThread, bootstrapQuery.data?.threadId);
  const threadQuery = useThreadQuery(getToken, threadId, requestedThread.kind === "uuid");
  const projectId = bootstrapQuery.data?.projectId ?? threadQuery.data?.projectId ?? null;
  const projectQuery = useProjectQuery(getToken, projectId);
  const initialMessagesQuery = useThreadMessagesQuery(getToken, threadId);
  const setDraft = useAppStore((state) => state.setDraft);
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
    if (!bootstrapQuery.data || urlState.thread === bootstrapQuery.data.threadId) {
      return;
    }
    void setUrlState({ new: null, thread: bootstrapQuery.data.threadId });
  }, [bootstrapQuery.data, setUrlState, urlState.thread]);

  useEffect(() => {
    if (!threadId || !prompt || consumedPromptRef.current === prompt) {
      return;
    }
    consumedPromptRef.current = prompt;
    setDraft(threadId, prompt);
  }, [prompt, setDraft, threadId]);

  if (
    bootstrapQuery.isError ||
    initialMessagesQuery.isError ||
    projectQuery.isError ||
    threadQuery.isError
  ) {
    return <ProjectErrorState />;
  }
  if (!threadId) {
    return <ProjectLoadingState label="Preparing project" />;
  }
  if (initialMessagesQuery.isPending) {
    return <ProjectLoadingState label="Loading thread" />;
  }

  return (
    <>
      <section className="flex min-w-0 flex-1 flex-col">
        <ChatPanel
          autoSubmitPrompt={prompt}
          initialMessages={initialMessagesQuery.data ?? []}
          key={threadId}
          onSubmitDraft={clearPromptParams}
          project={projectQuery.data ?? null}
          threadId={threadId}
        />
      </section>
      <PreviewSidePanel project={projectQuery.data ?? null} threadId={threadId} />
    </>
  );
}

type RequestedThread = { kind: "missing" } | { kind: "uuid"; threadId: string };

function resolveThread(value: string | null): RequestedThread {
  if (!value) {
    return { kind: "missing" };
  }
  if (UUID_PATTERN.test(value)) {
    return { kind: "uuid", threadId: value };
  }
  return { kind: "missing" };
}

function activeThreadId(
  requestedThread: RequestedThread,
  bootstrapThreadId: string | undefined,
): null | string {
  if (requestedThread.kind === "uuid") {
    return requestedThread.threadId;
  }
  return bootstrapThreadId ?? null;
}

function useBootstrapProjectThreadQuery(
  getToken: () => Promise<null | string>,
  input: ProjectThreadBootstrapInput,
  requestedThread: RequestedThread,
  nonce: null | string,
  isEnabled: boolean,
) {
  return useQuery({
    enabled: requestedThread.kind === "missing" && isEnabled,
    queryFn: () => bootstrapProjectThread(getToken, input),
    queryKey: [
      "project-thread-bootstrap",
      input.defaultModel,
      input.importRepoUrl,
      input.prompt,
      input.surface,
      nonce,
    ],
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

function useThreadQuery(
  getToken: () => Promise<null | string>,
  threadId: null | string,
  enabled: boolean,
) {
  return useQuery<Thread>({
    enabled: Boolean(enabled && threadId),
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

function createBootstrapNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36);
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

function ProjectLoadingState({ label }: { label: string }) {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-thread-panel font-mono text-[10px] text-thread-text-muted uppercase tracking-[0.28em]">
      {label}
    </section>
  );
}

function ProjectErrorState() {
  return (
    <section className="flex min-w-0 flex-1 items-center justify-center bg-thread-panel font-mono text-[10px] text-red-300 uppercase tracking-[0.28em]">
      Project unavailable
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
