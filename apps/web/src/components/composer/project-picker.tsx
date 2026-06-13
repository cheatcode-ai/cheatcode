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
  const projectsQuery = useQuery({
    enabled: isOpen,
    queryFn: () => listProjects(getToken),
    queryKey: ["sidebar-projects"],
    retry: false,
    staleTime: 30_000,
  });
  const projects = (projectsQuery.data ?? []).filter((project) =>
    project.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  if (selectedProject) {
    return (
      <div className="flex h-8 items-center gap-2 border border-white/15 bg-white/5 px-3 font-mono text-[10px] text-zinc-200 uppercase tracking-widest">
        <span className="max-w-40 truncate">{selectedProject.name || "Project"}</span>
        <button
          aria-label="Clear selected project"
          className="-mr-1.5 ml-0.5 flex h-6 w-6 items-center justify-center text-zinc-500 transition-colors hover:text-white"
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
        className="flex h-8 items-center gap-2 border border-white/5 bg-[#09090b] px-3 font-mono text-[10px] text-zinc-500 uppercase tracking-widest transition-colors hover:border-white/10 hover:text-zinc-300"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span>Choose project</span>
        <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {isOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-72 border border-white/10 bg-[#09090b] p-1 shadow-2xl">
          <input
            aria-label="Search projects"
            className="mb-1 w-full border-white/5 border-b bg-transparent px-2 py-1.5 font-mono text-[11px] text-white outline-none placeholder:text-zinc-600"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects"
            value={search}
          />
          <button
            className="flex h-8 w-full items-center gap-2 px-2 font-mono text-[10px] text-zinc-300 uppercase tracking-widest transition-colors hover:bg-white/5 hover:text-white"
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
            isLoading={projectsQuery.isPending}
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
    return <p className="px-2 py-3 font-mono text-[10px] text-zinc-600 uppercase">Loading…</p>;
  }
  if (projects.length === 0) {
    return (
      <p className="px-2 py-3 font-mono text-[10px] text-zinc-600 uppercase tracking-widest">
        No projects yet
      </p>
    );
  }
  return (
    <div className="max-h-56 overflow-y-auto">
      {projects.map((project) => (
        <button
          className={cn(
            "flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left font-mono text-[11px] transition-colors",
            project.readOnly
              ? "cursor-not-allowed text-zinc-600"
              : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200",
          )}
          disabled={project.readOnly}
          key={project.id}
          onClick={() => onSelect(project)}
          type="button"
        >
          <span className="min-w-0 truncate">{project.name || "Untitled project"}</span>
          {project.readOnly ? (
            <span className="shrink-0 text-[9px] text-zinc-600 uppercase tracking-widest">
              read-only
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
