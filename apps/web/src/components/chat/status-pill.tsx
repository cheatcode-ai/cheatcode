import { Loader2 } from "@cheatcode/ui";

export type RunStatus = "error" | "ready" | "streaming" | "submitted";

/** "36s" under a minute, else "2m 5s" (cheatcode-style elapsed formatting). */
function formatElapsed(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

const WORKING_INDICATOR_DEFAULT_CLASS =
  "mb-2 flex items-center gap-2 px-1 text-placeholder text-[14px]";

/**
 * The run "Working • Ns" indicator — a muted spinner + elapsed timer shown while the agent
 * is actively working (Cheatcode parity). Mounted only when running. `className` overrides the
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
