import { APIError } from "@cheatcode/observability";
import type { ArtifactKind, ArtifactUploadResult } from "@cheatcode/tools-code";
import type { MediaRuntimeContext } from "./runtime";
import { mediaFetch, requireArtifactRuntime } from "./runtime";

export interface ProviderFile {
  contentType?: string | undefined;
  fileName?: string | undefined;
  fileSize?: number | undefined;
  url: string;
}

export interface StoredMediaArtifact extends ArtifactUploadResult {
  providerUrl?: string | undefined;
}

export async function storeRemoteMediaArtifact(input: {
  fallbackFilename: string;
  fallbackMimeType: string;
  file: ProviderFile;
  kind: ArtifactKind;
  metadata: Record<string, unknown>;
  runtimeContext: MediaRuntimeContext;
}): Promise<StoredMediaArtifact> {
  const response = await mediaFetch(input.runtimeContext)(input.file.url);
  if (!response.ok) {
    throw new APIError(502, "upstream_provider_outage", "Generated media download failed", {
      details: { status: response.status },
      retriable: true,
    });
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const contentType =
    input.file.contentType ?? response.headers.get("content-type") ?? input.fallbackMimeType;
  const filename = normalizeFilename(
    input.file.fileName ?? filenameFromUrl(input.file.url) ?? input.fallbackFilename,
    extensionFromContentType(contentType),
  );
  const artifact = await storeBytesMediaArtifact({
    contentType,
    data: bytes,
    filename,
    kind: input.kind,
    metadata: {
      ...input.metadata,
      providerFileSize: input.file.fileSize,
      providerUrl: input.file.url,
    },
    runtimeContext: input.runtimeContext,
  });
  return { ...artifact, providerUrl: input.file.url };
}

export async function storeBytesMediaArtifact(input: {
  contentType: string;
  data: Uint8Array;
  filename: string;
  kind: ArtifactKind;
  metadata: Record<string, unknown>;
  runtimeContext: MediaRuntimeContext;
}): Promise<StoredMediaArtifact> {
  const artifacts = requireArtifactRuntime(input.runtimeContext);
  return artifacts.put({
    contentType: input.contentType,
    data: input.data,
    filename: normalizeFilename(input.filename, extensionFromContentType(input.contentType)),
    kind: input.kind,
    metadata: input.metadata,
  });
}

export function normalizeFilename(value: string, fallbackExtension: string): string {
  const trimmed = value.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  const extension = dotIndex > 0 ? trimmed.slice(dotIndex + 1) : fallbackExtension;
  const baseValue = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
  const base = baseValue
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  const safeBase = base.length > 0 ? base : "cheatcode-output";
  const safeExtension = extension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12);
  return safeExtension ? `${safeBase}.${safeExtension}` : safeBase;
}

export function extensionFromContentType(contentType: string): string {
  const lower = contentType.toLowerCase();
  if (lower.includes("png")) {
    return "png";
  }
  if (lower.includes("jpeg") || lower.includes("jpg")) {
    return "jpg";
  }
  if (lower.includes("webp")) {
    return "webp";
  }
  if (lower.includes("mp4")) {
    return "mp4";
  }
  if (lower.includes("mpeg") || lower.includes("mp3")) {
    return "mp3";
  }
  if (lower.includes("wav")) {
    return "wav";
  }
  return "bin";
}

function filenameFromUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    const segment = parsed.pathname.split("/").filter(Boolean).at(-1);
    return segment?.includes(".") ? segment : undefined;
  } catch {
    return undefined;
  }
}
