"use client";

import {
  BrowserTakeoverResumeResultSchema,
  BrowserTakeoverResumeSchema,
  type BrowserTakeoverSession,
  BrowserTakeoverSessionSchema,
  type BrowserTakeoverStatus,
  BrowserTakeoverStatusSchema,
  type SandboxConsoleSnapshot,
  SandboxConsoleSnapshotSchema,
  type SandboxFileEntry,
  SandboxFileListSchema,
  type SandboxIdeSession,
  SandboxIdeSessionSchema,
  SandboxTerminalCommandSchema,
  type SandboxTerminalContext,
  SandboxTerminalContextSchema,
  type SandboxTerminalResult,
  SandboxTerminalResultSchema,
} from "@cheatcode/types";
import {
  API_REQUEST_TIMEOUT_MS,
  API_RESPONSE_LIMIT_BYTES,
  authorizedFetch,
  readBoundedJsonResponse,
} from "@/lib/api/authorized-fetch";

export interface SandboxConsoleQueryInput {
  lastPid?: string | undefined;
  processId?: string | undefined;
  stderrCursor: number;
  stdoutCursor: number;
  tail?: number | undefined;
}

export async function readSandboxConsole(
  getToken: () => Promise<null | string>,
  threadId: string,
  query: SandboxConsoleQueryInput,
  signal?: AbortSignal,
): Promise<SandboxConsoleSnapshot> {
  const response = await authorizedFetch(
    getToken,
    sandboxConsolePath(threadId, query),
    signal ? { signal } : {},
  );
  return SandboxConsoleSnapshotSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.console),
  );
}

export async function listSandboxFiles(
  getToken: () => Promise<null | string>,
  threadId: string,
  path: string,
  recursive = false,
  signal?: AbortSignal,
) {
  const response = await authorizedFetch(
    getToken,
    sandboxFilesPath(threadId, path, recursive),
    signal ? { signal } : {},
  );
  return SandboxFileListSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.files),
  );
}

export async function runSandboxTerminal(
  getToken: () => Promise<null | string>,
  threadId: string,
  command: string,
  cwd?: string,
): Promise<SandboxTerminalResult> {
  const body = SandboxTerminalCommandSchema.parse({
    command,
    ...(cwd === undefined ? {} : { cwd }),
  });
  const response = await authorizedFetch(
    getToken,
    sandboxTerminalPath(threadId),
    {
      body: JSON.stringify(body),
      method: "POST",
    },
    { timeoutMs: API_REQUEST_TIMEOUT_MS.terminal },
  );
  return SandboxTerminalResultSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.terminal),
  );
}

export async function readSandboxTerminalContext(
  getToken: () => Promise<null | string>,
  threadId: string,
  signal?: AbortSignal,
): Promise<SandboxTerminalContext> {
  const response = await authorizedFetch(
    getToken,
    sandboxTerminalContextPath(threadId),
    signal ? { signal } : {},
  );
  return SandboxTerminalContextSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

export async function openSandboxIde(
  getToken: () => Promise<null | string>,
  threadId: string,
  signal?: AbortSignal,
): Promise<SandboxIdeSession> {
  const response = await authorizedFetch(
    getToken,
    sandboxIdePath(threadId),
    signal ? { signal } : {},
    { timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning },
  );
  return SandboxIdeSessionSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

export async function readBrowserTakeoverStatus(
  getToken: () => Promise<null | string>,
  threadId: string,
  signal?: AbortSignal,
): Promise<BrowserTakeoverStatus> {
  const response = await authorizedFetch(
    getToken,
    browserTakeoverPath(threadId),
    signal ? { signal } : {},
  );
  return BrowserTakeoverStatusSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

export async function startBrowserTakeover(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<BrowserTakeoverSession> {
  const response = await authorizedFetch(
    getToken,
    `${browserTakeoverPath(threadId)}/start`,
    { method: "POST" },
    { timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning },
  );
  return BrowserTakeoverSessionSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

export async function resumeBrowserAutomation(
  getToken: () => Promise<null | string>,
  threadId: string,
  takeoverId: string,
): Promise<void> {
  const body = BrowserTakeoverResumeSchema.parse({ takeoverId });
  const response = await authorizedFetch(
    getToken,
    `${browserTakeoverPath(threadId)}/resume`,
    { body: JSON.stringify(body), method: "POST" },
    { timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning },
  );
  BrowserTakeoverResumeResultSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

export async function openComputerIde(
  getToken: () => Promise<null | string>,
  signal?: AbortSignal,
): Promise<SandboxIdeSession> {
  const response = await authorizedFetch(getToken, "/v1/computer/ide", signal ? { signal } : {}, {
    timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning,
  });
  return SandboxIdeSessionSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

export async function readComputerTerminalContext(
  getToken: () => Promise<null | string>,
  signal?: AbortSignal,
): Promise<SandboxTerminalContext> {
  const response = await authorizedFetch(
    getToken,
    "/v1/computer/terminal/context",
    signal ? { signal } : {},
  );
  return SandboxTerminalContextSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

export async function runComputerTerminal(
  getToken: () => Promise<null | string>,
  command: string,
  cwd?: string,
): Promise<SandboxTerminalResult> {
  const body = SandboxTerminalCommandSchema.parse({
    command,
    ...(cwd === undefined ? {} : { cwd }),
  });
  const response = await authorizedFetch(
    getToken,
    "/v1/computer/terminal",
    {
      body: JSON.stringify(body),
      method: "POST",
    },
    { timeoutMs: API_REQUEST_TIMEOUT_MS.terminal },
  );
  return SandboxTerminalResultSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.terminal),
  );
}

export function compareFileEntries(left: SandboxFileEntry, right: SandboxFileEntry): number {
  if (left.type === "directory" && right.type !== "directory") {
    return -1;
  }
  if (left.type !== "directory" && right.type === "directory") {
    return 1;
  }
  return left.relativePath.localeCompare(right.relativePath);
}

function sandboxFilesPath(threadId: string, path: string, recursive: boolean): string {
  const query = new URLSearchParams({ path, recursive: String(recursive) });
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/files?${query.toString()}`;
}

function browserTakeoverPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/browser-takeover`;
}

function sandboxTerminalPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/terminal`;
}

function sandboxTerminalContextPath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/terminal/context`;
}

function sandboxIdePath(threadId: string): string {
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/ide`;
}

function sandboxConsolePath(threadId: string, query: SandboxConsoleQueryInput): string {
  const params = new URLSearchParams({
    stderrCursor: String(query.stderrCursor),
    stdoutCursor: String(query.stdoutCursor),
  });
  if (query.lastPid !== undefined) {
    params.set("lastPid", query.lastPid);
  }
  if (query.processId !== undefined) {
    params.set("processId", query.processId);
  }
  if (query.tail !== undefined) {
    params.set("tail", String(query.tail));
  }
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/console?${params.toString()}`;
}
