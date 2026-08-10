"use client";

import { useState } from "react";
import { toast } from "sonner";
import { normalizePreviewPath, previewOrigin } from "@/components/preview/url-bar";
import { useAppStore } from "@/lib/store/app-store";

export function PreviewPathInput({
  onAuthorizeNavigation,
  previewUrl,
}: {
  onAuthorizeNavigation?: () => Promise<boolean>;
  previewUrl: string | null;
}) {
  const previewPath = useAppStore((state) => state.previewPath);
  const navigatePreviewPath = useAppStore((state) => state.navigatePreviewPath);
  const { commitPath, isNavigating } = usePreviewPathCommit({
    navigatePreviewPath,
    onAuthorizeNavigation,
    previewPath,
    previewUrl,
  });
  if (!previewUrl) {
    return (
      <div className="min-w-0 flex-1 truncate text-center font-medium text-[13px] text-placeholder">
        No preview available
      </div>
    );
  }
  return (
    <input
      aria-label={`Preview path on ${previewOrigin(previewUrl)}`}
      aria-busy={isNavigating}
      className="min-w-0 flex-1 bg-transparent text-center font-medium text-[14px] text-fg-secondary outline-none placeholder:text-placeholder"
      defaultValue={previewPath}
      disabled={isNavigating}
      key={previewPath}
      onBlur={(event) => void commitPath(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      placeholder="/"
      spellCheck={false}
    />
  );
}

function usePreviewPathCommit(input: {
  navigatePreviewPath: (path: string) => void;
  onAuthorizeNavigation: (() => Promise<boolean>) | undefined;
  previewPath: string;
  previewUrl: string | null;
}) {
  const [isNavigating, setIsNavigating] = useState(false);
  const commitPath = async (element: HTMLInputElement) => {
    if (isNavigating || !input.previewUrl) return;
    const next = normalizePreviewPath(element.value, input.previewUrl);
    if (next === null) {
      toast.error("Preview can only navigate within the sandbox origin");
      element.value = input.previewPath;
      return;
    }
    if (next === input.previewPath) return;
    setIsNavigating(true);
    try {
      const isAuthorized = await input.onAuthorizeNavigation?.();
      if (!isAuthorized) {
        toast.error("Preview access couldn't be refreshed. Try again.");
        element.value = input.previewPath;
        return;
      }
      input.navigatePreviewPath(next);
    } finally {
      setIsNavigating(false);
    }
  };
  return { commitPath, isNavigating };
}
