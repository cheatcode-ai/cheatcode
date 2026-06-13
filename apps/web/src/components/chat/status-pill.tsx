import type { SandboxState } from "@cheatcode/types";
import { cn } from "@/lib/ui/cn";

export type RunStatus = "error" | "ready" | "streaming" | "submitted";

const STATUS_LABEL: Record<RunStatus, string> = {
  error: "ERROR",
  ready: "READY",
  streaming: "RUNNING",
  submitted: "QUEUED",
};

const SANDBOX_LABEL: Record<SandboxState, string> = {
  cold: "COLD",
  failed: "FAILED",
  ready: "SANDBOX",
  sleeping: "SLEEP",
  starting: "START",
};

export function StatusPill({
  runStatus,
  sandboxStatus,
}: {
  runStatus: RunStatus;
  sandboxStatus: SandboxState;
}) {
  const isActive = runStatus === "streaming" || runStatus === "submitted";
  const isFailed = runStatus === "error" || sandboxStatus === "failed";

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isFailed && "bg-thread-status-error",
          isActive && "animate-pulse bg-thread-status-warning",
          !isActive &&
            !isFailed &&
            "bg-thread-status-success shadow-[0_0_8px_var(--thread-status-success-glow)]",
        )}
      />
      <span className="font-mono text-[10px] text-thread-text-secondary tracking-[0.22em]">
        {STATUS_LABEL[runStatus]} / {SANDBOX_LABEL[sandboxStatus]}
      </span>
    </div>
  );
}
