"use client";

import type { ProjectSummary, Thread } from "@cheatcode/types";
import { ConfirmDialog, ModalShell } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Monitor, Pencil, Plus, Search, Smartphone, Trash2 } from "@/components/ui/icons";
import {
  deleteProject,
  listProjects,
  listProjectThreads,
  updateProject,
} from "@/lib/api/project-thread";
import { cn } from "@/lib/ui/cn";

interface ProjectGridItem {
  appType: "general" | "mobile" | "web";
  href: null | string;
  id: string;
  name: string;
  updatedAt: string;
}

export function ProjectsList() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const { isLoading, items } = useProjectsGrid(getToken);
  const [search, setSearch] = useState("");
  const [pendingRename, setPendingRename] = useState<ProjectGridItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectGridItem | null>(null);

  const invalidateProjects = () => {
    void queryClient.invalidateQueries({ queryKey: ["sidebar-projects"] });
    void queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] });
    void queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] });
  };

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateProject(getToken, id, { name }),
    onError: () => toast.error("Couldn't rename that project."),
    onSuccess: () => {
      invalidateProjects();
      setPendingRename(null);
      toast.success("Project renamed.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProject(getToken, id),
    onError: () => toast.error("Couldn't delete that project."),
    onSuccess: () => {
      invalidateProjects();
      setPendingDelete(null);
      toast.success("Project deleted.");
    },
  });

  const filtered = useMemo(() => filterProjects(items, search), [items, search]);

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white">
      <div className="mx-auto flex w-full max-w-[920px] flex-col px-6 py-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-semibold text-[#1b1b1b] text-[22px]">Projects</h1>
            <p className="mt-1 text-[#8a8a8a] text-[14px]">
              Everything you’ve built. Open one to keep going, or start something new.
            </p>
          </div>
          <Link
            className="inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-full bg-[#1b1b1b] px-4 font-medium text-[14px] text-white transition-colors hover:bg-[#2c2c2c] sm:self-auto"
            href="/"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            New task
          </Link>
        </header>

        <label className="relative mt-6 block" htmlFor="projects-search">
          <span className="sr-only">Search projects</span>
          <Search
            aria-hidden="true"
            className="absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-[#707070]"
          />
          <input
            className="h-9 w-full rounded-full border-0 bg-[#f7f7f7] pr-3 pl-10 font-medium text-[#1b1b1b] text-[14px] shadow-[0_0_0_2px_#fff,0_0_0_4px_#f7f7f7] outline-none placeholder:text-[#a0a0a0] focus:shadow-[0_0_0_2px_#fff,0_0_0_4px_#dedede]"
            id="projects-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name"
            value={search}
          />
        </label>

        <div className="mt-8">
          {isLoading ? (
            <ProjectGridSkeleton />
          ) : items.length === 0 ? (
            <EmptyProjects />
          ) : filtered.length === 0 ? (
            <p className="py-10 text-center text-[#8a8a8a] text-[14px]">
              No projects match “{search}”.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {filtered.map((project) => (
                <ProjectCard
                  isDeleting={deleteMutation.isPending && deleteMutation.variables === project.id}
                  key={project.id}
                  onDelete={() => setPendingDelete(project)}
                  onRename={() => setPendingRename(project)}
                  project={project}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      <RenameProjectModal
        busy={renameMutation.isPending}
        onCancel={() => setPendingRename(null)}
        onSubmit={(name) => {
          if (pendingRename) {
            renameMutation.mutate({ id: pendingRename.id, name });
          }
        }}
        project={pendingRename}
      />
      <ConfirmDialog
        busy={deleteMutation.isPending}
        cancelLabel="Cancel"
        confirmLabel="Delete project"
        description="This removes the project, its sandbox, and all generated files. Deployed previews stay live until they expire."
        destructive
        id="projects-list-delete-dialog"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate(pendingDelete.id);
          }
        }}
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : "Delete project?"}
      />
    </section>
  );
}

function ProjectCard({
  isDeleting,
  onDelete,
  onRename,
  project,
}: {
  isDeleting: boolean;
  onDelete: () => void;
  onRename: () => void;
  project: ProjectGridItem;
}) {
  const Icon = project.appType === "mobile" ? Smartphone : Monitor;
  const inner = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[12px] bg-[#f7f7f7] text-[#86641d]">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-[#1b1b1b] text-[15px] leading-5">
          {project.name}
        </span>
        <span className="mt-0.5 text-[#a0a0a0] text-[12px]">
          {project.href ? `Updated ${formatRelative(project.updatedAt)}` : "No threads yet"}
        </span>
      </span>
    </>
  );

  return (
    <li className="group relative">
      {project.href ? (
        <Link
          className="flex items-center gap-3 rounded-[18px] border-2 border-[#f7f7f7] bg-white p-3 pr-[84px] transition-[border-color,box-shadow] hover:border-[#ececec] hover:shadow-[0_10px_28px_rgba(0,0,0,0.04)]"
          href={project.href}
        >
          {inner}
        </Link>
      ) : (
        <div className="flex items-center gap-3 rounded-[18px] border-2 border-[#f7f7f7] bg-white p-3 pr-[84px]">
          {inner}
        </div>
      )}
      <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          aria-label={`Rename ${project.name}`}
          className="flex size-7 items-center justify-center rounded-full text-[#a0a0a0] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
          onClick={onRename}
          type="button"
        >
          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <button
          aria-label={`Delete ${project.name}`}
          className={cn(
            "flex size-7 items-center justify-center rounded-full text-[#a0a0a0] transition-colors hover:bg-[#f7f7f7] hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-45",
            isDeleting && "text-red-600",
          )}
          disabled={isDeleting}
          onClick={onDelete}
          type="button"
        >
          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function RenameProjectModal({
  busy,
  onCancel,
  onSubmit,
  project,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
  project: ProjectGridItem | null;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (project) {
      setDraft(project.name);
    }
  }, [project]);
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= 120 && trimmed !== project?.name;
  const titleId = "projects-list-rename-dialog-title";

  return (
    <ModalShell
      labelledBy={titleId}
      onClose={() => {
        if (!busy) {
          onCancel();
        }
      }}
      open={project !== null}
    >
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit && !busy) {
            onSubmit(trimmed);
          }
        }}
      >
        <h2 className="font-semibold text-base text-foreground" id={titleId}>
          Rename project
        </h2>
        <input
          aria-label="Project name"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-foreground text-sm outline-none focus:border-foreground/40"
          disabled={busy}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        <div className="flex justify-end gap-2">
          <button
            className="rounded-md border border-border px-3 py-1.5 text-foreground text-sm hover:bg-muted disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
            disabled={busy || !canSubmit}
            type="submit"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EmptyProjects() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[24px] border border-[#f1f1f1] bg-[#fbfbfb] px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-[16px] bg-white text-[#86641d] shadow-[0_0_1px_rgba(0,0,0,0.18)]">
        <Monitor aria-hidden="true" className="h-5 w-5" />
      </span>
      <p className="font-medium text-[#1b1b1b] text-[15px]">No projects yet</p>
      <p className="max-w-sm text-[#8a8a8a] text-[14px]">
        Describe what you want to build and Cheatcode spins up your first project.
      </p>
      <Link
        className="mt-1 inline-flex h-9 items-center gap-2 rounded-full bg-[#1b1b1b] px-4 font-medium text-[14px] text-white transition-colors hover:bg-[#2c2c2c]"
        href="/"
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Start a task
      </Link>
    </div>
  );
}

function ProjectGridSkeleton() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {["one", "two", "three", "four"].map((key) => (
        <li className="h-[68px] animate-pulse rounded-[18px] bg-[#f7f7f7]" key={key} />
      ))}
    </ul>
  );
}

function useProjectsGrid(getToken: () => Promise<null | string>) {
  const {
    data: projectData,
    isPending,
    isSuccess,
  } = useQuery({
    queryFn: () => listProjects(getToken),
    queryKey: ["sidebar-projects"],
    retry: false,
    staleTime: 30_000,
  });
  const projects = projectData ?? [];
  const threadQueries = useQueries({
    queries: projects.map((project) => ({
      enabled: isSuccess,
      queryFn: () => listProjectThreads(getToken, project.id),
      queryKey: ["sidebar-project-threads", project.id] as const,
      retry: false,
      staleTime: 30_000,
    })),
  });
  const items = projects
    .map((project, index) => gridItemFromApi(project, threadQueries[index]?.data?.[0] ?? null))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return {
    isLoading: isPending || threadQueries.some((query) => query.isPending),
    items,
  };
}

function gridItemFromApi(project: ProjectSummary, thread: Thread | null): ProjectGridItem {
  return {
    appType: gridAppType(project.mode),
    href: thread ? `/chats/${encodeURIComponent(thread.id)}` : null,
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
  };
}

function gridAppType(mode: string): "general" | "mobile" | "web" {
  if (mode === "app-builder-mobile") {
    return "mobile";
  }
  return mode === "app-builder" ? "web" : "general";
}

function filterProjects(items: ProjectGridItem[], search: string): ProjectGridItem[] {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) {
    return items;
  }
  return items.filter((item) => item.name.toLowerCase().includes(needle));
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "recently";
  }
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
