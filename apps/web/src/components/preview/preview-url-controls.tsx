"use client";

import { useState } from "react";
import { toast } from "sonner";
import { buildPreviewIframeSrc } from "@/components/preview/url-bar";
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "@/components/ui";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

const CONTROL_CLASS =
  "flex size-6 shrink-0 items-center justify-center rounded-full p-1 text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30";

export function PreviewNavigationControls({
  onAuthorizeNavigation,
  onRefresh,
  previewUrl,
}: {
  onAuthorizeNavigation?: () => Promise<boolean>;
  onRefresh?: () => Promise<void>;
  previewUrl: string | null;
}) {
  const previewPathHistory = useAppStore((state) => state.previewPathHistory);
  const goBackPreviewPath = useAppStore((state) => state.goBackPreviewPath);
  const actions = usePreviewNavigationActions(onAuthorizeNavigation, onRefresh, goBackPreviewPath);
  return (
    <div className="flex items-center gap-0.5">
      <button
        aria-label="Go back"
        aria-busy={actions.pending === "back"}
        className={CONTROL_CLASS}
        disabled={!previewUrl || previewPathHistory.length === 0 || actions.pending !== null}
        onClick={() => void actions.goBack()}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Go forward" className={CONTROL_CLASS} disabled type="button">
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        aria-label="Refresh"
        aria-busy={actions.pending === "refresh"}
        className={CONTROL_CLASS}
        disabled={!previewUrl || !onRefresh || actions.pending !== null}
        onClick={() => void actions.refresh()}
        type="button"
      >
        <RefreshCw
          aria-hidden="true"
          className={cn("h-3 w-3", actions.pending === "refresh" ? "animate-spin" : null)}
        />
      </button>
    </div>
  );
}

function usePreviewNavigationActions(
  onAuthorizeNavigation: (() => Promise<boolean>) | undefined,
  onRefresh: (() => Promise<void>) | undefined,
  goBackPreviewPath: () => void,
) {
  const [pending, setPending] = useState<"back" | "refresh" | null>(null);
  const goBack = async () => {
    if (!onAuthorizeNavigation || pending) return;
    setPending("back");
    try {
      if (await onAuthorizeNavigation()) goBackPreviewPath();
      else toast.error("Preview access couldn't be refreshed. Try again.");
    } finally {
      setPending(null);
    }
  };
  const refresh = async () => {
    if (!onRefresh || pending) return;
    setPending("refresh");
    try {
      await onRefresh();
    } finally {
      setPending(null);
    }
  };
  return { goBack, pending, refresh };
}

export function PreviewExternalLink({
  onAuthorizeNavigation,
  previewUrl,
}: {
  onAuthorizeNavigation?: () => Promise<boolean>;
  previewUrl: string | null;
}) {
  const previewPath = useAppStore((state) => state.previewPath);
  const { isOpening, openPreview } = useOpenPreview(onAuthorizeNavigation, previewPath);
  if (!previewUrl) {
    return (
      <button
        aria-label="Open preview in a new tab"
        className={CONTROL_CLASS}
        disabled
        type="button"
      >
        <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    );
  }
  return (
    <button
      aria-label="Open preview in a new tab"
      aria-busy={isOpening}
      className={CONTROL_CLASS}
      disabled={isOpening || !onAuthorizeNavigation}
      onClick={() => void openPreview()}
      type="button"
    >
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
    </button>
  );
}

function useOpenPreview(
  onAuthorizeNavigation: (() => Promise<boolean>) | undefined,
  previewPath: string,
) {
  const [isOpening, setIsOpening] = useState(false);
  const openPreview = async () => {
    if (!onAuthorizeNavigation || isOpening) return;
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
      toast.error("Allow pop-ups to open the preview in a new tab.");
      return;
    }
    popup.opener = null;
    setIsOpening(true);
    try {
      const isAuthorized = await onAuthorizeNavigation();
      const freshPreviewUrl = useAppStore.getState().previewUrl;
      if (!isAuthorized || !freshPreviewUrl) {
        popup.close();
        toast.error("Preview access couldn't be refreshed. Try again.");
        return;
      }
      popup.location.replace(buildPreviewIframeSrc(freshPreviewUrl, previewPath, 0));
    } finally {
      setIsOpening(false);
    }
  };
  return { isOpening, openPreview };
}
