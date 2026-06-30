import { Suspense } from "react";
import { ProjectsList } from "@/components/projects/projects-list";

// `/projects` is the all-projects management grid. The single-project workspace
// now lives at `/chats/{threadId}` (see app/(app)/chats/[chatId]/page.tsx).
export default function ProjectsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex-1 bg-white" />}>
      <ProjectsList />
    </Suspense>
  );
}
