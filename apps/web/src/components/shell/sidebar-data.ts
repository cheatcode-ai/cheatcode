"use client";

import type { NavigationBootstrapProject, SearchResultThread } from "@cheatcode/types/api";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getNavigationBootstrap } from "@/lib/api/project-thread";
import { sidebarKeys } from "@/lib/api/query-keys";

export interface SidebarChat {
  activeRunId: string | null;
  id: string;
  projectId: string | null;
  title: string | null;
}

export interface SidebarProject {
  href: string | null;
  id: string;
  name: string;
}

export interface SidebarChatCollection {
  isLoading: boolean;
  items: SidebarChat[];
}

export interface SidebarProjectCollection {
  isLoading: boolean;
  items: SidebarProject[];
}

export function useSidebarBootstrap(
  getToken: () => Promise<null | string>,
  activeThreadId: string | null,
  enabled: boolean,
) {
  const query = useQuery({
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => getNavigationBootstrap(getToken, activeThreadId, signal),
    queryKey: sidebarKeys.bootstrapFor(activeThreadId),
    retry: false,
    staleTime: 30_000,
  });
  const recentThreads = enabled ? (query.data?.recentThreads ?? []) : [];
  return {
    activeProjectId: activeProjectForThread(
      recentThreads,
      activeThreadId,
      query.isPlaceholderData ? null : (query.data?.activeProjectId ?? null),
    ),
    sidebarChats: sidebarChats(recentThreads, enabled && query.isPending),
    sidebarProjects: sidebarProjects(
      enabled ? (query.data?.projects ?? []) : [],
      enabled && query.isPending,
    ),
  };
}

function activeProjectForThread(
  recentThreads: readonly SearchResultThread[],
  activeThreadId: string | null,
  resolvedActiveProjectId: string | null,
): string | null {
  if (!activeThreadId) return null;
  const recentThread = recentThreads.find((thread) => thread.id === activeThreadId);
  return recentThread ? recentThread.projectId : resolvedActiveProjectId;
}

function sidebarChats(
  recentThreads: readonly SearchResultThread[],
  isLoading: boolean,
): SidebarChatCollection {
  return {
    isLoading,
    items: recentThreads.map((thread) => ({
      activeRunId: thread.activeRunId,
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
    })),
  };
}

function sidebarProjects(
  projects: readonly NavigationBootstrapProject[],
  isLoading: boolean,
): SidebarProjectCollection {
  return {
    isLoading,
    items: projects.map((project) => ({
      href: project.latestThreadId ? `/chats/${encodeURIComponent(project.latestThreadId)}` : null,
      id: project.id,
      name: project.name,
    })),
  };
}
