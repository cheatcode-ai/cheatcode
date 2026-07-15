import type { CheatcodeUIMessage, ProjectSummary, UIMessageRecord } from "@cheatcode/types";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { buildExistingProjectParams, launchIntoProject } from "@/lib/api/home-launch";
import {
  threadTitle as buildThreadTitle,
  createChat,
  getThread,
  listThreadMessageRecordsPage,
  updateThread,
} from "@/lib/api/project-thread";

export interface PendingSubmission {
  messageId: string;
  restoreToComposer: boolean;
  submittedAt: number;
  text: string;
}

export interface PromptRouter {
  push: (href: string) => void;
}

export type SetChatMessages = (
  messages: CheatcodeUIMessage[] | ((messages: CheatcodeUIMessage[]) => CheatcodeUIMessage[]),
) => void;

export function mergeLoadedMessageHistory(
  loadedMessages: readonly CheatcodeUIMessage[],
  currentMessages: readonly CheatcodeUIMessage[],
): CheatcodeUIMessage[] {
  const currentById = new Map(currentMessages.map((message) => [message.id, message]));
  const loadedIds = new Set(loadedMessages.map((message) => message.id));
  return [
    ...loadedMessages.map((message) => currentById.get(message.id) ?? message),
    ...currentMessages.filter((message) => !loadedIds.has(message.id)),
  ];
}

export async function reconcileFailedSubmission(input: {
  clearError: () => void;
  getToken: () => Promise<null | string>;
  pending: PendingSubmission;
  queryClient: QueryClient;
  resumeStream: () => Promise<void>;
  setDraft: (threadId: string, value: string) => void;
  setMessages: SetChatMessages;
  threadId: string;
}): Promise<void> {
  const accepted = await submissionWasAccepted(input.getToken, input.threadId, input.pending);
  input.clearError();
  if (accepted) {
    await input.queryClient.invalidateQueries({ queryKey: ["threads", input.threadId] });
    await input.resumeStream();
    return;
  }
  input.setMessages((messages) =>
    messages.filter((message) => message.id !== input.pending.messageId),
  );
  if (input.pending.restoreToComposer) {
    input.setDraft(input.threadId, input.pending.text);
  }
}

export async function routePromptToProjectTarget(input: {
  getToken: () => Promise<null | string>;
  prompt: string;
  queryClient: QueryClient;
  router: PromptRouter;
  selectedModel: null | string;
  setDraft: (threadId: string, value: string) => void;
  targetProject: ProjectSummary | null;
  threadId: string;
}): Promise<boolean> {
  try {
    const targetThreadId = input.targetProject
      ? await threadIdForExistingProject(input.getToken, input.targetProject, input.prompt)
      : await threadIdForNewProject(input.getToken, input.prompt, input.selectedModel);
    if (!targetThreadId) {
      return false;
    }
    completeProjectTargetNavigation(input, targetThreadId);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Could not open that folder.");
    return false;
  }
}

export async function titleChatFromFirstPrompt(
  getToken: () => Promise<null | string>,
  queryClient: QueryClient,
  threadId: string,
  prompt: string,
): Promise<void> {
  try {
    const updated = await updateThread(getToken, threadId, { title: buildThreadTitle(prompt) });
    queryClient.setQueryData(["threads", threadId], updated);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] }),
      queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] }),
      queryClient.invalidateQueries({ queryKey: ["folder-chats", updated.projectId] }),
    ]);
  } catch {
    // A title failure must never block or roll back a successfully submitted prompt.
  }
}

async function submissionWasAccepted(
  getToken: () => Promise<null | string>,
  threadId: string,
  pending: PendingSubmission,
): Promise<boolean> {
  const [threadResult, recordsResult] = await Promise.allSettled([
    getThread(getToken, threadId),
    listThreadMessageRecordsPage(getToken, threadId),
  ]);
  if (recordsResult.status === "fulfilled") {
    return recordsResult.value.data.some((record) => matchesPendingSubmission(record, pending));
  }
  return threadResult.status === "fulfilled" && threadResult.value.activeRunId !== null;
}

function matchesPendingSubmission(record: UIMessageRecord, pending: PendingSubmission): boolean {
  const createdAt = Date.parse(record.createdAt);
  return (
    record.role === "user" &&
    record.agentRunId !== null &&
    Number.isFinite(createdAt) &&
    createdAt >= pending.submittedAt - 5_000 &&
    messageRecordText(record) === pending.text
  );
}

function messageRecordText(record: UIMessageRecord): string {
  return record.parts
    .map((part) => (part.type === "text" && typeof part["text"] === "string" ? part["text"] : ""))
    .join("");
}

function completeProjectTargetNavigation(
  input: Parameters<typeof routePromptToProjectTarget>[0],
  targetThreadId: string,
): void {
  const handoff = buildExistingProjectParams(input.prompt).toString();
  input.setDraft(input.threadId, "");
  void input.queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
  void input.queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
  input.router.push(`/chats/${encodeURIComponent(targetThreadId)}?${handoff}`);
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
    title: buildThreadTitle(prompt),
    ...(selectedModel ? { defaultModel: selectedModel } : {}),
  });
  return thread.id;
}
