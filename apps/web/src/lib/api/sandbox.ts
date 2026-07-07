"use client";

import {
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
import { authorizedFetch } from "@/lib/api/authorized-fetch";

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
): Promise<SandboxConsoleSnapshot> {
  const response = await authorizedFetch(getToken, sandboxConsolePath(threadId, query));
  return SandboxConsoleSnapshotSchema.parse(await response.json());
}

export async function listSandboxFiles(
  getToken: () => Promise<null | string>,
  threadId: string,
  path: string,
  recursive = false,
) {
  const response = await authorizedFetch(getToken, sandboxFilesPath(threadId, path, recursive));
  return SandboxFileListSchema.parse(await response.json());
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
  const response = await authorizedFetch(getToken, sandboxTerminalPath(threadId), {
    body: JSON.stringify(body),
    method: "POST",
  });
  return SandboxTerminalResultSchema.parse(await response.json());
}

export async function readSandboxTerminalContext(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<SandboxTerminalContext> {
  const response = await authorizedFetch(getToken, sandboxTerminalContextPath(threadId));
  return SandboxTerminalContextSchema.parse(await response.json());
}

export async function openSandboxIde(
  getToken: () => Promise<null | string>,
  threadId: string,
): Promise<SandboxIdeSession> {
  const response = await authorizedFetch(getToken, sandboxIdePath(threadId));
  return SandboxIdeSessionSchema.parse(await response.json());
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
