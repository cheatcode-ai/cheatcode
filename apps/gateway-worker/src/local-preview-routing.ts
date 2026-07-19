import { readCookieValue } from "@cheatcode/auth";

const LOCAL_GATEWAY_PORT = "8787";
const LOCAL_PREVIEW_ENCODED_HOST_PATTERN = /^[A-Za-z0-9_-]{1,512}$/u;
const LOCAL_PREVIEW_HOST_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)--(\d{1,5})\.localhost$/u;
const LOCAL_PREVIEW_PATH_PREFIX = "/__sandbox/";
const LOCAL_PREVIEW_SESSION_COOKIE = "cc_pt";
const LOCAL_PREVIEW_TOKEN_QUERY = "__cc_pt";
const MAX_LOCAL_PREVIEW_TOKEN_LENGTH = 2_048;

export type LocalPreviewRoute =
  | { kind: "proxy"; request: Request }
  | { kind: "redirect"; response: Response };

/**
 * Keep the gateway as the sole local listener while routing preview traffic to
 * the real preview-proxy Worker. Path-form URLs are only a browser handoff;
 * every authenticated request runs on the canonical `*.localhost` origin.
 */
export function resolveLocalPreviewRoute(request: Request): LocalPreviewRoute | null {
  const redirect = localPreviewPathRedirect(request);
  if (redirect) {
    return { kind: "redirect", response: redirect };
  }
  const host = resolveLocalPreviewHost(request);
  if (!host) {
    return null;
  }
  return { kind: "proxy", request: requestForHost(request, host) };
}

function localPreviewPathRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(LOCAL_PREVIEW_PATH_PREFIX)) {
    return null;
  }
  const previewPath = url.pathname.slice(LOCAL_PREVIEW_PATH_PREFIX.length);
  const slashIndex = previewPath.indexOf("/");
  const encodedHost = slashIndex === -1 ? previewPath : previewPath.slice(0, slashIndex);
  const host = decodePreviewHost(encodedHost);
  if (!host) {
    return null;
  }
  url.host = host;
  url.pathname = slashIndex === -1 ? "/" : previewPath.slice(slashIndex);
  return new Response(null, {
    headers: {
      "Cache-Control": "private, no-store",
      Location: url.toString(),
      // The preview proxy requires the exact app-origin referrer after it
      // exchanges the query handoff for a cookie. `origin` discloses neither
      // the local path-form handoff nor its signed query credential.
      "Referrer-Policy": "origin",
    },
    status: request.method === "GET" || request.method === "HEAD" ? 302 : 307,
  });
}

function resolveLocalPreviewHost(request: Request): string | null {
  const url = new URL(request.url);
  const capabilityToken =
    url.searchParams.get(LOCAL_PREVIEW_TOKEN_QUERY) ??
    readCookieValue(request.headers.get("Cookie"), LOCAL_PREVIEW_SESSION_COOKIE);
  for (const candidate of [
    url.host,
    request.headers.get("Host"),
    request.headers.get("MF-Original-Hostname"),
    localPreviewAudience(capabilityToken),
  ]) {
    if (candidate && isLocalPreviewHost(candidate)) {
      return candidate;
    }
  }
  return null;
}

function localPreviewAudience(token: string | null): string | null {
  if (!token || token.length > MAX_LOCAL_PREVIEW_TOKEN_LENGTH) {
    return null;
  }
  const [prefix, encodedPayload, signature, ...extra] = token.split(".");
  if (prefix !== "ccp1" || !encodedPayload || !signature || extra.length > 0) {
    return null;
  }
  try {
    const normalized = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(`${normalized}${padding}`));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const audience = Reflect.get(payload, "aud");
    return typeof audience === "string" && isLocalPreviewHost(audience) ? audience : null;
  } catch {
    return null;
  }
}

function decodePreviewHost(encodedHost: string): string | null {
  if (!LOCAL_PREVIEW_ENCODED_HOST_PATTERN.test(encodedHost)) {
    return null;
  }
  try {
    const normalized = encodedHost.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const host = atob(`${normalized}${padding}`);
    return isLocalPreviewHost(host) ? host : null;
  } catch {
    return null;
  }
}

function isLocalPreviewHost(host: string): boolean {
  const url = safeLocalUrl(host);
  if (!url || url.port !== LOCAL_GATEWAY_PORT) {
    return false;
  }
  const match = LOCAL_PREVIEW_HOST_PATTERN.exec(url.hostname);
  const port = Number(match?.[2]);
  return Boolean(match?.[1]) && Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function safeLocalUrl(host: string): URL | null {
  try {
    const url = new URL(`http://${host}`);
    return url.host !== host ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
      ? null
      : url;
  } catch {
    return null;
  }
}

function requestForHost(request: Request, host: string): Request {
  const url = new URL(request.url);
  url.host = host;
  const rewritten = new Request(url, request);
  rewritten.headers.set("Host", host);
  return rewritten;
}
