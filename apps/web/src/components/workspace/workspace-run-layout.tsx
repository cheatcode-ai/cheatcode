"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/ui/cn";

const DEFAULT_CHAT_PANE_PERCENT = 30;
const MIN_CHAT_PANE_PERCENT = 22;
const MAX_CHAT_PANE_PERCENT = 55;

type WorkspaceStyle = CSSProperties & { "--cc-chat-pane-size": string };

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
  const pane = useWorkspacePaneSize();

  return (
    <div
      className={workspaceRunLayoutClass(hasPreviewSurface)}
      data-computer-open={computerOpen ? "true" : "false"}
      data-preview-surface={hasPreviewSurface ? "true" : "false"}
      ref={pane.layoutRef}
      style={pane.style}
    >
      <section className={workspaceChatPaneClass(hasPreviewSurface)}>{content}</section>
      <RunPanelDivider
        computerOpen={computerOpen}
        hasPreviewSurface={hasPreviewSurface}
        onReset={pane.reset}
        onResize={pane.resizeFromClientX}
        value={pane.value}
      />
      {computer}
    </div>
  );
}

function useWorkspacePaneSize() {
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState(DEFAULT_CHAT_PANE_PERCENT);
  const resizeFromClientX = useCallback((clientX: number) => {
    const next = panePercentFromClientX(layoutRef.current, clientX);
    if (next !== null) setValue(next);
  }, []);
  const reset = useCallback(() => setValue(DEFAULT_CHAT_PANE_PERCENT), []);
  const style: WorkspaceStyle = { "--cc-chat-pane-size": `${value}%` };
  return { layoutRef, reset, resizeFromClientX, style, value };
}

function panePercentFromClientX(element: HTMLDivElement | null, clientX: number): number | null {
  const bounds = element?.getBoundingClientRect();
  if (!bounds || bounds.width === 0) return null;
  return clampPanePercent(((clientX - bounds.left) / bounds.width) * 100);
}

function workspaceRunLayoutClass(hasPreviewSurface: boolean): string {
  return cn(
    "cc-agent-run-layout flex min-h-0 min-w-0 flex-1",
    hasPreviewSurface ? "flex-col motion-reduce:transition-none md:flex-row" : null,
  );
}

function workspaceChatPaneClass(hasPreviewSurface: boolean): string {
  return cn(
    "cc-agent-chat-pane flex min-w-0 flex-1 flex-col",
    hasPreviewSurface ? "min-h-0" : null,
  );
}

function stopPanelResize(event: PointerEvent<HTMLHRElement>) {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  document.body.style.removeProperty("cursor");
  document.body.style.removeProperty("user-select");
}

interface RunPanelDividerProps {
  computerOpen: boolean;
  hasPreviewSurface: boolean;
  onReset: () => void;
  onResize: (clientX: number) => void;
  value: number;
}

function RunPanelDivider({
  computerOpen,
  hasPreviewSurface,
  onReset,
  onResize,
  value,
}: RunPanelDividerProps) {
  if (!hasPreviewSurface) {
    return null;
  }
  return (
    <hr
      aria-label="Resize chat and computer panels"
      aria-orientation="vertical"
      aria-valuemax={MAX_CHAT_PANE_PERCENT}
      aria-valuemin={MIN_CHAT_PANE_PERCENT}
      aria-valuenow={Math.round(value)}
      className={cn(
        "group relative z-50 m-0 hidden h-auto w-px shrink-0 cursor-col-resize self-stretch border-0 p-0 transition-opacity duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] after:absolute after:inset-y-0 after:left-1/2 after:w-4 after:-translate-x-1/2 motion-reduce:transition-none md:block",
        "cc-agent-run-divider",
        computerOpen ? "opacity-100" : "opacity-0",
      )}
      onDoubleClick={onReset}
      onKeyDown={(event) => handleDividerKeyDown(event, { onReset, onResize, value })}
      onPointerCancel={stopPanelResize}
      onPointerDown={(event) => startPanelResize(event, onResize)}
      onPointerMove={(event) => continuePanelResize(event, onResize)}
      onPointerUp={stopPanelResize}
      tabIndex={computerOpen ? 0 : -1}
    />
  );
}

function handleDividerKeyDown(
  event: KeyboardEvent<HTMLHRElement>,
  input: Pick<RunPanelDividerProps, "onReset" | "onResize" | "value">,
): void {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home") return;
  event.preventDefault();
  if (event.key === "Home") {
    input.onReset();
    return;
  }
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const step = event.shiftKey ? 5 : 1;
  const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
  if (bounds) {
    const next = clampPanePercent(input.value + direction * step);
    input.onResize(bounds.left + (bounds.width * next) / 100);
  }
}

function startPanelResize(
  event: PointerEvent<HTMLHRElement>,
  onResize: (clientX: number) => void,
): void {
  event.currentTarget.setPointerCapture(event.pointerId);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  onResize(event.clientX);
}

function continuePanelResize(
  event: PointerEvent<HTMLHRElement>,
  onResize: (clientX: number) => void,
): void {
  if (event.currentTarget.hasPointerCapture(event.pointerId)) onResize(event.clientX);
}

function clampPanePercent(value: number): number {
  return Math.min(MAX_CHAT_PANE_PERCENT, Math.max(MIN_CHAT_PANE_PERCENT, value));
}
