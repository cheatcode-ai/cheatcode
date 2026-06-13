"use client";

import {
  type SandboxFile,
  type SandboxFileEntry,
  SandboxFileListSchema,
  SandboxFileSchema,
  SandboxFileWriteSchema,
  UpdateSandboxPathFileSchema,
} from "@cheatcode/types";
import { authorizedFetch } from "@/lib/api/authorized-fetch";

export async function listSandboxFiles(
  getToken: () => Promise<null | string>,
  threadId: string,
  path: string,
) {
  const response = await authorizedFetch(getToken, sandboxFilesPath(threadId, path));
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

function sandboxFilesPath(threadId: string, path: string): string {
  const query = new URLSearchParams({ path });
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/files?${query.toString()}`;
}

function sandboxFilePath(threadId: string, path: string): string {
  const query = new URLSearchParams({ path });
  return `/v1/threads/${encodeURIComponent(threadId)}/sandbox/file?${query.toString()}`;
}
