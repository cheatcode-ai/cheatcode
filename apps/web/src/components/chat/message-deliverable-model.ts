import type { ArtifactData, MessagePart } from "@/components/chat/message-parts.types";

export function collectDeliverables(parts: readonly MessagePart[]): ArtifactData[] {
  const deliverables: ArtifactData[] = [];
  for (const part of parts) {
    if (part.type === "data-artifact") deliverables.push(part.data);
  }
  return deliverables;
}

export function artifactFallbackName(data: ArtifactData): string {
  const extension = artifactExtension(data.kind, data.mimeType);
  return extension ? `${data.kind}-${data.outputId.slice(0, 8)}.${extension}` : data.kind;
}

function artifactExtension(kind: ArtifactData["kind"], mimeType: string): string | null {
  if (kind === "slide") return "pptx";
  if (kind === "xlsx" || kind === "docx" || kind === "pdf") return kind;
  if (kind === "folder" || kind === "link") return null;
  if (mimeType === "image/svg+xml") return "svg";
  if (!mimeType.includes("/")) return null;
  const extension = mimeType.split("/").at(1)?.split(";").at(0);
  return extension?.replace(/[^a-z0-9]+/gi, "").toLowerCase() || null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units.at(-1)) {
      return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`;
    }
    value /= 1024;
  }
  return `${bytes} B`;
}
