"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { ConfirmDialog, ModalShell } from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BudTooltip } from "@/components/ui/bud-tooltip";
import { ChevronDown, Folder, MoreHorizontal, Plus, Trash2, X } from "@/components/ui/icons";
import { deleteProject, listProjects, updateProject } from "@/lib/api/project-thread";
import { cn } from "@/lib/ui/cn";

type ProjectPickerVariant = "home" | "thread";

/**
 * Bud-style folder/project picker used by both the home composer and the agent
 * run composer. In a thread, the selected folder controls where the next prompt
 * is routed; on home, it scopes the first prompt to an existing project.
 */
export function ProjectPicker({
  onSelect,
  selectedProject,
  variant = "home",
}: {
  onSelect: (project: ProjectSummary | null) => void;
  selectedProject: ProjectSummary | null;
  variant?: ProjectPickerVariant | undefined;
}) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState<ProjectSummary | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const { data: projectData, isPending: projectsIsPending } = useQuery({
    enabled: isOpen,
    queryFn: () => listProjects(getToken),
    queryKey: ["sidebar-projects"],
    retry: false,
    staleTime: 30_000,
  });
  const projects = filterProjects(projectData ?? [], search);

  const renameMutation = useMutation({
    mutationFn: ({ name, project }: { name: string; project: ProjectSummary }) =>
      updateProject(getToken, project.id, { name }),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't rename that project.");
    },
    onSettled: () => setPendingRename(null),
    onSuccess: (project) => {
      void invalidateProjectQueries(queryClient);
      if (selectedProject?.id === project.id) {
        onSelect(project);
      }
      toast.success(`Renamed to ${project.name}`);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (project: ProjectSummary) => deleteProject(getToken, project.id),
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Couldn't delete that project.");
    },
    onSettled: () => setPendingDelete(null),
    onSuccess: (_result, project) => {
      void invalidateProjectQueries(queryClient);
      if (selectedProject?.id === project.id) {
        onSelect(null);
      }
      toast.success(`Deleted ${project.name}`);
    },
  });

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
        setOpenProjectMenuId(null);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        setOpenProjectMenuId(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  if (variant === "home" && selectedProject) {
    return (
      <div className="flex h-8 items-center gap-2 rounded-full border border-[#f1f1f1] bg-white px-3 text-[#1b1b1b] text-[12px]">
        <Folder aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[#707070]" />
        <span className="max-w-40 truncate">{selectedProject.name || "Project"}</span>
        <BudTooltip label="Clear folder">
          <button
            aria-label="Clear selected project"
            className="-mr-1.5 ml-0.5 flex h-6 w-6 items-center justify-center text-[#8a8a8a] transition-colors hover:text-[#1b1b1b]"
            onClick={() => onSelect(null)}
            type="button"
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
        </BudTooltip>
      </div>
    );
  }

  return (
    <div className="relative" ref={menuRef}>
      <BudTooltip label="Choose folder">
        <button
          aria-expanded={isOpen}
          aria-label="Choose folder"
          className={cn(
            "paper-focus-ring inline-flex h-8 max-w-[160px] items-center gap-1.5 rounded-full font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.99]",
            variant === "thread"
              ? "bg-white px-3 text-[#5f5f5f] text-[12px] shadow-[0_0_0_1px_rgba(0,0,0,0.06)] hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
              : "border border-[#f1f1f1] bg-white px-3 text-[#5f5f5f] text-[12px] hover:bg-[#f7f7f7] hover:text-[#1b1b1b]",
          )}
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <Folder aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">{selectedProject?.name ?? "Choose folder"}</span>
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        </button>
      </BudTooltip>
      {isOpen ? (
        <div
          className={cn(
            "absolute bottom-full left-0 z-30 mb-2 flex w-72 origin-bottom-left flex-col gap-1 rounded-2xl border border-[#f1f1f1] bg-white p-1 shadow-[0_18px_60px_rgba(0,0,0,0.12)] transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]",
            isOpen ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
          )}
          role="menu"
        >
          <input
            aria-label="Search projects"
            // biome-ignore lint/a11y/noAutofocus: Bud focuses the project search when the menu opens.
            autoFocus
            className="w-full border-[#f1f1f1] border-b bg-transparent px-3 py-2 text-[#1b1b1b] text-[13px] outline-none placeholder:text-[#a0a0a0]"
            onChange={(event) => {
              setSearch(event.target.value);
              setOpenProjectMenuId(null);
            }}
            placeholder="Search projects"
            value={search}
          />
          <button
            className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[#5f5f5f] text-[13px] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
            onClick={() => {
              onSelect(null);
              setIsOpen(false);
              setSearch("");
            }}
            role="menuitem"
            type="button"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            New project
          </button>
          <ProjectRows
            isLoading={projectsIsPending}
            onDelete={setPendingDelete}
            onMenuOpenChange={setOpenProjectMenuId}
            onRename={setPendingRename}
            onSelect={(project) => {
              onSelect(project);
              setIsOpen(false);
              setSearch("");
              setOpenProjectMenuId(null);
            }}
            openProjectMenuId={openProjectMenuId}
            projects={projects}
            selectedProjectId={selectedProject?.id ?? null}
          />
        </div>
      ) : null}
      <ProjectRenameDialog
        busy={renameMutation.isPending}
        onCancel={() => setPendingRename(null)}
        onSubmit={(name) => {
          if (pendingRename) {
            renameMutation.mutate({ name, project: pendingRename });
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
        id="composer-delete-project-dialog"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            deleteMutation.mutate(pendingDelete);
          }
        }}
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : "Delete project?"}
      />
    </div>
  );
}

function ProjectRows({
  isLoading,
  onDelete,
  onMenuOpenChange,
  onRename,
  onSelect,
  openProjectMenuId,
  projects,
  selectedProjectId,
}: {
  isLoading: boolean;
  onDelete: (project: ProjectSummary) => void;
  onMenuOpenChange: (projectId: string | null) => void;
  onRename: (project: ProjectSummary) => void;
  onSelect: (project: ProjectSummary) => void;
  openProjectMenuId: string | null;
  projects: readonly ProjectSummary[];
  selectedProjectId: string | null;
}) {
  if (isLoading) {
    return <p className="px-3 py-3 text-[#a0a0a0] text-[12px]">Loading...</p>;
  }
  if (projects.length === 0) {
    return <p className="px-3 py-3 text-[#a0a0a0] text-[12px]">No projects yet</p>;
  }
  return (
    <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
      {projects.map((project) => (
        <div className="group relative" key={project.id}>
          <button
            aria-checked={selectedProjectId === project.id}
            className={cn(
              "group flex min-h-9 w-full items-center gap-2 rounded-xl py-2 pr-8 pl-3 text-left text-[13px] transition-colors",
              project.readOnly
                ? "cursor-not-allowed text-[#c7c7c7]"
                : selectedProjectId === project.id
                  ? "bg-[#f7f7f7] text-[#1b1b1b]"
                  : "text-[#5f5f5f] hover:bg-[#f7f7f7] hover:text-[#1b1b1b]",
            )}
            disabled={project.readOnly}
            onClick={() => onSelect(project)}
            role="menuitemradio"
            type="button"
          >
            <Folder aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {project.readOnly ? (
              <span className="shrink-0 text-[#a0a0a0] text-[11px]">read-only</span>
            ) : null}
          </button>
          <BudTooltip
            className="absolute top-1/2 right-1 -translate-y-1/2"
            disabled={project.readOnly}
            label={`Open ${project.name} project menu`}
          >
            <button
              aria-expanded={openProjectMenuId === project.id}
              aria-label={`Open ${project.name} project menu`}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full text-[#a0a0a0] opacity-0 transition-[background-color,color,opacity] hover:bg-white hover:text-[#1b1b1b]",
                openProjectMenuId === project.id && "bg-white text-[#1b1b1b] opacity-100",
                !project.readOnly && "group-hover:opacity-100",
              )}
              disabled={project.readOnly}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onMenuOpenChange(openProjectMenuId === project.id ? null : project.id);
              }}
              type="button"
            >
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
            </button>
          </BudTooltip>
          {openProjectMenuId === project.id ? (
            <div className="mx-1 mb-1 flex flex-col gap-1 rounded-xl bg-[#f7f7f7] p-1">
              <button
                className="flex h-8 w-full items-center rounded-lg px-2 text-left font-medium text-[#5f5f5f] text-[13px] transition-colors hover:bg-white hover:text-[#1b1b1b]"
                onClick={() => {
                  onRename(project);
                  onMenuOpenChange(null);
                }}
                role="menuitem"
                type="button"
              >
                Rename
              </button>
              <button
                className="flex h-8 w-full items-center rounded-lg px-2 text-left font-medium text-[#8b2d1b] text-[13px] transition-colors hover:bg-white"
                onClick={() => {
                  onDelete(project);
                  onMenuOpenChange(null);
                }}
                role="menuitem"
                type="button"
              >
                <Trash2 aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ProjectRenameDialog({
  busy,
  onCancel,
  onSubmit,
  project,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
  project: ProjectSummary | null;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => {
    if (project) {
      setDraft(project.name);
    }
  }, [project]);
  const trimmed = draft.trim();
  const canSubmit = project !== null && trimmed.length > 0 && trimmed !== project.name;
  const titleId = "composer-rename-project-dialog-title";

  return (
    <ModalShell labelledBy={titleId} onClose={onCancel} open={project !== null}>
      <div className="flex flex-col gap-4 p-5">
        <h2 className="font-semibold text-[#1b1b1b] text-base" id={titleId}>
          Rename project
        </h2>
        <input
          aria-label="Project name"
          className="h-9 w-full rounded-md border border-[#e6e6e6] bg-white px-3 text-[#1b1b1b] text-sm outline-none focus:border-[#c7c7c7]"
          disabled={busy}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }
            event.preventDefault();
            if (canSubmit && !busy) {
              onSubmit(trimmed);
            }
          }}
          maxLength={120}
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        <div className="flex justify-end gap-2">
          <button
            className="rounded-md border border-[#e6e6e6] px-3 py-1.5 text-[#4f4f4f] text-sm hover:bg-[#f7f7f7] disabled:opacity-50"
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-[#1b1b1b] px-3 py-1.5 font-medium text-sm text-white hover:bg-black disabled:opacity-50"
            disabled={busy || !canSubmit}
            onClick={() => {
              if (canSubmit && !busy) {
                onSubmit(trimmed);
              }
            }}
            type="button"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function filterProjects(projects: readonly ProjectSummary[], search: string): ProjectSummary[] {
  const trimmed = search.trim().toLowerCase();
  if (trimmed.length === 0) {
    return [...projects];
  }
  return projects.filter((project) => project.name.toLowerCase().includes(trimmed));
}

async function invalidateProjectQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["sidebar-projects"] }),
    queryClient.invalidateQueries({ queryKey: ["sidebar-project-threads"] }),
    queryClient.invalidateQueries({ queryKey: ["sidebar-chats"] }),
  ]);
}
