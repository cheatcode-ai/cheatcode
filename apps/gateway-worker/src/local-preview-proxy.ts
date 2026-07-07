const LOCAL_PREVIEW_COOKIE_NAME = "__cheatcode_preview_host";
const LOCAL_PREVIEW_CLIENT_HOST_HEADER = "X-Cheatcode-Local-Preview-Client-Host";
const LOCAL_PREVIEW_ENCODED_HOST_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const LOCAL_PREVIEW_HOST_PATTERN =
  /^(?:\d{4,5}-[a-z0-9-]+-[a-z0-9_]+|[a-z0-9-]+--\d{1,5})\.localhost$/;
const LOCAL_PREVIEW_PATH_PREFIX = "/__sandbox/";

export interface LocalPreviewProxyRequest {
  encodedHost?: string;
  request: Request;
}

export interface LocalPreviewOriginRequest {
  clientHost: string;
  cookie?: string;
  host: string;
  origin?: string;
  referer?: string;
  url: string;
}

export function resolveLocalPreviewProxyRequest(request: Request): LocalPreviewProxyRequest | null {
  const pathProxy = rewriteLocalPreviewPathRequest(request);
  if (pathProxy) {
    return pathProxy;
  }
  const cookieHost = resolveLocalPreviewCookieHost(request);
  if (!cookieHost) {
    return null;
  }
  return { request: rewriteLocalPreviewRequest(request, cookieHost) };
}

export function withLocalPreviewCookie(
  response: Response,
  id: string,
  encodedHost?: string,
): Response {
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("X-Request-Id", id);
  if (encodedHost) {
    wrapped.headers.append(
      "Set-Cookie",
      `${LOCAL_PREVIEW_COOKIE_NAME}=${encodedHost}; Path=/; Max-Age=3600; SameSite=Lax`,
    );
  }
  return wrapped;
}

export function localPreviewOriginRequest(request: Request): LocalPreviewOriginRequest | null {
  const proxy = resolveLocalPreviewProxyRequest(request);
  if (proxy) {
    return originRequestFromRewrittenRequest(proxy.request);
  }
  const localPreviewHost = resolveLocalSandboxPreviewHost(request);
  if (!localPreviewHost) {
    return null;
  }
  return originRequestFromRewrittenRequest(rewriteLocalPreviewRequest(request, localPreviewHost));
}

export function resolveLocalSandboxPreviewHost(request: Request): string | null {
  const url = new URL(request.url);
  if (isLocalPreviewHost(url.host)) {
    return url.host;
  }
  return (
    resolveLocalPreviewHostHeader(request, "Host") ??
    resolveLocalPreviewHostHeader(request, "MF-Original-Hostname")
  );
}

export function rewriteLocalPreviewRequest(
  request: Request,
  host: string,
  pathname?: string,
): Request {
  const url = new URL(request.url);
  const { hostname, port } = splitHost(host);
  url.hostname = hostname;
  url.port = port ?? url.port;
  if (pathname) {
    url.pathname = pathname;
  }
  const headers = new Headers(request.headers);
  const clientHost = headers.get("Host") ?? url.host;
  headers.set(LOCAL_PREVIEW_CLIENT_HOST_HEADER, clientHost);
  headers.set("Host", host);
  if (isWebSocketUpgrade(request)) {
    const websocketRequest = new Request(url.toString(), request);
    websocketRequest.headers.set(LOCAL_PREVIEW_CLIENT_HOST_HEADER, clientHost);
    websocketRequest.headers.set("Host", host);
    return websocketRequest;
  }
  const init: RequestInit = {
    headers,
    method: request.method,
    redirect: request.redirect,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  return new Request(url.toString(), init);
}

function originRequestFromRewrittenRequest(request: Request): LocalPreviewOriginRequest {
  const clientHost =
    request.headers.get(LOCAL_PREVIEW_CLIENT_HOST_HEADER) ??
    request.headers.get("Host") ??
    new URL(request.url).host;
  const cookie = request.headers.get("Cookie");
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  return {
    clientHost,
    ...(cookie ? { cookie } : {}),
    host: request.headers.get("Host") ?? new URL(request.url).host,
    ...(origin ? { origin } : {}),
    ...(referer ? { referer } : {}),
    url: request.url,
  };
}

function rewriteLocalPreviewPathRequest(request: Request): LocalPreviewProxyRequest | null {
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

  const proxiedPath = slashIndex === -1 ? "/" : previewPath.slice(slashIndex);
  return {
    encodedHost,
    request: rewriteLocalPreviewRequest(request, host, proxiedPath),
  };
}

function resolveLocalPreviewCookieHost(request: Request): string | null {
  if (!shouldProxyLocalPreviewCookieRequest(request)) {
    return null;
  }
  const encodedHost = readCookie(request.headers.get("Cookie"), LOCAL_PREVIEW_COOKIE_NAME);
  return encodedHost ? decodePreviewHost(encodedHost) : null;
}

function shouldProxyLocalPreviewCookieRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }
  const url = new URL(request.url);
  if (url.pathname.startsWith("/v1/") || url.pathname.startsWith(LOCAL_PREVIEW_PATH_PREFIX)) {
    return false;
  }
  return url.pathname !== "/health";
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

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const cookie of cookieHeader.split(";")) {
    const trimmed = cookie.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }
    if (trimmed.slice(0, separatorIndex) === name) {
      return trimmed.slice(separatorIndex + 1);
    }
  }
  return null;
}

function resolveLocalPreviewHostHeader(request: Request, headerName: string): string | null {
  const host = request.headers.get(headerName);
  if (!host) {
    return null;
  }
  return isLocalPreviewHost(host) ? host : null;
}

function isLocalPreviewHost(host: string): boolean {
  const { hostname } = splitHost(host);
  return LOCAL_PREVIEW_HOST_PATTERN.test(hostname);
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

function splitHost(host: string): { hostname: string; port?: string } {
  const [hostname = "", port] = host.split(":");
  return port ? { hostname, port } : { hostname };
}
