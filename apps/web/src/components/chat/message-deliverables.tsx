"use client";

import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { formatBytes } from "@/components/chat/message-deliverable-model";
import { MessageDoubleShell } from "@/components/chat/message-part-blocks";
import type { ArtifactData } from "@/components/chat/message-parts.types";
import {
  type OutputImagePreviewState,
  useLazyOutputImagePreview,
} from "@/components/chat/output-image-preview";
import type { OutputPreviewState } from "@/components/chat/output-preview-support";
import { useLazyOutputVideoPreview } from "@/components/chat/output-video-preview";
import {
  Code,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  ModalShell,
  Presentation,
  Video,
  X,
} from "@/components/ui";
import { createOutputDownloadUrl } from "@/lib/api/outputs";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

interface DeliverablesBlockProps {
  items: readonly ArtifactData[];
  threadId: string;
}

export function DeliverablesBlock({ items, threadId }: DeliverablesBlockProps) {
  useAutoOpenLatestMedia(items, threadId);
  return (
    <div data-chat-deliverables="true">
      <MessageDoubleShell innerClassName="p-3">
        <div className="mb-2 text-[10px] text-thread-text-muted uppercase tracking-[0.18em]">
          Deliverables
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <DeliverableCard data={item} key={item.outputId} threadId={threadId} />
          ))}
        </div>
      </MessageDoubleShell>
    </div>
  );
}

function DeliverableCard({ data, threadId }: { data: ArtifactData; threadId: string }) {
  const { getToken } = useAuth();
  const download = useDeliverableDownload(data, getToken);
  if (isImageArtifact(data)) {
    return (
      <ImageDeliverableCard
        data={data}
        download={download}
        getToken={getToken}
        threadId={threadId}
      />
    );
  }
  if (isVideoArtifact(data)) {
    return (
      <VideoDeliverableCard
        data={data}
        download={download}
        getToken={getToken}
        threadId={threadId}
      />
    );
  }
  return <FileDeliverableCard data={data} download={download} />;
}

function VideoDeliverableCard({
  data,
  download,
  getToken,
  threadId,
}: {
  data: ArtifactData;
  download: DeliverableDownload;
  getToken: () => Promise<null | string>;
  threadId: string;
}) {
  const preview = useLazyOutputVideoPreview(data, getToken);
  const openInFiles = useOpenMediaInFiles(data, threadId, "video");
  return (
    <div className="overflow-hidden rounded-[12px] border border-border bg-background">
      <VideoPreview data={data} preview={preview} />
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2.5">
        <Video aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-secondary" />
        <DeliverableMetadata data={data} />
        <button
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={openInFiles}
          type="button"
        >
          <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
          Open in Files
        </button>
        <DownloadButton download={download} filename={data.filename} />
      </div>
    </div>
  );
}

function VideoPreview({ data, preview }: { data: ArtifactData; preview: OutputPreviewState }) {
  return (
    <div
      className="relative aspect-video w-full overflow-hidden bg-secondary"
      ref={preview.hostRef}
    >
      {preview.url ? (
        // Generated assets do not include a timed-text sidecar to attach here.
        // biome-ignore lint/a11y/useMediaCaption: No caption track exists for arbitrary provider output.
        <video
          aria-label={`Generated video: ${readableFilename(data.filename)}`}
          className="h-full w-full bg-black object-contain"
          controls
          playsInline
          preload="metadata"
          src={preview.url}
        />
      ) : (
        <VideoPreviewPlaceholder message={preview.message} status={preview.status} />
      )}
    </div>
  );
}

function VideoPreviewPlaceholder({
  message,
  status,
}: Pick<OutputPreviewState, "message" | "status">) {
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
        <Video aria-hidden="true" className="h-5 w-5" />
      )}
      <span>{isLoading ? "Preparing video…" : (message ?? "Video preview unavailable")}</span>
    </div>
  );
}

function FileDeliverableCard({
  data,
  download,
}: {
  data: ArtifactData;
  download: DeliverableDownload;
}) {
  const Icon = deliverableIcon(data.kind, data.mimeType);
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-background px-2.5 py-2">
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-secondary" />
      <DeliverableMetadata data={data} />
      <DownloadButton download={download} filename={data.filename} />
    </div>
  );
}

function ImageDeliverableCard({
  data,
  download,
  getToken,
  threadId,
}: {
  data: ArtifactData;
  download: DeliverableDownload;
  getToken: () => Promise<null | string>;
  threadId: string;
}) {
  const [isViewerOpen, setViewerOpen] = useState(false);
  const preview = useLazyOutputImagePreview(data, getToken);
  const openInFiles = useOpenMediaInFiles(data, threadId, "image", () => setViewerOpen(false));
  return (
    <div className="overflow-hidden rounded-[12px] border border-border bg-background">
      <ImageThumbnail data={data} onOpen={() => setViewerOpen(true)} preview={preview} />
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-2.5">
        <ImageIcon aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-secondary" />
        <DeliverableMetadata data={data} />
        <button
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] text-fg-secondary transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={openInFiles}
          type="button"
        >
          <FolderOpen aria-hidden="true" className="h-3.5 w-3.5" />
          Open in Files
        </button>
        <DownloadButton download={download} filename={data.filename} />
      </div>
      <ImageViewer
        data={data}
        download={download}
        onClose={() => setViewerOpen(false)}
        onOpenInFiles={openInFiles}
        open={isViewerOpen}
        previewUrl={preview.url}
      />
    </div>
  );
}

function ImageThumbnail({
  data,
  onOpen,
  preview,
}: {
  data: ArtifactData;
  onOpen: () => void;
  preview: OutputImagePreviewState;
}) {
  return (
    <div
      className="relative aspect-[4/3] w-full overflow-hidden bg-secondary"
      ref={preview.hostRef}
    >
      {preview.url ? (
        <button
          aria-label={`View ${data.filename}`}
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
        <ImagePreviewPlaceholder message={preview.message} status={preview.status} />
      )}
    </div>
  );
}

function ImagePreviewPlaceholder({
  message,
  status,
}: Pick<OutputImagePreviewState, "message" | "status">) {
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
      <span>{isLoading ? "Preparing preview…" : (message ?? "Preview unavailable")}</span>
    </div>
  );
}

function ImageViewer({
  data,
  download,
  onClose,
  onOpenInFiles,
  open,
  previewUrl,
}: {
  data: ArtifactData;
  download: DeliverableDownload;
  onClose: () => void;
  onOpenInFiles: () => void;
  open: boolean;
  previewUrl: string | null;
}) {
  const titleId = useId();
  return (
    <ModalShell
      className="h-[min(92dvh,960px)] max-w-[min(96vw,1280px)] overflow-hidden rounded-[18px]"
      labelledBy={titleId}
      onClose={onClose}
      open={open}
    >
      <div className="flex h-full min-h-0 flex-col bg-background">
        <ImageViewerHeader
          data={data}
          download={download}
          onClose={onClose}
          onOpenInFiles={onOpenInFiles}
          titleId={titleId}
        />
        <div className="relative min-h-0 flex-1 bg-secondary/60">
          {previewUrl ? (
            <Image
              alt={imageAlt(data.filename)}
              className="object-contain"
              fill
              sizes="96vw"
              src={previewUrl}
              unoptimized
            />
          ) : null}
        </div>
      </div>
    </ModalShell>
  );
}

function ImageViewerHeader({
  data,
  download,
  onClose,
  onOpenInFiles,
  titleId,
}: {
  data: ArtifactData;
  download: DeliverableDownload;
  onClose: () => void;
  onOpenInFiles: () => void;
  titleId: string;
}) {
  return (
    <div className="flex min-h-14 items-center gap-2 border-border border-b px-3 sm:px-4">
      <h2 className="min-w-0 flex-1 truncate font-medium text-[13px]" id={titleId}>
        {data.filename}
      </h2>
      <button
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-fg-secondary hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onOpenInFiles}
        type="button"
      >
        <FolderOpen aria-hidden="true" className="h-4 w-4" />
        <span className="hidden sm:inline">Open in Files</span>
      </button>
      <DownloadButton download={download} filename={data.filename} prominent />
      <button
        aria-label="Close image viewer"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-secondary hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onClose}
        type="button"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  );
}

interface DeliverableDownload {
  isPreparing: boolean;
  start: () => Promise<void>;
}

function DownloadButton({
  download,
  filename,
  prominent = false,
}: {
  download: DeliverableDownload;
  filename: string;
  prominent?: boolean;
}) {
  return (
    <button
      aria-busy={download.isPreparing || undefined}
      aria-label={download.isPreparing ? `Preparing ${filename}` : `Download ${filename}`}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60",
        prominent
          ? "bg-foreground px-3 text-background hover:opacity-85"
          : "text-fg-secondary hover:bg-secondary hover:text-foreground",
      )}
      disabled={download.isPreparing}
      onClick={() => void download.start()}
      type="button"
    >
      {download.isPreparing ? (
        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
      )}
      <span className={cn(prominent && "hidden sm:inline")}>
        {download.isPreparing ? "preparing…" : "download"}
      </span>
    </button>
  );
}

function DeliverableMetadata({ data }: { data: ArtifactData }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="truncate text-[13px] text-foreground">{data.filename}</div>
      <div className="text-[11px] text-placeholder">
        {data.kind} · {formatBytes(data.sizeBytes)}
      </div>
    </div>
  );
}

function useDeliverableDownload(
  data: ArtifactData,
  getToken: () => Promise<null | string>,
): DeliverableDownload {
  const [isPreparing, setIsPreparing] = useState(false);
  const start = async (): Promise<void> => {
    if (isPreparing) return;
    setIsPreparing(true);
    try {
      const capability = await createOutputDownloadUrl(getToken, data.outputId);
      window.location.assign(capability.downloadUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Download could not be prepared");
    } finally {
      setIsPreparing(false);
    }
  };
  return { isPreparing, start };
}

function useOpenMediaInFiles(
  data: ArtifactData,
  threadId: string,
  type: "image" | "video",
  afterOpen: () => void = () => undefined,
) {
  const requestFileOpen = useAppStore((state) => state.requestFileOpen);
  const setActiveComputerTab = useAppStore((state) => state.setActiveComputerTab);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  return () => {
    const path = mediaWorkspacePath(data, type);
    if (!path) {
      toast.error(`This ${type} does not have a safe workspace path.`);
      return;
    }
    requestFileOpen(threadId, path);
    setActiveComputerTab("files");
    setPreviewPanelOpen(true);
    afterOpen();
  };
}

function useAutoOpenLatestMedia(items: readonly ArtifactData[], threadId: string): void {
  const activeComputerTab = useAppStore((state) => state.activeComputerTab);
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const requestFileOpen = useAppStore((state) => state.requestFileOpen);
  const latestMedia = items.findLast((item) => isImageArtifact(item) || isVideoArtifact(item));
  const latestMediaPath = latestMedia
    ? mediaWorkspacePath(latestMedia, isVideoArtifact(latestMedia) ? "video" : "image")
    : null;
  useEffect(() => {
    if (!previewPanelOpen || activeComputerTab !== "files" || !latestMediaPath) return;
    requestFileOpen(threadId, latestMediaPath);
  }, [activeComputerTab, latestMediaPath, previewPanelOpen, requestFileOpen, threadId]);
}

function mediaWorkspacePath(data: ArtifactData, type: "image" | "video"): string | null {
  const matchesType = type === "image" ? isImageArtifact(data) : isVideoArtifact(data);
  if (!matchesType || /[/\\]/u.test(data.filename) || data.filename.includes("..")) {
    return null;
  }
  return `.cheatcode/assets/${type === "image" ? "images" : "videos"}/${data.filename}`;
}

function imageAlt(filename: string): string {
  const readable = readableFilename(filename);
  return readable ? `Generated image: ${readable}` : "Generated image";
}

function readableFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/u, "")
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isImageArtifact(data: ArtifactData): boolean {
  return data.kind === "image" || data.mimeType.startsWith("image/");
}

function isVideoArtifact(data: ArtifactData): boolean {
  return data.kind === "video" || data.mimeType.startsWith("video/");
}

function deliverableIcon(kind: ArtifactData["kind"], mimeType: string) {
  if (kind === "slide") return Presentation;
  if (kind === "xlsx") return FileSpreadsheet;
  if (kind === "image" || mimeType.startsWith("image/")) return ImageIcon;
  if (kind === "video" || mimeType.startsWith("video/")) return Video;
  if (kind === "pdf" || kind === "docx") return FileText;
  if (mimeType.startsWith("text/") || mimeType.includes("json")) return Code;
  return FileText;
}
