import type { Thread } from "@cheatcode/types";
import type { ChatWorkspaceTab } from "@/lib/store/chat-tabs-store";

export type FolderChatResultStatus = "error" | "loading" | "ready";

export function tabsWithCurrent(
  tabs: readonly ChatWorkspaceTab[],
  projectId: null | string,
  threadId: string,
  title: string,
): readonly ChatWorkspaceTab[] {
  if (!projectId) return [{ id: threadId, projectId: "", title }];
  const existing = tabs.find((tab) => tab.id === threadId);
  if (!existing) return [...tabs, { id: threadId, projectId, title }];
  return tabs.map((tab) => (tab.id === threadId ? { ...tab, title } : tab));
}

export function filterFolderThreads(threads: readonly Thread[], query: string): readonly Thread[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return threads;
  return threads.filter((thread) => (thread.title ?? "New chat").toLowerCase().includes(trimmed));
}

export function folderChatResultStatus(
  isPending: boolean,
  isError: boolean,
): FolderChatResultStatus {
  if (isPending) return "loading";
  return isError ? "error" : "ready";
}
