import type { PreviewProxyEnv } from "./env";
import type { PreviewTarget } from "./host";
import { invalidatePreviewOrigin, type PreviewOrigin, resolvePreviewOrigin } from "./origin";

/**
 * Headers that must never be copied verbatim across a proxy hop. `host` is also
 * stripped so the subrequest derives it from the Daytona origin URL.
 */
const REQUEST_HOP_BY_HOP = new Set([
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const RESPONSE_HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const DAYTONA_TOKEN_HEADER = "x-daytona-preview-token";
const DAYTONA_SKIP_WARNING_HEADER = "X-Daytona-Skip-Preview-Warning";
const FORWARDED_HOST_HEADER = "X-Forwarded-Host";

export interface ProxyInput {
  readonly env: PreviewProxyEnv;
  readonly originalHost: string;
  readonly request: Request;
  readonly setCookie?: string;
  readonly target: PreviewTarget;
  /** Request URL with `__cc_pt` already stripped (never forwarded to the origin). */
  readonly url: URL;
}

/**
 * Resolve the Daytona origin and stream the request through. WebSocket upgrades
 * (Vite HMR, noVNC websockify) are passed through untouched. For plain HTTP, a
 * 401/403 from the origin means the per-sandbox preview token rotated, so the
 * cache is invalidated and the request is retried once with a fresh token.
 */
export async function proxyPreviewRequest(input: ProxyInput): Promise<Response> {
  if (isWebSocketUpgrade(input.request)) {
    const origin = await resolvePreviewOrigin(input.env, input.target);
    return forwardWebSocket(input, origin);
  }

  const origin = await resolvePreviewOrigin(input.env, input.target);
  const first = await forwardHttp(input, origin);
  if (first.status !== 401 && first.status !== 403) {
    return buildClientResponse(first, input.setCookie);
  }

  await first.body?.cancel();
  invalidatePreviewOrigin(input.target);
  const refreshed = await resolvePreviewOrigin(input.env, input.target, { forceRefresh: true });
  const retry = await forwardHttp(input, refreshed);
  return buildClientResponse(retry, input.setCookie);
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

async function forwardHttp(input: ProxyInput, origin: PreviewOrigin): Promise<Response> {
  const headers = buildForwardHeaders(input.request.headers, origin, input.originalHost);
  const init: RequestInit = {
    headers,
    method: input.request.method,
    redirect: "manual",
  };
  if (input.request.method !== "GET" && input.request.method !== "HEAD") {
    init.body = input.request.body;
  }
  return fetch(new Request(targetUrl(origin, input.url), init));
}

async function forwardWebSocket(input: ProxyInput, origin: PreviewOrigin): Promise<Response> {
  // Reconstruct from the original request so the runtime preserves the upgrade
  // and the Sec-WebSocket-* handshake headers, then inject the Daytona headers.
  const wsRequest = new Request(targetUrl(origin, input.url), input.request);
  wsRequest.headers.delete("host");
  wsRequest.headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  wsRequest.headers.set(DAYTONA_SKIP_WARNING_HEADER, "true");
  wsRequest.headers.set(FORWARDED_HOST_HEADER, input.originalHost);
  const response = await fetch(wsRequest);
  if (response.webSocket) {
    return new Response(null, { status: 101, webSocket: response.webSocket });
  }
  return response;
}

function buildForwardHeaders(
  source: Headers,
  origin: PreviewOrigin,
  originalHost: string,
): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!REQUEST_HOP_BY_HOP.has(key.toLowerCase())) {
      headers.append(key, value);
    }
  });
  headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  headers.set(DAYTONA_SKIP_WARNING_HEADER, "true");
  headers.set(FORWARDED_HOST_HEADER, originalHost);
  return headers;
}

function buildClientResponse(originResponse: Response, setCookie?: string): Response {
  const headers = new Headers();
  originResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower !== "set-cookie" && !RESPONSE_HOP_BY_HOP.has(lower)) {
      headers.append(key, value);
    }
  });
  for (const cookie of originResponse.headers.getSetCookie()) {
    headers.append("Set-Cookie", cookie);
  }
  if (setCookie) {
    headers.append("Set-Cookie", setCookie);
  }
  return new Response(originResponse.body, {
    headers,
    status: originResponse.status,
    statusText: originResponse.statusText,
  });
}

/** Build `{originUrl}{path+search}` literally, preserving any origin base path. */
function targetUrl(origin: PreviewOrigin, url: URL): string {
  return `${origin.url.replace(/\/+$/, "")}${url.pathname}${url.search}`;
}
