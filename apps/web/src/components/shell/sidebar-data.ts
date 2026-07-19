"use client";

import type { ProjectSummary, Thread } from "@cheatcode/types";
import { useQueries, useQuery } from "@tanstack/react-query";
import {
  getProject,
  getThread,
  listProjectsPage,
  listProjectThreadsPage,
  listRecentThreads,
} from "@/lib/api/project-thread";

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

export function useSidebarChats(getToken: () => Promise<null | string>, enabled: boolean) {
  const { data, isPending } = useQuery({
    enabled,
    queryFn: ({ signal }) => listRecentThreads(getToken, 20, signal),
    queryKey: ["sidebar-chats"],
    retry: false,
    staleTime: 30_000,
  });
  return {
    isLoading: enabled && isPending,
    items: enabled ? (data ?? []) : [],
  };
}

export function useActiveProjectId(
  getToken: () => Promise<null | string>,
  threadId: string | null,
  enabled: boolean,
): string | null {
  const threadQuery = useQuery({
    enabled: enabled && Boolean(threadId),
    queryFn: ({ signal }) => getThread(getToken, String(threadId), signal),
    queryKey: ["threads", threadId],
    retry: false,
    staleTime: 5_000,
  });
  return threadQuery.data?.projectId ?? null;
}

export function useSidebarProjects(
  getToken: () => Promise<null | string>,
  enabled: boolean,
  activeProjectId: string | null,
) {
  const projectsQuery = useQuery({
    enabled,
    queryFn: ({ signal }) => listProjectsPage(getToken, null, 6, signal),
    queryKey: ["sidebar-projects", "first-page"],
    retry: false,
    staleTime: 30_000,
  });
  const activeProjectQuery = useQuery({
    enabled: enabled && Boolean(activeProjectId),
    queryFn: ({ signal }) => getProject(getToken, String(activeProjectId), signal),
    queryKey: ["projects", activeProjectId],
    retry: false,
    staleTime: 5_000,
  });
  const projects = projectsWithActive(
    enabled ? (projectsQuery.data?.data ?? []) : [],
    activeProjectQuery.data ?? null,
  ).slice(0, 6);
  const threadQueries = useQueries({
    queries: projects.map((project) => ({
      enabled: enabled && projectsQuery.isSuccess,
      queryFn: ({ signal }) => listProjectThreadsPage(getToken, project.id, null, 1, signal),
      queryKey: ["sidebar-project-threads", project.id] as const,
      retry: false,
      staleTime: 30_000,
    })),
  });
  const items = projects.map((project, index) =>
    sidebarProjectFromApi(project, threadQueries[index]?.data?.data[0] ?? null),
  );

  return {
    isLoading:
      enabled &&
      (projectsQuery.isPending ||
        (Boolean(activeProjectId) && activeProjectQuery.isPending) ||
        threadQueries.some((query) => query.isPending)),
    items,
  };
}

function sidebarProjectFromApi(project: ProjectSummary, newest: Thread | null): SidebarProject {
  return {
    href: newest ? `/chats/${encodeURIComponent(newest.id)}` : null,
    id: project.id,
    name: project.name,
  };
}

function projectsWithActive(
  projects: readonly ProjectSummary[],
  activeProject: ProjectSummary | null,
): ProjectSummary[] {
  if (!activeProject) return [...projects];
  return [activeProject, ...projects.filter((project) => project.id !== activeProject.id)];
}
