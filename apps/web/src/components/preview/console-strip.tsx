"use client";

import { useAuth } from "@clerk/nextjs";
import { ChevronDown } from "@/components/ui/icons";
import { type ConsoleLine, type ConsoleSeverity, consoleSummary } from "@/lib/preview/console";
import { usePreviewConsole } from "@/lib/preview/use-preview-console";
import { useAppStore } from "@/lib/store/app-store";
import { emitConsoleStripOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";

/**
 * Functional console strip (preview-surface §7.3). Collapsed by default; while
 * expanded ∧ sandbox ready it polls the dev-server console over HTTP (no
 * streaming - DOs own streaming). pid-based resets are handled in the store.
 */
export function ConsoleStrip({
  previewUrl,
  threadId,
}: {
  previewUrl: string | null;
  threadId: string;
}) {
  const { getToken } = useAuth();
  const consoleLines = useAppStore((state) => state.consoleLines);
  const consoleProcess = useAppStore((state) => state.consoleProcess);
  const consoleStripOpen = useAppStore((state) => state.consoleStripOpen);
  const consoleTruncated = useAppStore((state) => state.consoleTruncated);
  const sandboxStatus = useAppStore((state) => state.sandboxStatus);
  const setConsoleStripOpen = useAppStore((state) => state.setConsoleStripOpen);
  usePreviewConsole(threadId, consoleStripOpen && sandboxStatus === "ready");

  const toggle = () => {
    const next = !consoleStripOpen;
    setConsoleStripOpen(next);
    if (next) {
      void emitConsoleStripOpened(getToken).catch(() => undefined);
    }
  };

  return (
    <div className="shrink-0 border-thread-border-subtle border-t bg-white">
      <button
        className="flex w-full items-center justify-between px-3 py-2 transition-colors hover:bg-thread-hover"
        onClick={toggle}
        type="button"
      >
        <span className="font-mono text-[11px] text-thread-text-muted">Console</span>
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[10px] text-thread-text-secondary">
            {consoleSummary(consoleProcess, previewUrl)}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform",
              consoleStripOpen ? "" : "-rotate-90",
            )}
          />
        </span>
      </button>
      {consoleStripOpen ? (
        <ConsoleLines
          lines={consoleLines}
          noProcess={consoleProcess === null}
          truncated={consoleTruncated}
        />
      ) : null}
    </div>
  );
}

function ConsoleLines({
  lines,
  noProcess,
  truncated,
}: {
  lines: ConsoleLine[];
  noProcess: boolean;
  truncated: boolean;
}) {
  if (noProcess && lines.length === 0) {
    return (
      <div className="px-3 py-4 font-mono text-[10px] text-thread-text-muted">
        No dev server running
      </div>
    );
  }
  return (
    <div className="chat-scrollbar max-h-48 overflow-y-auto bg-[#fafafa] px-3 py-2 font-mono text-[10px]">
      {truncated ? (
        <div className="mb-1 text-thread-text-muted">earlier output truncated</div>
      ) : null}
      {lines.map((line) => (
        <pre
          className={cn("whitespace-pre-wrap break-words", severityClass(line.severity))}
          data-severity={line.severity}
          key={line.id}
        >
          {line.text}
        </pre>
      ))}
    </div>
  );
}

function severityClass(severity: ConsoleSeverity): string {
  if (severity === "error") {
    return "text-red-300";
  }
  if (severity === "warn") {
    return "text-amber-300";
  }
  return "text-thread-text-secondary";
}
