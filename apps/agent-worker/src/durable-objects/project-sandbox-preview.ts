import { mintPreviewCapability } from "@cheatcode/auth";

/**
 * The DO returns a short-lived transport handoff in the preview URL. Production and
 * local proxies verify the shared @cheatcode/auth capability protocol, exchange
 * the query credential for a host session cookie, and strip it before proxying.
 */
const LOCAL_PREVIEW_HOST = "localhost:8787";

export interface BuildPreviewUrlInput {
  sandboxId: string;
  port: number;
  hostname: string;
  secret: string;
  // Mobile (Expo web) previews use the clean-subdomain URL form because Expo Router derives its
  // route from window.location and each project runs Metro on its own port.
  isMobile?: boolean;
  // Embedded services such as Code Server exchange messages with their parent.
  // Give them their final origin up front instead of a temporary local handoff origin.
  useSubdomain?: boolean;
}

export interface BuiltPreviewUrl {
  expiresAt: string;
  url: string;
}

export async function buildPreviewUrl(input: BuildPreviewUrlInput): Promise<BuiltPreviewUrl> {
  const hostname = normalizeHostname(input.hostname);
  const host = `${input.sandboxId}--${input.port}.${hostname}`;
  const capability = await mintPreviewCapability({
    kind: "handoff",
    secret: input.secret,
    target: {
      audience: host,
      port: input.port,
      sandboxId: input.sandboxId,
    },
  });
  const path = `/?__cc_pt=${encodeURIComponent(capability.token)}`;
  if (hostname === LOCAL_PREVIEW_HOST) {
    // Mobile (Expo web) previews are served under the subdomain form so the browser path stays
    // clean (`/`) — Expo Router routes from window.location and the `/__sandbox/<host>` path prefix
    // yields "Unmatched Route". The local proxy routes this by Host, matching prod's subdomain
    // routing. Web (Next.js) previews keep the path form, which they tolerate.
    const url =
      input.isMobile || input.useSubdomain
        ? `http://${host}${path}`
        : `http://${hostname}/__sandbox/${encodePreviewHost(host)}${path}`;
    return { expiresAt: new Date(capability.expiresAt).toISOString(), url };
  }
  const url = `https://${host}${path}`;
  return { expiresAt: new Date(capability.expiresAt).toISOString(), url };
}

/**
 * Turn a Daytona-signed preview URL (`https://8081-<token>.daytonaproxy01.net`) into an Expo Go
 * deep link by swapping the scheme: `https://` → `exps://` (the daytonaproxy edge is https-only,
 * so the secure Expo scheme is required) and `http://` → `exp://`. The token stays in the host, so
 * Expo Go reaches the Metro manifest with no header/cookie. Keeps the full host/path/query and only
 * trims a trailing slash.
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
  const normalized = hostname.trim().toLowerCase().replace(/\.$/u, "");
  if (
    normalized !== LOCAL_PREVIEW_HOST &&
    (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(normalized) ||
      normalized.includes(".."))
  ) {
    throw new TypeError("Preview hostname must be a hostname or localhost:8787");
  }
  return normalized;
}

function encodePreviewHost(host: string): string {
  return btoa(host).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
