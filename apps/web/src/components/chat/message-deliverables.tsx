"use client";

import {
  Code,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Presentation,
  Video,
} from "@cheatcode/ui";
import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { toast } from "sonner";
import { formatBytes } from "@/components/chat/message-deliverable-model";
import type { ArtifactData } from "@/components/chat/message-parts.types";
import { createOutputDownloadUrl } from "@/lib/api/outputs";

type GetToken = () => Promise<null | string>;

export function DeliverablesBlock({ items }: { items: readonly ArtifactData[] }) {
  const { getToken } = useAuth();
  return (
    <div
      className="cc-fade-in rounded-[14px] border border-thread-border bg-[var(--thread-code-bg)] p-3"
      data-chat-deliverables="true"
    >
      <div className="mb-2 text-[10px] text-thread-text-muted uppercase tracking-[0.18em]">
        Deliverables
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <DeliverableChip data={item} getToken={getToken} key={item.outputId} />
        ))}
      </div>
    </div>
  );
}

function DeliverableChip({ data, getToken }: { data: ArtifactData; getToken: GetToken }) {
  const [isPreparing, setIsPreparing] = useState(false);
  const Icon = deliverableIcon(data.kind, data.mimeType);
  const label = data.filename;
  const meta = `${data.kind} · ${formatBytes(data.sizeBytes)}`;
  const download = async (): Promise<void> => {
    if (isPreparing) {
      return;
    }
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
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-background px-2.5 py-2">
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-secondary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-foreground">{label}</div>
        <div className="text-[11px] text-placeholder">{meta}</div>
      </div>
      <button
        aria-label={isPreparing ? `Preparing ${label}` : `Download ${label}`}
        className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-fg-secondary transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-60"
        disabled={isPreparing}
        onClick={() => void download()}
        type="button"
      >
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
        {isPreparing ? "preparing…" : "download"}
      </button>
    </div>
  );
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
