import { Suspense } from "react";
import { ProjectsShell } from "@/components/projects/projects-shell";

// The chat workspace is keyed by the `/chats/{threadId}` path param. Prompt
// params (prompt/promptKey/surface/repo/model) keep flowing into ProjectsShell
// via nuqs (read client-side), exactly as the old `/projects?thread=` route did.
export default async function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  return (
    <Suspense fallback={<div className="min-h-screen bg-thread-panel" />}>
      <ProjectsShell threadId={chatId} />
    </Suspense>
  );
}
