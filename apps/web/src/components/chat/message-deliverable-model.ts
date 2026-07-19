import type { ArtifactData, MessagePart } from "@/components/chat/message-parts.types";

export function collectDeliverables(parts: readonly MessagePart[]): ArtifactData[] {
  const deliverables: ArtifactData[] = [];
  for (const part of parts) {
    if (part.type === "data-artifact") deliverables.push(part.data);
  }
  return deliverables;
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
