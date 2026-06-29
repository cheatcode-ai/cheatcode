import { Suspense } from "react";
import { ProjectsList } from "@/components/projects/projects-list";
import { ProjectsShell } from "@/components/projects/projects-shell";

// Bare `/projects` is the all-projects management grid. A `?thread=` (open an
// existing run) or any creation-intent param (home composer → new project) flips
// the route into the single-project workspace shell.
const WORKSPACE_PARAMS = ["thread", "prompt", "promptKey", "surface", "repo", "new"] as const;

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const isWorkspace = WORKSPACE_PARAMS.some((key) => {
    const value = params[key];
    return typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0;
  });

  if (isWorkspace) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-thread-panel" />}>
        <ProjectsShell />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen flex-1 bg-white" />}>
      <ProjectsList />
    </Suspense>
  );
}
