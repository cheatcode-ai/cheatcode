"use client";

import type { SandboxFileEntry } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import type { ComposerMenuItem } from "@/components/composer/composer-popover";
import { compareFileEntries, listSandboxFiles } from "@/lib/api/sandbox";

const MAX_MENTION_ITEMS = 20;

/**
 * `@` file-mention source. Splits the query at its last `/` into a directory part
 * and a filter part, fetches that one directory via the existing files route
 * (one request per directory descent, never per keystroke), and filters
 * client-side. The query is `enabled` only when the caller confirms the sandbox is
 * ready (D4 sandbox-safety gate) so typing `@` can never create or wake a sandbox.
 */
export function useMentionFileItems({
  enabled,
  query,
  threadId,
}: {
  enabled: boolean;
  query: string;
  threadId: string;
}): ComposerMenuItem[] {
  const { getToken } = useAuth();
  const { dirPart, filterPart } = splitMentionQuery(query);
  const dirPath = workspacePath(dirPart);
  const {
    data: filesData,
    isError: filesIsError,
    isPending: filesIsPending,
  } = useQuery({
    enabled,
    queryFn: ({ signal }) => listSandboxFiles(getToken, threadId, dirPath, false, signal),
    queryKey: ["mention-files", threadId, dirPath],
    retry: false,
    staleTime: 30_000,
  });

  if (!enabled) {
    return [];
  }
  if (filesIsError) {
    return [disabledRow("mention-error", "No sandbox files yet")];
  }
  if (filesIsPending) {
    return [disabledRow("mention-loading", "Searching files…")];
  }
  return mentionItems(filesData.files, dirPart, filterPart);
}

function splitMentionQuery(query: string): { dirPart: string; filterPart: string } {
  const lastSlash = query.lastIndexOf("/");
  if (lastSlash === -1) {
    return { dirPart: "", filterPart: query };
  }
  return { dirPart: query.slice(0, lastSlash + 1), filterPart: query.slice(lastSlash + 1) };
}

function workspacePath(dirPart: string): string {
  const trimmed = dirPart.replace(/\/+$/, "");
  return trimmed.length === 0 ? "/workspace" : `/workspace/${trimmed}`;
}

function mentionItems(
  files: readonly SandboxFileEntry[],
  dirPart: string,
  filterPart: string,
): ComposerMenuItem[] {
  const needle = filterPart.toLowerCase();
  const matched = files
    .filter((entry) => entry.name.toLowerCase().includes(needle))
    .sort(compareFileEntries)
    .slice(0, MAX_MENTION_ITEMS);
  if (matched.length === 0) {
    return [disabledRow("mention-empty", "No matching files")];
  }
  return matched.map((entry) => mentionItem(entry, dirPart));
}

function mentionItem(entry: SandboxFileEntry, dirPart: string): ComposerMenuItem {
  const isDirectory = entry.type === "directory";
  const path = `${dirPart}${entry.name}`;
  return {
    hint: isDirectory ? "directory" : undefined,
    id: entry.path,
    insert: isDirectory ? `@${path}/` : `@${path} `,
    label: isDirectory ? `${entry.name}/` : entry.name,
    visual: isDirectory ? "directory" : archiveFile(entry.name) ? "archive" : "file",
  };
}

function disabledRow(id: string, label: string): ComposerMenuItem {
  return { disabled: true, id, insert: "", label, visual: "status" };
}

function archiveFile(name: string): boolean {
  return /\.(?:7z|bz2|gz|rar|tar|tgz|xz|zip)$/iu.test(name);
}
