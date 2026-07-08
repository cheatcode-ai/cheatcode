import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * The canonical "computer open" workspace shell shared by the chat/projects view
 * and the home page. A flex container (`.cc-agent-run-layout`) whose flex-basis
 * rules live in `globals.css` (`data-preview-surface` + `data-computer-open`):
 *
 *   [ .cc-agent-chat-pane (content) ] [ .cc-agent-run-divider ] [ .cc-agent-computer-pane (computer) ]
 *
 * The `computer` node owns the `.cc-agent-computer-pane` class itself (so it can
 * also render a floating "open computer" affordance). This keeps a single source
 * of truth for the split so the home and chat layouts stay structurally identical
 * — only the pane content differs.
 */
export function WorkspaceRunLayout({
  computer,
  computerOpen,
  content,
  hasPreviewSurface,
}: {
  computer: ReactNode;
  computerOpen: boolean;
  content: ReactNode;
  hasPreviewSurface: boolean;
}) {
  return (
    <div
      className={workspaceRunLayoutClass(hasPreviewSurface)}
      data-computer-open={computerOpen ? "true" : "false"}
      data-preview-surface={hasPreviewSurface ? "true" : "false"}
    >
      <section className={workspaceChatPaneClass(hasPreviewSurface)}>{content}</section>
      <RunPanelDivider computerOpen={computerOpen} hasPreviewSurface={hasPreviewSurface} />
      {computer}
    </div>
  );
}

export function workspaceRunLayoutClass(hasPreviewSurface: boolean): string {
  return cn(
    "cc-agent-run-layout flex min-h-0 min-w-0 flex-1",
    hasPreviewSurface ? "flex-col motion-reduce:transition-none md:flex-row" : null,
  );
}

export function workspaceChatPaneClass(hasPreviewSurface: boolean): string {
  return cn("cc-agent-chat-pane flex min-w-0 flex-col", hasPreviewSurface ? "min-h-0" : "flex-1");
}

export function RunPanelDivider({
  computerOpen,
  hasPreviewSurface,
}: {
  computerOpen: boolean;
  hasPreviewSurface: boolean;
}) {
  if (!hasPreviewSurface) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      className={cn(
        "group relative z-10 hidden w-px shrink-0 cursor-col-resize transition-opacity duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] motion-reduce:transition-none md:block",
        "cc-agent-run-divider",
        computerOpen ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="absolute inset-y-0 left-1/2 w-4 -translate-x-1/2" />
    </div>
  );
}
