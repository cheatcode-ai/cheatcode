"use client";

import {
  AgentRunId,
  CHEATCODE_DATA_SCHEMAS,
  type CheatcodeUIMessage,
  Paginated,
  type ProjectMode,
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
import { safeValidateUIMessages } from "ai";
import {
  API_REQUEST_TIMEOUT_MS,
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  consumeBoundedResponse,
  readBoundedBlobResponse,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

const ThreadMessagePageSchema = Paginated(UIMessageRecordSchema);
const ProjectPageSchema = Paginated(ProjectSummarySchema);
const ThreadPageSchema = Paginated(ThreadSchema);
const PROJECT_ARCHIVE_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/x-zip-compressed",
  "application/zip",
]);

export interface CursorPage<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * The single chat-creation entry point. Project-less when `projectId` is omitted —
 * the first workspace-backed tool lazily creates + names the project — or attached
 * to an existing project when `projectId` is present. The launch intent
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
  return ThreadSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  );
}

// Wake the app preview when the Computer panel opens: starts a stopped sandbox and relaunches
// the dev server. Returns a fresh preview URL (empty when no dev server is tracked).
export async function wakeSandboxPreview(
  getToken: () => Promise<null | string>,
  threadId: string,
  signal?: AbortSignal,
): Promise<SandboxPreviewWake> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads/${encodeURIComponent(threadId)}/sandbox/preview/wake`,
    { method: "POST", ...(signal ? { signal } : {}) },
    { timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning },
  );
  return SandboxPreviewWakeSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

// Current sandbox lifecycle state (webhook-fed; falls back to a live read), polled while the
// Computer panel is open to detect a sandbox that idle-stopped mid-view.
export async function getSandboxPreviewStatus(
  getToken: () => Promise<null | string>,
  threadId: string,
  signal?: AbortSignal,
): Promise<SandboxPreviewStatus> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads/${encodeURIComponent(threadId)}/sandbox/preview/status`,
    signal ? { signal } : {},
  );
  return SandboxPreviewStatusSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

export async function listProjectsPage(
  getToken: () => Promise<null | string>,
  cursor: string | null = null,
  limit = 25,
  signal?: AbortSignal,
): Promise<CursorPage<ProjectSummary>> {
  const response = await authorizedFetch(
    getToken,
    paginatedPath("/v1/projects", limit, cursor),
    signal ? { signal } : {},
  );
  return ProjectPageSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.collections),
  );
}

export async function listProjectThreadsPage(
  getToken: () => Promise<null | string>,
  projectId: string,
  cursor: string | null = null,
  limit = 25,
  signal?: AbortSignal,
): Promise<CursorPage<Thread>> {
  const path = `/v1/projects/${encodeURIComponent(projectId)}/threads`;
  const response = await authorizedFetch(
    getToken,
    paginatedPath(path, limit, cursor),
    signal ? { signal } : {},
  );
  return ThreadPageSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.collections),
  );
}

/** The user's recent chats (threads) across all projects, newest first — chat-first sidebar. */
export async function listRecentThreads(
  getToken: () => Promise<null | string>,
  limit = 20,
  signal?: AbortSignal,
): Promise<SearchResultThread[]> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads?limit=${limit}`,
    signal ? { signal } : {},
  );
  return RecentThreadsResponseSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  ).threads;
}

export async function getProject(
  getToken: () => Promise<null | string>,
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectSummary> {
  const response = await authorizedFetch(
    getToken,
    `/v1/projects/${encodeURIComponent(projectId)}`,
    signal ? { signal } : {},
  );
  return ProjectSummarySchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  );
}

export async function getThread(
  getToken: () => Promise<null | string>,
  threadId: string,
  signal?: AbortSignal,
): Promise<Thread> {
  const response = await authorizedFetch(
    getToken,
    `/v1/threads/${encodeURIComponent(threadId)}`,
    signal ? { signal } : {},
  );
  return ThreadSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  );
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
  return ThreadSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  );
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
  return ProjectSummarySchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.metadata),
  );
}

export async function deleteProject(
  getToken: () => Promise<null | string>,
  projectId: string,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export async function downloadProjectArchive(
  getToken: () => Promise<null | string>,
  projectId: string,
  fallbackName: string,
): Promise<boolean> {
  const suggestedName = projectArchiveFilename(null, fallbackName);
  const picker = saveFilePicker();
  if (picker) {
    const fileHandle = await pickArchiveDestination(picker, suggestedName);
    if (!fileHandle) {
      return false;
    }
    const response = await fetchProjectArchive(getToken, projectId);
    assertProjectArchiveContentType(response.headers.get("Content-Type"));
    await streamArchiveToFile(response, fileHandle);
    return true;
  }

  const response = await fetchProjectArchive(getToken, projectId);
  assertProjectArchiveContentType(response.headers.get("Content-Type"));
  await downloadArchiveWithBoundedBlob(response, fallbackName);
  return true;
}

async function fetchProjectArchive(
  getToken: () => Promise<null | string>,
  projectId: string,
): Promise<Response> {
  return authorizedFetch(
    getToken,
    `/v1/projects/${encodeURIComponent(projectId)}/download`,
    {
      method: "POST",
    },
    { timeoutMs: API_REQUEST_TIMEOUT_MS.archive },
  );
}

async function downloadArchiveWithBoundedBlob(
  response: Response,
  fallbackName: string,
): Promise<void> {
  let blob: Blob;
  try {
    blob = await readBoundedBlobResponse(response, API_RESPONSE_LIMIT_BYTES.archiveFallback);
  } catch (error) {
    if (error instanceof Error && error.name === "ResponseTooLargeError") {
      throw new Error(
        "This project is too large for an in-memory download in this browser. Use Chrome or Edge to stream it directly to disk.",
      );
    }
    throw error;
  }
  const filename = projectArchiveFilename(
    response.headers.get("Content-Disposition"),
    fallbackName,
  );
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

type SaveFilePicker = (options: {
  suggestedName: string;
  types: Array<{ accept: Record<string, string[]>; description: string }>;
}) => Promise<FileSystemFileHandle>;

function saveFilePicker(): SaveFilePicker | null {
  const candidate = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  return typeof candidate === "function" ? candidate.bind(window) : null;
}

async function pickArchiveDestination(
  picker: SaveFilePicker,
  suggestedName: string,
): Promise<FileSystemFileHandle | null> {
  try {
    return await picker({
      suggestedName,
      types: [
        {
          accept: { "application/zip": [".zip"] },
          description: "ZIP archive",
        },
      ],
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    throw error;
  }
}

async function streamArchiveToFile(
  response: Response,
  fileHandle: FileSystemFileHandle,
): Promise<void> {
  const writable = await fileHandle.createWritable();
  try {
    const bytesWritten = await consumeBoundedResponse(
      response,
      API_RESPONSE_LIMIT_BYTES.archive,
      (chunk) => writable.write(chunk),
    );
    if (bytesWritten === 0) {
      throw new Error("Project download returned an empty archive.");
    }
    await writable.close();
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }
}

function projectArchiveFilename(disposition: string | null, fallbackName: string): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  let candidate: string | null = null;
  if (encoded) {
    try {
      candidate = decodeURIComponent(encoded);
    } catch {
      // Fall through to the plain filename or the local project name.
    }
  }
  candidate ??= disposition?.match(/filename="([^"]+)"/iu)?.[1] ?? fallbackName;
  const basename = candidate.split(/[\\/]/u).at(-1) ?? "";
  const safeStem = basename
    .replace(/\.zip$/iu, "")
    .trim()
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^[-.]+|[-.]+$/gu, "")
    .slice(0, 180);
  return `${safeStem || "cheatcode-project"}.zip`;
}

function assertProjectArchiveContentType(header: string | null): void {
  const mediaType = header?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType && !PROJECT_ARCHIVE_CONTENT_TYPES.has(mediaType)) {
    throw new Error("Project download returned an unexpected file type.");
  }
}

export async function cancelRun(
  getToken: () => Promise<null | string>,
  runId: string,
): Promise<void> {
  await authorizedFetch(getToken, `/v1/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
}

export async function listThreadMessagesPage(
  getToken: () => Promise<null | string>,
  threadId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<CursorPage<CheatcodeUIMessage>> {
  const page = await listThreadMessageRecordsPage(getToken, threadId, cursor, signal);
  const messages = await Promise.all(page.data.map(messageRecordToUiMessage));
  return { ...page, data: messages.filter(isCheatcodeUIMessage) };
}

export async function listThreadMessageRecordsPage(
  getToken: () => Promise<null | string>,
  threadId: string,
  cursor: string | null = null,
  signal?: AbortSignal,
): Promise<CursorPage<UIMessageRecord>> {
  const response = await authorizedFetch(
    getToken,
    paginatedPath(`/v1/threads/${encodeURIComponent(threadId)}/messages`, 100, cursor),
    signal ? { signal } : {},
  );
  const page = ThreadMessagePageSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.messages),
  );
  return page;
}

function paginatedPath(path: string, limit: number, cursor: string | null): string {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return `${path}?${query.toString()}`;
}

async function messageRecordToUiMessage(
  record: UIMessageRecord,
): Promise<CheatcodeUIMessage | null> {
  const role = uiMessageRole(record.role);
  if (!role) {
    return null;
  }
  const parsed = await safeValidateUIMessages<CheatcodeUIMessage>({
    dataSchemas: CHEATCODE_DATA_SCHEMAS,
    messages: [{ id: record.id, parts: record.parts, role }],
  });
  const message = parsed.success ? (parsed.data[0] ?? null) : null;
  if (message?.role !== "assistant" || !record.agentRunId) {
    return message;
  }
  const agentRunId = AgentRunId(record.agentRunId);
  return {
    ...message,
    id: agentRunId,
    metadata: {
      runId: agentRunId,
      transcriptSegment: {
        agentRunId,
        index: record.agentRunSegment,
        isFinal: record.agentRunSegmentFinal,
      },
    },
  };
}

function isCheatcodeUIMessage(value: CheatcodeUIMessage | null): value is CheatcodeUIMessage {
  return value !== null;
}

function uiMessageRole(value: string): CheatcodeUIMessage["role"] | null {
  if (value === "assistant" || value === "user") {
    return value;
  }
  return null;
}

/** Maps a composer build surface to the chat's launch-intent mode. */
export function surfaceToMode(surface: string | null): ProjectMode {
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
