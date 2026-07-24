"use client";

import { Loader2, Paperclip } from "@cheatcode/ui";
import { cn } from "@/lib/ui/cn";

export interface ComposerAttachmentStatusState {
  names: readonly string[];
  text: string;
  tone: "error" | "loading" | "ok" | "warning";
}

export function ComposerAttachmentStatus({
  className,
  status,
}: {
  className?: string | undefined;
  status: ComposerAttachmentStatusState | null;
}) {
  if (!status) {
    return null;
  }
  return (
    <div
      aria-label={status.text}
      aria-live="polite"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="status"
    >
      {status.names.length > 0 ? (
        <span
          className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-secondary/70 px-2.5 font-medium text-[12px] text-foreground"
          title={status.names.join(", ")}
        >
          {status.tone === "loading" ? (
            <Loader2
              aria-hidden="true"
              className="size-3 shrink-0 animate-spin text-fg-secondary motion-reduce:animate-none"
            />
          ) : (
            <Paperclip aria-hidden="true" className="size-3 shrink-0 text-fg-secondary" />
          )}
          <span className="min-w-0 truncate">
            {status.names.length === 1
              ? status.names[0]
              : `${status.names.length} files: ${status.names.join(", ")}`}
          </span>
        </span>
      ) : null}
      <span
        className={cn(
          "text-[12px]",
          status.tone === "error"
            ? "text-red-600 dark:text-red-400"
            : status.tone === "warning"
              ? "text-amber-700 dark:text-amber-400"
              : "text-fg-secondary",
        )}
      >
        {status.text}
      </span>
    </div>
  );
}
