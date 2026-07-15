"use client";

import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "@/components/ui/icons";
import { buildPreviewIframeSrc } from "@/lib/preview/url-bar";
import { useAppStore } from "@/lib/store/app-store";

const CONTROL_CLASS =
  "flex size-6 shrink-0 items-center justify-center rounded-full p-1 text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30";

export function PreviewNavigationControls({ previewUrl }: { previewUrl: string | null }) {
  const previewPathHistory = useAppStore((state) => state.previewPathHistory);
  const bumpPreviewReloadToken = useAppStore((state) => state.bumpPreviewReloadToken);
  const goBackPreviewPath = useAppStore((state) => state.goBackPreviewPath);
  return (
    <div className="flex items-center gap-0.5">
      <button
        aria-label="Go back"
        className={CONTROL_CLASS}
        disabled={!previewUrl || previewPathHistory.length === 0}
        onClick={goBackPreviewPath}
        type="button"
      >
        <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button aria-label="Go forward" className={CONTROL_CLASS} disabled type="button">
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        aria-label="Refresh"
        className={CONTROL_CLASS}
        disabled={!previewUrl}
        onClick={bumpPreviewReloadToken}
        type="button"
      >
        <RefreshCw aria-hidden="true" className="h-3 w-3" />
      </button>
    </div>
  );
}

export function PreviewExternalLink({ previewUrl }: { previewUrl: string | null }) {
  const previewPath = useAppStore((state) => state.previewPath);
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
    <a
      aria-label="Open preview in a new tab"
      className={CONTROL_CLASS}
      href={buildPreviewIframeSrc(previewUrl, previewPath, 0)}
      referrerPolicy="origin"
      rel="noopener"
      target="_blank"
    >
      <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
    </a>
  );
}
