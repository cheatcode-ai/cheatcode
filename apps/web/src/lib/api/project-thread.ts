"use client";

import {
  type ApprovalDecisionRequest,
  type ApprovalDecisionResponse,
  ApprovalDecisionResponseSchema,
  type CheatcodeUIMessage,
  Paginated,
  type ProjectSummary,
  ProjectSummarySchema,
  RecentThreadsResponseSchema,
  type SandboxPreviewStatus,
  SandboxPreviewStatusSchema,
  type SandboxPreviewWake,
  SandboxPreviewWakeSchema,
  type SearchResultThread,
  type Thread,
  ThreadSchema,
  type UIMessageRecord,
  UIMessageRecordSchema,
  type UpdateProject,
  type UpdateThread,
} from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

const ThreadMessagePageSchema = Paginated(UIMessageRecordSchema);
const ProjectPageSchema = Paginated(ProjectSummarySchema);
const ThreadPageSchema = Paginated(ThreadSchema);

/**
 * The single chat-creation entry point. Project-less when `projectId` is omitted —
 * the chat's first run lazily creates + names the project — or attached to an
 * existing project when `projectId` is present. The launch intent
 * (`initialPrompt`/`mode`/`importRepoUrl`/`defaultModel`) rides the thread and is
 * consumed once, at first-run project creation.
 */
export async function createChat(
  getToken: () => Promise<null | string>,
  input: {
    defaultModel?: string;
    initialPrompt?: string;
    importRepoUrl?: string;
    mode?: string;
    projectId?: string;
    title?: string;
  },
): Promise<Thread> {
  const response = await authorizedFetch(getToken, "/v1/threads", {
    body: JSON.stringify(input),
    method: "POST",
  });
  return ThreadSchema.parse(await response.json());
}

// Wake the app preview when the Computer panel opens: starts a stopped sandbox and relaunches
// the dev server. Returns a fresh preview URL (empty when no dev server is tracked).
export async function wakeSandboxPreview(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<SandboxPreviewWake> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads/${encodeURIComponent(threadId)}/sandbox/preview/wake`,
    { method: "POST" },
  );
  return SandboxPreviewWakeSchema.parse(await response.json());
}

// Current sandbox lifecycle state (webhook-fed; falls back to a live read), polled while the
// Computer panel is open to detect a sandbox that idle-stopped mid-view.
export async function getSandboxPreviewStatus(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<SandboxPreviewStatus> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads/${encodeURIComponent(threadId)}/sandbox/preview/status`,
  );
  return SandboxPreviewStatusSchema.parse(await response.json());
}

export async function listProjects(
  getToken: () => Promise<null | string>,
): Promise<ProjectSummary[]> {
  const response = await authorizedFetch(getToken, "/v1/projects?limit=100");
  const page = ProjectPageSchema.parse(await response.json());
  return page.data;
}

export async function listProjectThreads(
  getToken: () => Promise<null | string>,
  projectId: string,
  limit = 5,
): Promise<Thread[]> {
  const response = await authorizedFetch(
    getToken,
    `/v1/projects/${encodeURIComponent(projectId)}/threads?limit=${limit}`,
  );
  const page = ThreadPageSchema.parse(await response.json());
  return page.data;
}

/** The user's recent chats (threads) across all projects, newest first — chat-first sidebar. */
export async function listRecentThreads(
  getToken: () => Promise<null | string>,
  limit = 20,
): Promise<SearchResultThread[]> {
  const response = await authorizedFetch(getToken, `/v1/threads?limit=${limit}`);
  return RecentThreadsResponseSchema.parse(await response.json()).threads;
}

export async function getProject(
  getToken: () => Promise<null | string>,
  projectId: string,
): Promise<ProjectSummary> {
  const response = await authorizedFetch(getToken, `/v1/projects/${encodeURIComponent(projectId)}`);
  return ProjectSummarySchema.parse(await response.json());
}

export async function getThread(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<Thread> {
  const response = await authorizedFetch(getToken, `/v1/threads/${encodeURIComponent(threadId)}`);
  return ThreadSchema.parse(await response.json());
}

export async function updateThread(
  getToken: () => Promise<null | string>,
  threadId: string,
  input: UpdateThread,
): Promise<Thread> {
  const response = await authorizedFetch(getToken, `/v1/threads/${encodeURIComponent(threadId)}`, {
    body: JSON.stringify(input),
    method: "PATCH",
  });
  return ThreadSchema.parse(await response.json());
}

export async function deleteThread(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
  });
}

export async function updateProject(
  getToken: () => Promise<null | string>,
  projectId: string,
  input: UpdateProject,
): Promise<ProjectSummary> {
  const response = await authorizedFetch(
    getToken,
    `/v1/projects/${encodeURIComponent(projectId)}`,
    {
      body: JSON.stringify(input),
      method: "PATCH",
    },
  );
  return ProjectSummarySchema.parse(await response.json());
}

export async function deleteProject(
  getToken: () => Promise<null | string>,
  projectId: string,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export async function cancelRun(
  getToken: () => Promise<null | string>,
  runId: string,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
}

export async function decideRunApproval(
  getToken: () => Promise<null | string>,
  runId: string,
  approvalId: string,
  body: ApprovalDecisionRequest,
): Promise<ApprovalDecisionResponse> {
  const response = await authorizedFetch(
    getToken,
    `/v1/runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
    { body: JSON.stringify(body), method: "POST" },
  );
  return ApprovalDecisionResponseSchema.parse(await response.json());
}

export async function listThreadMessages(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<CheatcodeUIMessage[]> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads/${encodeURIComponent(threadId)}/messages?limit=100`,
  );
  const page = ThreadMessagePageSchema.parse(await response.json());
  const messages: CheatcodeUIMessage[] = [];
  for (const record of page.data) {
    const message = messageRecordToUiMessage(record);
    if (isCheatcodeUIMessage(message)) {
      messages.push(message);
    }
  }
  return messages;
}

function messageRecordToUiMessage(record: UIMessageRecord): CheatcodeUIMessage | null {
  const role = uiMessageRole(record.role);
  if (!role) {
    return null;
  }
  return {
    id: record.id,
    parts: record.parts as CheatcodeUIMessage["parts"],
    role,
  };
}

function isCheatcodeUIMessage(value: CheatcodeUIMessage | null): value is CheatcodeUIMessage {
  return value !== null;
}

function uiMessageRole(value: string): CheatcodeUIMessage["role"] | null {
  if (value === "assistant" || value === "system" || value === "user") {
    return value;
  }
  return null;
}

/** Maps a composer build surface to the chat's launch-intent mode. */
export function surfaceToMode(
  surface: string | null,
): "app-builder" | "app-builder-mobile" | "general" {
  if (surface === "mobile") {
    return "app-builder-mobile";
  }
  return surface === "web" ? "app-builder" : "general";
}

/** Derives a chat's title from its first prompt; an empty/absent prompt reads "New chat". */
export function threadTitle(prompt: string | null): string {
  if (!prompt) {
    return "New chat";
  }
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 80) {
    return trimmed;
  }
  return `${trimmed.slice(0, 77).trim()}...`;
}
