import { Suspense } from "react";
import { ProjectsShell } from "@/components/projects/projects-shell";
import { WorkspaceLoadingState } from "@/components/workspace/workspace-route-state";

// The chat workspace is keyed by the `/chats/{threadId}` path param. Prompt params
// (prompt/promptKey/surface/repo/model) flow into ProjectsShell through client-side nuqs state.
export default async function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  return (
    <Suspense fallback={<WorkspaceLoadingState />}>
      <ProjectsShell threadId={chatId} />
    </Suspense>
  );
}
