"use client";

import { useAuth } from "@clerk/nextjs";
import { ChevronDown, Plus } from "@/components/ui/icons";
import type { ConsoleLine, ConsoleSeverity } from "@/lib/preview/console";
import { usePreviewConsole } from "@/lib/preview/use-preview-console";
import { useAppStore } from "@/lib/store/app-store";
import { emitConsoleStripOpened } from "@/lib/telemetry/user-events";
import { cn } from "@/lib/ui/cn";

/**
 * Functional console strip (preview-surface §7.3). Collapsed by default; while
 * expanded ∧ sandbox ready it polls the dev-server console over HTTP (no
 * streaming - DOs own streaming). pid-based resets are handled in the store.
 */
export function ConsoleStrip({ threadId }: { threadId: string }) {
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
    <div
      className={cn(
        "flex shrink-0 flex-col border-[#f1f1f1] border-t bg-white",
        consoleStripOpen ? "h-[200px]" : "h-[34px]",
      )}
    >
      <div className="flex h-[34px] shrink-0 items-center px-2 py-[5px]">
        <button
          aria-expanded={consoleStripOpen}
          aria-label={consoleStripOpen ? "Collapse console" : "Expand console"}
          className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f1f1f1] hover:text-[#1b1b1b]"
          onClick={toggle}
          type="button"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn("h-3.5 w-3.5 transition-transform", consoleStripOpen ? "" : "-rotate-90")}
          />
        </button>
        <button
          aria-selected="true"
          className="ml-3 flex h-5 items-center rounded-full font-medium text-[#1b1b1b] text-[14px] transition-colors hover:text-[#1b1b1b]"
          onClick={() => {
            if (!consoleStripOpen) {
              toggle();
            }
          }}
          role="tab"
          type="button"
        >
          Console
        </button>
        <button
          aria-label="New terminal"
          className="ml-[5px] flex h-[22px] w-[22px] items-center justify-center rounded-full text-[#5f5f5f] transition-colors hover:bg-[#f1f1f1] hover:text-[#1b1b1b]"
          onClick={() => {
            if (!consoleStripOpen) {
              toggle();
            }
          }}
          type="button"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
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
      <div className="min-h-0 flex-1 border-[#f1f1f1] border-t px-3 py-4 font-mono text-[#8a8a8a] text-[11px]">
        No dev server running
      </div>
    );
  }
  return (
    <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto border-[#f1f1f1] border-t bg-[#fafafa] px-3 py-2 font-mono text-[11px]">
      {truncated ? <div className="mb-1 text-[#8a8a8a]">earlier output truncated</div> : null}
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
    return "text-red-700";
  }
  if (severity === "warn") {
    return "text-amber-700";
  }
  return "text-[#383a42]";
}
