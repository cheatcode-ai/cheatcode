"use client";

import type { ProjectSummary, Thread } from "@cheatcode/types";
import { ConfirmDialog } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowUpRight,
  Check,
  Link as LinkIcon,
  type LucideIcon,
  Monitor,
  MoreHorizontal,
  Plus,
  Smartphone,
  Trash2,
} from "@/components/ui/icons";
import { deleteProject, listProjects, listProjectThreads } from "@/lib/api/project-thread";
import {
  activeRouteNavItems,
  isNavItemActive,
  type NavItem,
  WORKSPACE_NAV,
} from "@/lib/navigation/nav-model";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

const SEARCH_NAV_ITEM = WORKSPACE_NAV.find((item) => item.id === "search");
const SIDEBAR_LINK_ITEMS: readonly NavItem[] = [
  ...activeRouteNavItems("workspace"),
  ...activeRouteNavItems("footer"),
];

interface SidebarProject {
  appType: "general" | "mobile" | "web";
  href: string | null;
  id: string;
  name: string;
  threadId: string | null;
}

export function AppSidebar() {
  const { getToken } = useAuth();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const activeThreadId = searchParams.get("thread");
  const sidebarProjects = useSidebarProjects(getToken);
  const [pendingDelete, setPendingDelete] = useState<SidebarProject | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (project: SidebarProject) => deleteProject(getToken, project.id),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Project delete failed");
    },
    onSettled: () => {
      setPendingDelete(null);
    },
    onSuccess: (_result, project) => {
      toast.success(`Deleted ${project.name}`);
      void queryClient.invalidateQueries({ queryKey: ["sidebar-projects"] });
      void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
      if (pathname === "/projects" && activeThreadId === project.threadId) {
        router.push("/");
      }
    },
  });

  useEffect(() => {
    setSidebarOpen(false);
  }, [setSidebarOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "b" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSidebarOpen(!sidebarOpen);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setSidebarOpen, sidebarOpen]);

  return (
    <>
      {sidebarOpen ? (
        <button
          aria-label="Close sidebar"
          className="fixed inset-0 z-40 bg-background/20 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}
      <aside
        className={cn(
          "fixed top-0 bottom-0 left-0 z-50 flex w-64 flex-col border-zinc-800 border-r bg-zinc-950 transition-transform duration-300 ease-in-out",
          "[-ms-overflow-style:'none'] [scrollbar-width:'none'] [&::-webkit-scrollbar]:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="sticky top-0 z-10 flex h-16 items-center justify-center border-zinc-800 border-b bg-zinc-950/50 px-5 backdrop-blur-sm">
          <Link
            className="flex items-center transition-opacity hover:opacity-80"
            href="/"
            onClick={() => setSidebarOpen(false)}
            title="Home"
          >
            <Image
              alt="Cheatcode Logo"
              className="h-auto w-[110px] invert dark:invert-0"
              height={39}
              src="/logo-white.png"
              style={{ height: "auto" }}
              width={173}
            />
          </Link>
        </div>
        <div className="flex justify-center border-zinc-800 border-b p-4">
          <Link className="w-full max-w-[200px]" href="/">
            <span className="group relative flex w-full items-center justify-center gap-2 rounded-sm border border-transparent bg-white px-3 py-2 font-bold text-xs text-zinc-950 uppercase tracking-widest shadow-sm transition-colors duration-200 hover:bg-zinc-200">
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              <span>New Project</span>
            </span>
          </Link>
        </div>
        <nav className="chat-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="flex h-10 items-center justify-between border-zinc-800 border-b bg-zinc-950 px-4">
            <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              Projects
            </div>
            {sidebarProjects.hasSelectableProjects ? (
              <div className="flex items-center gap-2 text-zinc-500">
                <Check aria-hidden="true" className="h-3 w-3" />
              </div>
            ) : null}
          </div>
          <div className="space-y-0">
            {sidebarProjects.isLoading ? <ProjectSkeletonRows /> : null}
            {!sidebarProjects.isLoading && sidebarProjects.items.length === 0 ? (
              <div className="border-zinc-900 border-b px-4 py-8 text-center">
                <p className="font-mono text-xs text-zinc-600 uppercase tracking-wide">
                  No projects initialized
                </p>
              </div>
            ) : null}
            {sidebarProjects.items.map((project) => (
              <ProjectRow
                activeThreadId={activeThreadId}
                isDeleting={deleteMutation.isPending && deleteMutation.variables?.id === project.id}
                isActivePath={pathname === "/projects"}
                onDelete={setPendingDelete}
                key={project.id}
                onNavigate={() => setSidebarOpen(false)}
                project={project}
              />
            ))}
          </div>
        </nav>
        <div className="shrink-0 space-y-0 border-zinc-800 border-t bg-zinc-950 py-1">
          {SEARCH_NAV_ITEM ? (
            <SidebarActionRow
              icon={SEARCH_NAV_ITEM.icon}
              label={SEARCH_NAV_ITEM.label}
              onClick={() => {
                setCommandPaletteOpen(true);
                setSidebarOpen(false);
              }}
            />
          ) : null}
          {SIDEBAR_LINK_ITEMS.map((item) =>
            item.target.kind === "route" ? (
              <SidebarNavLink
                active={isNavItemActive(item, pathname)}
                href={item.target.href}
                icon={item.icon}
                key={item.id}
                label={item.label}
                onNavigate={() => setSidebarOpen(false)}
              />
            ) : null,
          )}
        </div>
      </aside>
      <ConfirmDialog
        busy={deleteMutation.isPending}
        cancelLabel="Cancel"
        confirmLabel="Delete project"
        description="This removes the project, its sandbox, and all generated files. Deployed previews stay live until they expire."
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate(pendingDelete);
          }
        }}
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : "Delete project?"}
      />
    </>
  );
}

function SidebarActionRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left font-medium text-sm text-zinc-500 transition-colors hover:bg-zinc-900/30 hover:text-white"
      onClick={onClick}
      type="button"
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function SidebarNavLink({
  active,
  href,
  icon: Icon,
  label,
  onNavigate,
}: {
  active: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2.5 font-medium text-sm transition-colors",
        active ? "text-white" : "text-zinc-500 hover:bg-zinc-900/30 hover:text-white",
      )}
      href={href}
      onClick={onNavigate}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function ProjectRow({
  activeThreadId,
  isDeleting,
  isActivePath,
  onDelete,
  onNavigate,
  project,
}: {
  activeThreadId: string | null;
  isDeleting: boolean;
  isActivePath: boolean;
  onDelete: (project: SidebarProject) => void;
  onNavigate: () => void;
  project: SidebarProject;
}) {
  const projectHref = project.href;
  const isActive = isActivePath && activeThreadId === project.threadId;
  const Icon = project.appType === "mobile" ? Smartphone : Monitor;
  const rowClassName = cn(
    "relative flex w-full items-center gap-3 border-zinc-800/50 border-b border-l-2 px-4 py-4 text-left transition-colors duration-150",
    isActive
      ? "border-l-white bg-zinc-900 text-white"
      : "border-l-transparent text-zinc-500 hover:bg-zinc-900/30 hover:text-white",
  );

  return (
    <div className="group/row relative">
      {projectHref ? (
        <Link className={rowClassName} href={projectHref} onClick={onNavigate}>
          <ProjectRowContent Icon={Icon} isActive={isActive} project={project} />
        </Link>
      ) : (
        <div className={cn(rowClassName, "cursor-default")}>
          <ProjectRowContent Icon={Icon} isActive={isActive} project={project} />
        </div>
      )}
      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-2 opacity-0 transition-opacity duration-200 group-hover/row:opacity-100">
        {projectHref ? (
          <>
            <button
              aria-label={`Copy link to ${project.name}`}
              className="flex h-6 w-6 items-center justify-center text-zinc-600 transition-colors hover:text-white"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                copyProjectLink(projectHref, project.name);
              }}
              type="button"
            >
              <LinkIcon aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
            <a
              aria-label={`Open ${project.name} in a new tab`}
              className="flex h-6 w-6 items-center justify-center text-zinc-600 transition-colors hover:text-white"
              href={projectHref}
              onClick={(event) => event.stopPropagation()}
              rel="noopener noreferrer"
              target="_blank"
            >
              <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
            </a>
          </>
        ) : null}
        <button
          aria-label={`Delete ${project.name}`}
          className={cn(
            "flex h-6 w-6 items-center justify-center text-zinc-700 transition-colors hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-45",
            isDeleting && "text-red-300",
          )}
          disabled={isDeleting}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete(project);
          }}
          type="button"
        >
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <span className="hidden h-6 w-6 items-center justify-center text-zinc-700 md:flex">
          <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function ProjectRowContent({
  Icon,
  isActive,
  project,
}: {
  Icon: typeof Monitor;
  isActive: boolean;
  project: SidebarProject;
}) {
  return (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          "h-4 w-4 shrink-0 transition-colors",
          isActive ? "text-white" : "text-zinc-600 group-hover/row:text-zinc-400",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate pr-16 font-medium text-sm",
          isActive ? "text-white" : "text-zinc-500 group-hover/row:text-zinc-300",
        )}
      >
        {project.name}
      </span>
    </>
  );
}

function ProjectSkeletonRows() {
  return (
    <>
      {["one", "two", "three"].map((key) => (
        <div
          className="h-12 w-full animate-pulse border-zinc-900 border-b bg-zinc-950/30"
          key={key}
        />
      ))}
    </>
  );
}

function useSidebarProjects(getToken: () => Promise<null | string>) {
  const projectsQuery = useQuery({
    queryFn: () => listProjects(getToken),
    queryKey: ["sidebar-projects"],
    retry: false,
    staleTime: 30_000,
  });
  const projects = projectsQuery.data ?? [];
  const threadQueries = useQueries({
    queries: projects.map((project) => ({
      enabled: projectsQuery.isSuccess,
      queryFn: () => listProjectThreads(getToken, project.id),
      queryKey: ["sidebar-project-threads", project.id] as const,
      retry: false,
      staleTime: 30_000,
    })),
  });
  const items = projects.map((project, index) =>
    sidebarProjectFromApi(project, threadQueries[index]?.data?.[0] ?? null),
  );

  return {
    hasSelectableProjects: items.some((project) => project.href !== null),
    isLoading: projectsQuery.isPending || threadQueries.some((query) => query.isPending),
    items,
  };
}

function sidebarProjectFromApi(project: ProjectSummary, thread: Thread | null): SidebarProject {
  return {
    appType: sidebarAppType(project.mode),
    href: thread ? `/projects?thread=${encodeURIComponent(thread.id)}` : null,
    id: project.id,
    name: project.name || "Unnamed Project",
    threadId: thread?.id ?? null,
  };
}

function copyProjectLink(href: string, projectName: string) {
  const url = `${window.location.origin}${href}`;
  void navigator.clipboard
    .writeText(url)
    .then(() => toast.success(`Copied ${projectName} link`))
    .catch(() => toast.error("Failed to copy link"));
}

function sidebarAppType(mode: string): "general" | "mobile" | "web" {
  if (mode === "app-builder-mobile") {
    return "mobile";
  }
  return mode === "app-builder" ? "web" : "general";
}
