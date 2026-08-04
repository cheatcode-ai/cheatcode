"use client";

import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { formatBytes } from "@/components/chat/message-deliverable-model";
import type { ArtifactData } from "@/components/chat/message-parts.types";
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
import { createOutputDownloadUrl, loadOutputImagePreview } from "@/lib/api/outputs";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/ui/cn";

interface DeliverablesBlockProps {
  items: readonly ArtifactData[];
  threadId: string;
}

export function DeliverablesBlock({ items, threadId }: DeliverablesBlockProps) {
  useAutoOpenLatestImage(items, threadId);
  return (
    <div
      className="cc-fade-in rounded-[14px] border border-thread-border bg-[var(--thread-code-bg)] p-3"
      data-chat-deliverables="true"
    >
      <div className="mb-2 text-[10px] text-thread-text-muted uppercase tracking-[0.18em]">
        Deliverables
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <DeliverableCard data={item} key={item.outputId} threadId={threadId} />
        ))}
      </div>
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
  return <FileDeliverableCard data={data} download={download} />;
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
  const preview = useLazyImagePreview(data, getToken);
  const openInFiles = useOpenImageInFiles(data, threadId, () => setViewerOpen(false));
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

interface ImagePreview {
  hostRef: RefObject<HTMLDivElement | null>;
  message: string | null;
  status: "error" | "idle" | "loading" | "ready";
  url: string | null;
}

function ImageThumbnail({
  data,
  onOpen,
  preview,
}: {
  data: ArtifactData;
  onOpen: () => void;
  preview: ImagePreview;
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

function ImagePreviewPlaceholder({ message, status }: Pick<ImagePreview, "message" | "status">) {
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

function useLazyImagePreview(
  data: ArtifactData,
  getToken: () => Promise<null | string>,
): ImagePreview {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const getTokenRef = useRef(getToken);
  const isNearViewport = useNearViewport(hostRef);
  const [preview, setPreview] = useState<Omit<ImagePreview, "hostRef">>({
    message: null,
    status: "idle",
    url: null,
  });
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);
  useEffect(() => {
    if (!isNearViewport) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setPreview({ message: null, status: "loading", url: null });
    void loadOutputImagePreview(
      () => getTokenRef.current(),
      data.outputId,
      data.sizeBytes,
      controller.signal,
    )
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setPreview({ message: null, status: "ready", url: objectUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPreview({
          message: error instanceof Error ? error.message : "Preview unavailable",
          status: "error",
          url: null,
        });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [data.outputId, data.sizeBytes, isNearViewport]);
  return { ...preview, hostRef };
}

function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [isNear, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        observer.disconnect();
      },
      { rootMargin: "320px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return isNear;
}

function useOpenImageInFiles(data: ArtifactData, threadId: string, afterOpen: () => void) {
  const requestFileOpen = useAppStore((state) => state.requestFileOpen);
  const setActivePreviewTab = useAppStore((state) => state.setActivePreviewTab);
  const setPreviewPanelOpen = useAppStore((state) => state.setPreviewPanelOpen);
  return () => {
    const path = imageWorkspacePath(data);
    if (!path) {
      toast.error("This image does not have a safe workspace path.");
      return;
    }
    requestFileOpen(threadId, path);
    setActivePreviewTab("files");
    setPreviewPanelOpen(true);
    afterOpen();
  };
}

function useAutoOpenLatestImage(items: readonly ArtifactData[], threadId: string): void {
  const activePreviewTab = useAppStore((state) => state.activePreviewTab);
  const previewPanelOpen = useAppStore((state) => state.previewPanelOpen);
  const requestFileOpen = useAppStore((state) => state.requestFileOpen);
  const latestImage = items.findLast(isImageArtifact);
  const latestImagePath = latestImage ? imageWorkspacePath(latestImage) : null;
  useEffect(() => {
    if (!previewPanelOpen || activePreviewTab !== "files" || !latestImagePath) return;
    requestFileOpen(threadId, latestImagePath);
  }, [activePreviewTab, latestImagePath, previewPanelOpen, requestFileOpen, threadId]);
}

function imageWorkspacePath(data: ArtifactData): string | null {
  if (!isImageArtifact(data) || /[/\\]/u.test(data.filename) || data.filename.includes("..")) {
    return null;
  }
  return `.cheatcode/assets/images/${data.filename}`;
}

function imageAlt(filename: string): string {
  const readable = filename
    .replace(/\.[^.]+$/u, "")
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return readable ? `Generated image: ${readable}` : "Generated image";
}

function isImageArtifact(data: ArtifactData): boolean {
  return data.kind === "image" || data.mimeType.startsWith("image/");
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
