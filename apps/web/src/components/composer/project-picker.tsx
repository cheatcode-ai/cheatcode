"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, Plus, X } from "@/components/ui/icons";
import { listProjects } from "@/lib/api/project-thread";
import { cn } from "@/lib/ui/cn";

/**
 * Home-only project picker. A submit with a project selected routes into that
 * project's newest thread instead of bootstrapping a new project. Reuses the
 * sidebar's `["sidebar-projects"]` query cache. Read-only projects (over quota /
 * archived) are shown with a hint and are non-selectable.
 */
export function ProjectPicker({
  onSelect,
  selectedProject,
}: {
  onSelect: (project: ProjectSummary | null) => void;
  selectedProject: ProjectSummary | null;
}) {
  const { getToken } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: projectData, isPending: projectsIsPending } = useQuery({
    enabled: isOpen,
    queryFn: () => listProjects(getToken),
    queryKey: ["sidebar-projects"],
    retry: false,
    staleTime: 30_000,
  });
  const projects = (projectData ?? []).filter((project) =>
    project.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  if (selectedProject) {
    return (
      <div className="flex h-8 items-center gap-2 rounded-full border border-[#f1f1f1] bg-white px-3 text-[#1b1b1b] text-[12px]">
        <span className="max-w-40 truncate">{selectedProject.name || "Project"}</span>
        <button
          aria-label="Clear selected project"
          className="-mr-1.5 ml-0.5 flex h-6 w-6 items-center justify-center text-[#8a8a8a] transition-colors hover:text-[#1b1b1b]"
          onClick={() => onSelect(null)}
          type="button"
        >
          <X aria-hidden="true" className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        className="paper-focus-ring flex h-8 items-center gap-2 rounded-full border border-[#f1f1f1] bg-white px-3 text-[#4f4f4f] text-[12px] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span>Choose project</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {isOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 flex w-72 flex-col gap-1 rounded-2xl border border-[#f1f1f1] bg-white p-1 shadow-[0_18px_60px_rgba(0,0,0,0.12)]">
          <input
            aria-label="Search projects"
            className="w-full border-[#f1f1f1] border-b bg-transparent px-3 py-2 text-[#1b1b1b] text-[13px] outline-none placeholder:text-[#a0a0a0]"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
            value={search}
          />
          <button
            className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-[#4f4f4f] text-[13px] transition-colors hover:bg-[#f7f7f7] hover:text-[#1b1b1b]"
            onClick={() => {
              onSelect(null);
              setIsOpen(false);
            }}
            type="button"
          >
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />
            New project
          </button>
          <ProjectRows
            onSelect={(project) => {
              onSelect(project);
              setIsOpen(false);
            }}
            projects={projects}
            isLoading={projectsIsPending}
          />
        </div>
      ) : null}
    </div>
  );
}

function ProjectRows({
  isLoading,
  onSelect,
  projects,
}: {
  isLoading: boolean;
  onSelect: (project: ProjectSummary) => void;
  projects: readonly ProjectSummary[];
}) {
  if (isLoading) {
    return <p className="px-3 py-3 text-[#a0a0a0] text-[12px]">Loading...</p>;
  }
  if (projects.length === 0) {
    return <p className="px-3 py-3 text-[#a0a0a0] text-[12px]">No projects yet</p>;
  }
  return (
    <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
      {projects.map((project) => (
        <button
          className={cn(
            "flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[13px] transition-colors",
            project.readOnly
              ? "cursor-not-allowed text-[#c7c7c7]"
              : "text-[#4f4f4f] hover:bg-[#f7f7f7] hover:text-[#1b1b1b]",
          )}
          disabled={project.readOnly}
          key={project.id}
          onClick={() => onSelect(project)}
          type="button"
        >
          <span className="min-w-0 truncate">{project.name || "Untitled project"}</span>
          {project.readOnly ? (
            <span className="shrink-0 text-[#a0a0a0] text-[11px]">read-only</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
