import type { QueryClient } from "@tanstack/react-query";

export const threadKeys = {
  all: ["threads"] as const,
  detail: (threadId: string | null) => ["threads", threadId] as const,
  messages: (threadId: string | null) => ["threads", threadId, "messages"] as const,
};

export const projectKeys = {
  all: ["projects"] as const,
  detail: (projectId: string | null) => ["projects", projectId] as const,
};

export const sidebarKeys = {
  chats: ["sidebar-chats"] as const,
  projectFirstPage: ["sidebar-projects", "first-page"] as const,
  projectPicker: ["sidebar-projects", "picker"] as const,
  projectThreads: ["sidebar-project-threads"] as const,
  projectThreadsFor: (projectId: string) => ["sidebar-project-threads", projectId] as const,
  projects: ["sidebar-projects"] as const,
};

export async function invalidateChatLists(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: sidebarKeys.chats }),
    queryClient.invalidateQueries({ queryKey: sidebarKeys.projectThreads }),
    queryClient.invalidateQueries({ queryKey: sidebarKeys.projects }),
  ]);
}
