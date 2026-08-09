"use client";

import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import { useId, useState } from "react";
import type { ToolEvidenceData } from "@/components/chat/message-parts.types";
import {
  type OutputImagePreviewState,
  useLazyOutputImagePreview,
} from "@/components/chat/output-image-preview";
import { Eye, Image as ImageIcon, Loader2, ModalShell, X } from "@/components/ui";
import { cn } from "@/lib/ui/cn";

export function ToolEvidenceImage({ data }: { data: ToolEvidenceData }) {
  const { getToken } = useAuth();
  const [isViewerOpen, setViewerOpen] = useState(false);
  const titleId = useId();
  const preview = useLazyOutputImagePreview(data, getToken);

  return (
    <div className="overflow-hidden rounded-[16px] border-2 border-border bg-background dark:border-[#252525] dark:bg-[#151515]">
      <EvidenceThumbnail onOpen={() => setViewerOpen(true)} preview={preview} />
      <EvidenceViewer
        onClose={() => setViewerOpen(false)}
        open={isViewerOpen}
        titleId={titleId}
        url={preview.url}
      />
    </div>
  );
}

function EvidenceThumbnail({
  onOpen,
  preview,
}: {
  onOpen: () => void;
  preview: OutputImagePreviewState;
}) {
  return (
    <div
      className="relative aspect-video w-full overflow-hidden bg-secondary"
      ref={preview.hostRef}
    >
      {preview.url ? (
        <button
          aria-label="View captured browser screenshot"
          className="group relative h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={onOpen}
          type="button"
        >
          <Image
            alt=""
            className="object-contain transition-transform duration-200 ease-out group-hover:scale-[1.01] motion-reduce:transition-none"
            fill
            sizes="(max-width: 767px) 100vw, 520px"
            src={preview.url}
            unoptimized
          />
          <span className="absolute right-2 bottom-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-black/70 px-2.5 font-medium text-[11px] text-white backdrop-blur-sm">
            <Eye aria-hidden="true" className="h-3.5 w-3.5" />
            View
          </span>
        </button>
      ) : (
        <EvidencePlaceholder message={preview.message} status={preview.status} />
      )}
    </div>
  );
}

function EvidenceViewer({
  onClose,
  open,
  titleId,
  url,
}: {
  onClose: () => void;
  open: boolean;
  titleId: string;
  url: string | null;
}) {
  return (
    <ModalShell
      className="h-[min(92dvh,960px)] max-w-[min(96vw,1280px)] overflow-hidden rounded-[18px]"
      labelledBy={titleId}
      onClose={onClose}
      open={open}
    >
      <div className="flex h-full min-h-0 flex-col bg-background">
        <EvidenceViewerHeader onClose={onClose} titleId={titleId} />
        <div className="relative min-h-0 flex-1 bg-secondary/60">
          {url ? (
            <Image
              alt="Browser screenshot captured by the agent"
              className="object-contain"
              fill
              sizes="96vw"
              src={url}
              unoptimized
            />
          ) : null}
        </div>
      </div>
    </ModalShell>
  );
}

function EvidenceViewerHeader({ onClose, titleId }: { onClose: () => void; titleId: string }) {
  return (
    <div className="flex min-h-14 items-center gap-2 border-border border-b px-3 sm:px-4">
      <h2 className="min-w-0 flex-1 truncate font-medium text-[13px]" id={titleId}>
        Browser screenshot
      </h2>
      <button
        aria-label="Close screenshot viewer"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-secondary hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

function EvidencePlaceholder({
  message,
  status,
}: {
  message: string | null;
  status: "error" | "idle" | "loading" | "ready";
}) {
  const isLoading = status === "idle" || status === "loading";
  return (
    <div
      aria-live="polite"
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 p-5 text-center text-[12px] text-fg-secondary",
        isLoading && "motion-safe:animate-pulse",
      )}
    >
      {isLoading ? (
        <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin motion-reduce:animate-none" />
      ) : (
        <ImageIcon aria-hidden="true" className="h-5 w-5" />
      )}
      <span>{isLoading ? "Loading screenshot…" : (message ?? "Screenshot unavailable")}</span>
    </div>
  );
}
