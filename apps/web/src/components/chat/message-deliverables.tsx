import { artifactFallbackName, formatBytes } from "@/components/chat/message-deliverable-model";
import type { ArtifactData } from "@/components/chat/message-parts.types";
import {
  Code,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Folder,
  Image as ImageIcon,
  Link as LinkIcon,
  Presentation,
} from "@/components/ui/icons";

export function DeliverablesBlock({ items }: { items: readonly ArtifactData[] }) {
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
          <DeliverableChip data={item} key={item.outputId} />
        ))}
      </div>
    </div>
  );
}

function DeliverableChip({ data }: { data: ArtifactData }) {
  const Icon = deliverableIcon(data.kind, data.mimeType);
  const label = data.filename ?? artifactFallbackName(data);
  const isLink = data.kind === "link";
  const sizeLabel = typeof data.sizeBytes === "number" ? formatBytes(data.sizeBytes) : null;
  const meta = [data.kind, sizeLabel].filter(Boolean).join(" · ");
  return (
    <div className="flex items-center gap-2.5 rounded-[10px] border border-border bg-background px-2.5 py-2">
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-fg-secondary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] text-foreground">{label}</div>
        <div className="text-[11px] text-placeholder">{meta}</div>
      </div>
      <a
        aria-label={`${isLink ? "Open" : "Download"} ${label} in a new tab`}
        className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-fg-secondary transition-colors hover:text-foreground"
        href={data.downloadUrl}
        rel="noreferrer"
        target="_blank"
        {...(isLink ? {} : { download: true })}
      >
        <DeliverableActionIcon isLink={isLink} />
        {isLink ? "open" : "download"}
      </a>
    </div>
  );
}

function DeliverableActionIcon({ isLink }: { isLink: boolean }) {
  return isLink ? (
    <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
  ) : (
    <Download aria-hidden="true" className="h-3.5 w-3.5" />
  );
}

function deliverableIcon(kind: ArtifactData["kind"], mimeType: string) {
  if (kind === "folder") return Folder;
  if (kind === "link") return LinkIcon;
  if (kind === "slide") return Presentation;
  if (kind === "xlsx") return FileSpreadsheet;
  if (kind === "image" || mimeType.startsWith("image/")) return ImageIcon;
  if (kind === "pdf" || kind === "docx") return FileText;
  if (mimeType.startsWith("text/") || mimeType.includes("json")) return Code;
  return FileText;
}
