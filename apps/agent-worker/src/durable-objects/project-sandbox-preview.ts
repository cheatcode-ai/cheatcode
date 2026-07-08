import { hmacSha256Base64 } from "@cheatcode/auth";

/**
 * Preview URL contract (shared with apps/preview-proxy). The DO mints a
 * Cheatcode access token and returns a proxy URL; the preview-proxy verifies the
 * token, then injects the Daytona preview headers server-side. Two modes:
 *  - "app":       long-lived, refreshed by the client (app-preview iframe).
 *  - "code":      long-lived, refreshed by the client (embedded Files viewer).
 *  - "takeover":  short-lived (noVNC takeover).
 *
 * Token = `${sandboxId}.${port}.${exp}.${mode}.${sig}`, sig = standard-base64
 * HMAC-SHA256 over the prefix (no '.' in the base64 alphabet → 5 dot parts).
 * `sandboxId` is the Daytona sandbox UUID so the proxy can call getPreviewLink.
 */

export type PreviewTokenMode = "app" | "code" | "takeover";

// The Expo Metro port. Mobile web previews on this port are served under a clean subdomain URL
// (not the path-prefix form) so the client-side Expo Router can match routes — see buildPreviewUrl.
const EXPO_PREVIEW_PORT = 8081;

export interface BuildPreviewUrlInput {
  sandboxId: string;
  port: number;
  hostname: string;
  mode: PreviewTokenMode;
  ttlMs: number;
  secret: string;
}

export interface BuiltPreviewUrl {
  expiresAt: string;
  url: string;
  token: string;
}

export async function buildPreviewUrl(input: BuildPreviewUrlInput): Promise<BuiltPreviewUrl> {
  const exp = Date.now() + input.ttlMs;
  const prefix = `${input.sandboxId}.${input.port}.${exp}.${input.mode}`;
  const sig = await hmacSha256Base64(prefix, input.secret);
  const token = `${prefix}.${sig}`;
  const hostname = normalizeHostname(input.hostname);
  const host = `${input.sandboxId}--${input.port}.${hostname}`;
  const path = `/?__cc_pt=${encodeURIComponent(token)}`;
  if (hostname === "localhost:8787") {
    // Mobile (Expo, port 8081) previews are served under the subdomain form so the browser path
    // stays clean (`/`) — Expo Router routes from window.location and the `/__sandbox/<host>` path
    // prefix yields "Unmatched Route". The local proxy routes this by Host, matching prod's
    // subdomain routing. Other ports (Next.js on 5173) keep the path form, which they tolerate.
    const url =
      input.port === EXPO_PREVIEW_PORT
        ? `http://${host}${path}`
        : `http://${hostname}/__sandbox/${encodePreviewHost(host)}${path}`;
    return { expiresAt: new Date(exp).toISOString(), token, url };
  }
  const url = `https://${host}${path}`;
  return { expiresAt: new Date(exp).toISOString(), url, token };
}

/**
 * Turn a Daytona-signed preview URL (`https://8081-<token>.daytonaproxy01.net`) into an Expo Go
 * deep link by swapping the scheme: `https://` → `exps://` (the daytonaproxy edge is https-only,
 * so the secure Expo scheme is required) and `http://` → `exp://`. The token stays in the host, so
 * Expo Go reaches the Metro manifest with no header/cookie. Keeps the full host/path/query and only
 * trims a trailing slash (unlike the old proxy-derived helper, which dropped the token).
 */
export function signedUrlToExpo(url: string): string {
  const withScheme = url.startsWith("https://")
    ? `exps://${url.slice("https://".length)}`
    : url.startsWith("http://")
      ? `exp://${url.slice("http://".length)}`
      : url;
  return withScheme.replace(/\/+$/u, "");
}

function normalizeHostname(hostname: string): string {
  const trimmed = hostname.trim().toLowerCase();
  const withoutScheme = trimmed.includes("://") ? (trimmed.split("://")[1] ?? trimmed) : trimmed;
  return withoutScheme.replace(/\/.*$/, "").replace(/\.$/, "");
}

function encodePreviewHost(host: string): string {
  return btoa(host).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
