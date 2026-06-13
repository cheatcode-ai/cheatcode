import type { SandboxInstance } from "@blaxel/core";

interface BlaxelPreviewSpec {
  customDomain?: string;
  port: number;
  prefixUrl?: string;
  public: boolean;
}

interface BlaxelPreview {
  spec?: {
    customDomain?: string;
    port?: number;
    prefixUrl?: string;
    public?: boolean;
    url?: string;
  };
  tokens: {
    create(expiresAt: Date): Promise<{ value: string }>;
  };
}

export function buildPreviewSpec({
  hostname,
  name,
  port,
  public: isPublic,
  sandboxId,
}: {
  hostname: string | undefined;
  name: string;
  port: number;
  public: boolean;
  sandboxId: string;
}): BlaxelPreviewSpec {
  const customDomain = customPreviewDomain(hostname);
  if (!customDomain) {
    return { port, public: isPublic };
  }
  return {
    customDomain,
    port,
    prefixUrl: previewPrefix(name, sandboxId),
    public: isPublic,
  };
}

export async function createOrReplacePreview({
  name,
  sandbox,
  spec,
}: {
  name: string;
  sandbox: SandboxInstance;
  spec: BlaxelPreviewSpec;
}): Promise<BlaxelPreview> {
  const existing = await getPreviewOrNull(sandbox, name);
  if (existing && previewSpecMatches(existing.spec, spec)) {
    return existing;
  }
  if (existing) {
    await sandbox.previews.delete(name);
  }
  return sandbox.previews.createIfNotExists({ metadata: { name }, spec });
}

export function previewUrl(preview: { spec?: { url?: string } }): string {
  const url = preview.spec?.url;
  if (!url) {
    throw new Error("Blaxel preview did not return a URL.");
  }
  return url;
}

async function getPreviewOrNull(
  sandbox: SandboxInstance,
  name: string,
): Promise<BlaxelPreview | undefined> {
  try {
    return await sandbox.previews.get(name);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

function customPreviewDomain(hostname: string | undefined): string | undefined {
  const normalized = normalizeHostname(hostname);
  if (!normalized || isLocalPreviewHost(normalized)) {
    return undefined;
  }
  return normalized;
}

function normalizeHostname(hostname: string | undefined): string | undefined {
  const trimmed = hostname?.trim();
  if (!trimmed) {
    return undefined;
  }
  const candidate = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return undefined;
  }
}

function isLocalPreviewHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname.startsWith("127.")
  );
}

function previewPrefix(name: string, sandboxId: string): string {
  const safeName = dnsLabel(name).slice(0, 32) || "preview";
  const safeSandbox = dnsLabel(sandboxId).replaceAll("-", "").slice(0, 24);
  const prefix = safeSandbox ? `${safeName}-${safeSandbox}` : safeName;
  return prefix.slice(0, 63).replace(/-+$/, "") || "preview";
}

function dnsLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function previewSpecMatches(
  actual: BlaxelPreview["spec"] | undefined,
  expected: BlaxelPreviewSpec,
): boolean {
  return (
    actual?.port === expected.port &&
    actual.public === expected.public &&
    normalizedOptional(actual.customDomain) === normalizedOptional(expected.customDomain) &&
    normalizedOptional(actual.prefixUrl) === normalizedOptional(expected.prefixUrl)
  );
}

function normalizedOptional(value: string | undefined): string {
  return value ?? "";
}

function isNotFoundError(error: unknown): boolean {
  const record = asRecord(error);
  if (!record) {
    return false;
  }
  const response = asRecord(record["response"]);
  return (
    record["status"] === 404 ||
    record["code"] === 404 ||
    record["code"] === "404" ||
    record["code"] === "NOT_FOUND" ||
    response?.["status"] === 404
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
