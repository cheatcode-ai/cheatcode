"use client";

import type { ProjectSummary } from "@cheatcode/types";
import { useChatContextController } from "@/components/chat/chat-context-controller";
import { ChatContextView } from "@/components/chat/chat-context-view";

export function ChatContextRow({
  project,
  threadId,
  title,
}: {
  project: ProjectSummary | null;
  threadId: string;
  title: null | string | undefined;
}) {
  const controller = useChatContextController({ project, threadId, title });
  return <ChatContextView controller={controller} project={project} threadId={threadId} />;
}
