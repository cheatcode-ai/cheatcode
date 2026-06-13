import { Suspense } from "react";
import { ProjectsShell } from "@/components/projects/projects-shell";

export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-thread-panel" />}>
      <ProjectsShell />
    </Suspense>
  );
}
