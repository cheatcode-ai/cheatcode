import type { SandboxState } from "@cheatcode/types";
import { Loader2 } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

export type RunStatus = "error" | "ready" | "streaming" | "submitted";

/** "36s" under a minute, else "2m 5s" (bud-style elapsed formatting). */
function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

const WORKING_INDICATOR_DEFAULT_CLASS =
  "mb-2 flex items-center gap-2 px-1 text-[#a0a0a0] text-[14px]";

/**
 * The run "Working • Ns" indicator — a muted spinner + elapsed timer shown while the agent
 * is actively working (bud parity). Mounted only when running. `className` overrides the
 * default container class so callers (e.g. the assistant message header) can restyle it.
 */
export function WorkingIndicator({
  className,
  elapsedSeconds,
}: {
  className?: string;
  elapsedSeconds: number;
}) {
  return (
    <div className={className ?? WORKING_INDICATOR_DEFAULT_CLASS}>
      <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      <span className="font-medium">
        Working{elapsedSeconds > 0 ? ` • ${formatElapsed(elapsedSeconds)}` : ""}
      </span>
    </div>
  );
}

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
