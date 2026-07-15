"use client";

import { toast } from "sonner";
import { normalizePreviewPath, previewOrigin } from "@/lib/preview/url-bar";
import { useAppStore } from "@/lib/store/app-store";

export function PreviewPathInput({ previewUrl }: { previewUrl: string | null }) {
  const previewPath = useAppStore((state) => state.previewPath);
  const navigatePreviewPath = useAppStore((state) => state.navigatePreviewPath);
  if (!previewUrl) {
    return (
      <div className="min-w-0 flex-1 truncate text-center font-medium text-[13px] text-placeholder">
        No preview available
      </div>
    );
  }
  const commitPath = (raw: string) => {
    const next = normalizePreviewPath(raw, previewUrl);
    if (next === null) {
      toast.error("Preview can only navigate within the sandbox origin");
    } else {
      navigatePreviewPath(next);
    }
  };
  return (
    <input
      aria-label={`Preview path on ${previewOrigin(previewUrl)}`}
      className="min-w-0 flex-1 bg-transparent text-center font-medium text-[14px] text-fg-secondary outline-none placeholder:text-placeholder"
      defaultValue={previewPath}
      key={previewPath}
      onBlur={(event) => commitPath(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commitPath(event.currentTarget.value);
          event.currentTarget.blur();
        }
      }}
      placeholder="/"
      spellCheck={false}
    />
  );
}
