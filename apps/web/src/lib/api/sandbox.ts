"use client";

import {
  type SandboxConsoleSnapshot,
  SandboxConsoleSnapshotSchema,
  type SandboxFile,
  type SandboxFileEntry,
  SandboxFileListSchema,
  SandboxFileSchema,
  SandboxFileWriteSchema,
  UpdateSandboxPathFileSchema,
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

export async function readSandboxFile(
  getToken: () => Promise<null | string>,
  threadId: string,
  path: string,
): Promise<SandboxFile> {
  const response = await authorizedFetch(getToken, sandboxFilePath(threadId, path));
  return SandboxFileSchema.parse(await response.json());
}

export async function updateSandboxFile(
  getToken: () => Promise<null | string>,
  threadId: string,
  path: string,
  content: string,
): Promise<SandboxFile> {
  const body = UpdateSandboxPathFileSchema.parse({ content, path });
  const response = await authorizedFetch(getToken, sandboxFilePath(threadId, path), {
    body: JSON.stringify(body),
    method: "PATCH",
  });
  const write = SandboxFileWriteSchema.parse(await response.json());
  return SandboxFileSchema.parse({
    content,
    encoding: body.encoding,
    path: write.path,
  });
}

export function sandboxFileQueryKey(threadId: string, path: string) {
  return ["sandbox-file", threadId, path] as const;
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

function sandboxFilePath(threadId: string, path: string): string {
  const query = new URLSearchParams({ path });
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/file?${query.toString()}`;
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
