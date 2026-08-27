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
  type SandboxIdeSession,
  SandboxIdeSessionSchema,
  type SandboxIdeStartupPhase,
  type SandboxIdeStartupStatus,
  SandboxIdeStartupStatusSchema,
  SandboxTerminalCommandSchema,
  type SandboxTerminalContext,
  SandboxTerminalContextSchema,
  type SandboxTerminalResult,
  SandboxTerminalResultSchema,
} from "@cheatcode/types/api";
import {
  API_REQUEST_TIMEOUT_MS,
  API_RESPONSE_LIMIT_BYTES,
  AuthorizedFetchError,
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
  options: SandboxIdeOpenOptions = {},
): Promise<SandboxIdeSession> {
  return openPreparedIde(getToken, sandboxIdePath(threadId), options);
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
  options: SandboxIdeOpenOptions = {},
): Promise<SandboxIdeSession> {
  return openPreparedIde(getToken, "/v1/computer/ide", options);
}

export interface SandboxIdeOpenOptions {
  onPhase?: (phase: SandboxIdeStartupPhase) => void;
  signal?: AbortSignal;
}

async function openPreparedIde(
  getToken: () => Promise<null | string>,
  path: string,
  options: SandboxIdeOpenOptions,
): Promise<SandboxIdeSession> {
  let status = await beginIdeStartup(getToken, path, options.signal);
  if (status === null) {
    return readIdeSession(getToken, path, options.signal);
  }
  options.onPhase?.(status.phase);
  while (isIdeStartupPending(status)) {
    await waitForIdePoll(status.retryAfterMs ?? 1_000, options.signal);
    status = await readIdeStartupStatus(getToken, path, status.operationId, options.signal);
    options.onPhase?.(status.phase);
  }
  if (status.phase === "failed") {
    throw new Error(status.message ?? "Files couldn't start. Try again.");
  }
  return readIdeSession(getToken, path, options.signal);
}

async function beginIdeStartup(
  getToken: () => Promise<null | string>,
  path: string,
  signal?: AbortSignal,
): Promise<SandboxIdeStartupStatus | null> {
  try {
    const response = await authorizedFetch(
      getToken,
      `${path}/open`,
      { method: "POST", ...(signal ? { signal } : {}) },
      { timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning },
    );
    return SandboxIdeStartupStatusSchema.parse(
      await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
    );
  } catch (error) {
    if (error instanceof AuthorizedFetchError && (error.status === 404 || error.status === 405)) {
      return null;
    }
    throw error;
  }
}

async function readIdeStartupStatus(
  getToken: () => Promise<null | string>,
  path: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<SandboxIdeStartupStatus> {
  const response = await authorizedFetch(
    getToken,
    `${path}/status/${encodeURIComponent(operationId)}`,
    signal ? { signal } : {},
    { timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning },
  );
  return SandboxIdeStartupStatusSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

async function readIdeSession(
  getToken: () => Promise<null | string>,
  path: string,
  signal?: AbortSignal,
): Promise<SandboxIdeSession> {
  const response = await authorizedFetch(getToken, path, signal ? { signal } : {}, {
    timeoutMs: API_REQUEST_TIMEOUT_MS.provisioning,
  });
  return SandboxIdeSessionSchema.parse(
    await readBoundedJsonResponse(response, API_RESPONSE_LIMIT_BYTES.sandboxMetadata),
  );
}

function isIdeStartupPending(status: SandboxIdeStartupStatus): boolean {
  return (
    status.phase === "queued" ||
    status.phase === "starting_sandbox" ||
    status.phase === "starting_files"
  );
}

function waitForIdePoll(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
