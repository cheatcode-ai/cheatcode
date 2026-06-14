import { hmacSha256Base64 } from "@cheatcode/auth";

/**
 * Preview URL contract (shared with apps/preview-proxy). The DO mints a
 * Cheatcode access token and returns a proxy URL; the preview-proxy verifies the
 * token, then injects the Daytona preview headers server-side. Two modes:
 *  - "app":       long-lived, refreshed by the client (app-preview iframe).
 *  - "takeover":  short-lived (noVNC takeover).
 *
 * Token = `${sandboxId}.${port}.${exp}.${mode}.${sig}`, sig = standard-base64
 * HMAC-SHA256 over the prefix (no '.' in the base64 alphabet → 5 dot parts).
 * `sandboxId` is the Daytona sandbox UUID so the proxy can call getPreviewLink.
 */

export type PreviewTokenMode = "app" | "takeover";

export interface BuildPreviewUrlInput {
  sandboxId: string;
  port: number;
  hostname: string;
  mode: PreviewTokenMode;
  ttlMs: number;
  secret: string;
}

export interface BuiltPreviewUrl {
  url: string;
  token: string;
}

export async function buildPreviewUrl(input: BuildPreviewUrlInput): Promise<BuiltPreviewUrl> {
  const exp = Date.now() + input.ttlMs;
  const prefix = `${input.sandboxId}.${input.port}.${exp}.${input.mode}`;
  const sig = await hmacSha256Base64(prefix, input.secret);
  const token = `${prefix}.${sig}`;
  const host = `${input.sandboxId}--${input.port}.${normalizeHostname(input.hostname)}`;
  const url = `https://${host}/?__cc_pt=${encodeURIComponent(token)}`;
  return { url, token };
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  const withoutScheme = trimmed.includes("://") ? (trimmed.split("://")[1] ?? trimmed) : trimmed;
  return withoutScheme.replace(/\/.*$/, "").replace(/\.$/, "");
}
