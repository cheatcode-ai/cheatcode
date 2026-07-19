import { readBoundedResponseText } from "@cheatcode/observability";
import {
  CODE_SERVER_PORT,
  injectCodeServerParentBridge,
  isCodeServerWorkbenchHtml,
  MAX_CODE_SERVER_HTML_BYTES,
} from "@cheatcode/preview-bridge";
import type { PreviewProxyEnv } from "./env";
import type { PreviewTarget } from "./host";
import {
  type PreviewOrigin,
  refreshPreviewOriginAfterAuthFailure,
  resolvePreviewOrigin,
} from "./origin";
import { isReservedPreviewCookieName, PREVIEW_TOKEN_QUERY } from "./preview-session";
import { relayPreviewWebSocket } from "./websocket-relay";

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
// Browser cookies scoped to the Cheatcode parent site must never reach code
// running in a user-controlled sandbox. Namespace only cookies issued by the
// generated app and unwrap them on the upstream hop.
const ORIGIN_COOKIE_PREFIX = "__cc_app_";
const MAX_ORIGIN_COOKIE_NAME_LENGTH = 256;
const CLIENT_FORWARDING_HEADERS = [
  "Forwarded",
  "True-Client-IP",
  "X-Forwarded-Client-Cert",
  "X-Forwarded-For",
  "X-Forwarded-Host",
  "X-Forwarded-Port",
  "X-Forwarded-Proto",
  "X-Real-IP",
];
const AUTHENTICATED_RESPONSE_VARY = [
  "Cookie",
  "Origin",
  "Referer",
  "Sec-Fetch-Site",
  "Sec-Fetch-Mode",
  "Sec-Fetch-Dest",
];

export interface ProxyInput {
  readonly env: PreviewProxyEnv;
  readonly originalHost: string;
  readonly request: Request;
  /** Absolute expiry of the verified Cheatcode preview session. */
  readonly sessionExpiresAt: number;
  readonly setCookie?: string;
  readonly target: PreviewTarget;
  /** Request URL with `__cc_pt` already stripped (never forwarded to the origin). */
  readonly url: URL;
}

/**
 * Resolve the Daytona origin and stream the request through. WebSocket upgrades
 * are relayed so authorization expiry is enforced after the handshake. For plain HTTP, a
 * 401/403 from the origin may mean the per-sandbox preview token rotated. The
 * cache is invalidated, but only GET/HEAD and WebSocket handshakes are retried;
 * unsafe generated-app requests are never replayed automatically.
 */
export async function proxyPreviewRequest(input: ProxyInput): Promise<Response> {
  if (isWebSocketUpgrade(input.request)) {
    const origin = await resolvePreviewOrigin(input.env, input.target);
    const first = await forwardWebSocket(input, origin);
    if (first.status !== 401 && first.status !== 403) {
      return first;
    }
    const refreshed = await refreshPreviewOriginAfterAuthFailure(input.env, input.target, origin);
    if (!refreshed) {
      return first;
    }
    await first.body?.cancel().catch(() => undefined);
    return forwardWebSocket(input, refreshed);
  }

  const origin = await resolvePreviewOrigin(input.env, input.target);
  const first = await forwardHttp(input, origin);
  if (first.status !== 401 && first.status !== 403) {
    return buildClientResponse(first, input, origin);
  }

  if (input.request.method !== "GET" && input.request.method !== "HEAD") {
    // A 401/403 may come from the generated app rather than Daytona. Never replay
    // a potentially state-changing or already-consumed request body automatically.
    return buildClientResponse(first, input, origin);
  }
  const refreshed = await refreshPreviewOriginAfterAuthFailure(input.env, input.target, origin);
  if (!refreshed) {
    return buildClientResponse(first, input, origin);
  }
  await first.body?.cancel().catch(() => undefined);
  const retry = await forwardHttp(input, refreshed);
  return buildClientResponse(retry, input, refreshed);
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

async function forwardHttp(input: ProxyInput, origin: PreviewOrigin): Promise<Response> {
  const headers = buildForwardHeaders(
    input.request.headers,
    origin,
    input.originalHost,
    input.url.protocol,
  );
  const init: RequestInit = {
    headers,
    method: input.request.method,
    redirect: "manual",
  };
  if (isCodeServerRequest(input) && input.request.method === "GET") {
    headers.set("Accept-Encoding", "identity");
  }
  if (input.request.method !== "GET" && input.request.method !== "HEAD") {
    init.body = input.request.body;
  }
  const response = await fetch(new Request(targetUrl(origin, input.url), init));
  if (response.status === 401 || response.status === 403) {
    return response;
  }
  return transformCodeServerResponse(response, input);
}

function isCodeServerRequest(input: ProxyInput): boolean {
  return input.target.port === String(CODE_SERVER_PORT);
}

async function transformCodeServerResponse(
  response: Response,
  input: ProxyInput,
): Promise<Response> {
  if (
    !isCodeServerRequest(input) ||
    input.request.method !== "GET" ||
    !response.headers.get("Content-Type")?.toLowerCase().includes("text/html")
  ) {
    return response;
  }
  const html = await readBoundedResponseText(
    response,
    MAX_CODE_SERVER_HTML_BYTES,
    "Code-server HTML",
  );
  const body = isCodeServerWorkbenchHtml(html)
    ? injectCodeServerParentBridge(html, input.env.CHEATCODE_APP_ORIGIN)
    : html;
  const headers = new Headers(response.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  return new Response(body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function forwardWebSocket(input: ProxyInput, origin: PreviewOrigin): Promise<Response> {
  // Reconstruct from the original request so the runtime preserves the upgrade
  // and the Sec-WebSocket-* handshake headers, then inject the Daytona headers.
  const wsRequest = new Request(targetUrl(origin, input.url), input.request);
  wsRequest.headers.delete("host");
  stripProxyCredentials(wsRequest.headers);
  wsRequest.headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  wsRequest.headers.set(DAYTONA_SKIP_WARNING_HEADER, "true");
  setCanonicalForwardingHeaders(wsRequest.headers, input.originalHost, input.url.protocol);
  wsRequest.headers.set("Origin", websocketOrigin(input, origin));
  const response = await fetch(wsRequest);
  if (response.webSocket) {
    return relayPreviewWebSocket(
      response,
      input.sessionExpiresAt,
      input.request.headers.get("Sec-WebSocket-Protocol"),
    );
  }
  return buildClientResponse(response, input, origin);
}

function websocketOrigin(input: ProxyInput, origin: PreviewOrigin): string {
  if (!isCodeServerRequest(input)) {
    return new URL(origin.url).origin;
  }
  // Code Server validates WebSocket origins against the public preview host
  // configured when the sandbox starts. Replacing that origin with Daytona's
  // private upstream host makes the otherwise valid workbench socket fail 403.
  return `${input.url.protocol}//${input.originalHost}`;
}

function buildForwardHeaders(
  source: Headers,
  origin: PreviewOrigin,
  originalHost: string,
  clientProtocol: string,
): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!REQUEST_HOP_BY_HOP.has(key.toLowerCase())) {
      headers.append(key, value);
    }
  });
  stripProxyCredentials(headers);
  headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  headers.set(DAYTONA_SKIP_WARNING_HEADER, "true");
  setCanonicalForwardingHeaders(headers, originalHost, clientProtocol);
  return headers;
}

function buildClientResponse(
  originResponse: Response,
  input: ProxyInput,
  origin: PreviewOrigin,
): Response {
  const headers = new Headers();
  originResponse.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower !== "set-cookie" && !RESPONSE_HOP_BY_HOP.has(lower)) {
      headers.append(
        key,
        lower === "location" ? rewriteOriginLocation(value, input, origin) : value,
      );
    }
  });
  for (const cookie of originResponse.headers.getSetCookie()) {
    const sanitized = sanitizeOriginCookie(cookie);
    if (sanitized) {
      headers.append("Set-Cookie", sanitized);
    }
  }
  if (input.setCookie) {
    headers.append("Set-Cookie", input.setCookie);
  }
  protectAuthenticatedResponse(headers);
  return new Response(originResponse.body, {
    headers,
    status: originResponse.status,
    statusText: originResponse.statusText,
  });
}

function rewriteOriginLocation(value: string, input: ProxyInput, origin: PreviewOrigin): string {
  try {
    const upstreamOrigin = new URL(origin.url);
    const location = new URL(value, upstreamOrigin);
    if (location.origin !== upstreamOrigin.origin) {
      if (location.host !== input.originalHost) {
        return value;
      }
      location.searchParams.delete(PREVIEW_TOKEN_QUERY);
      return location.toString();
    }
    location.searchParams.delete(PREVIEW_TOKEN_QUERY);
    const clientOrigin = `${new URL(input.request.url).protocol}//${input.originalHost}`;
    return new URL(
      `${location.pathname}${location.search}${location.hash}`,
      clientOrigin,
    ).toString();
  } catch {
    return value;
  }
}

/** Build `{originUrl}{path+search}` literally, preserving any origin base path. */
function targetUrl(origin: PreviewOrigin, url: URL): string {
  return `${origin.url.replace(/\/+$/, "")}${url.pathname}${url.search}`;
}

function stripProxyCredentials(headers: Headers): void {
  const forwardedCookies = originRequestCookies(headers.get("Cookie"));
  if (forwardedCookies) {
    headers.set("Cookie", forwardedCookies);
  } else {
    headers.delete("Cookie");
  }

  const referer = headers.get("Referer");
  if (!referer) {
    return;
  }
  try {
    const sanitized = new URL(referer);
    sanitized.searchParams.delete(PREVIEW_TOKEN_QUERY);
    headers.set("Referer", sanitized.toString());
  } catch {
    headers.delete("Referer");
  }
}

function setCanonicalForwardingHeaders(
  headers: Headers,
  originalHost: string,
  clientProtocol: string,
): void {
  for (const header of CLIENT_FORWARDING_HEADERS) {
    headers.delete(header);
  }
  headers.set(FORWARDED_HOST_HEADER, originalHost);
  headers.set("X-Forwarded-Proto", clientProtocol.replace(/:$/u, ""));
}

function sanitizeOriginCookie(cookie: string): string | null {
  const parts = cookie.split(";");
  const first = parts.shift()?.trim();
  const separator = first?.indexOf("=") ?? -1;
  const name = separator > 0 && first ? first.slice(0, separator).trim() : "";
  if (!validOriginCookieName(name) || isReservedPreviewCookieName(name)) {
    return null;
  }
  const attributes = parts.filter((part) => !/^\s*domain\s*=/iu.test(part));
  return [`${ORIGIN_COOKIE_PREFIX}${name}${first?.slice(separator)}`, ...attributes].join(";");
}

function originRequestCookies(header: string | null): string {
  if (!header) {
    return "";
  }
  const forwarded: string[] = [];
  for (const item of header.split(";")) {
    const cookie = item.trim();
    const separator = cookie.indexOf("=");
    const wrappedName = separator > 0 ? cookie.slice(0, separator).trim() : "";
    if (!wrappedName.startsWith(ORIGIN_COOKIE_PREFIX)) {
      continue;
    }
    const name = wrappedName.slice(ORIGIN_COOKIE_PREFIX.length);
    if (validOriginCookieName(name)) {
      forwarded.push(`${name}${cookie.slice(separator)}`);
    }
  }
  return forwarded.join("; ");
}

function validOriginCookieName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ORIGIN_COOKIE_NAME_LENGTH &&
    /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/u.test(value)
  );
}

function protectAuthenticatedResponse(headers: Headers): void {
  const contentType = headers.get("Content-Type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) {
    headers.set("Cache-Control", "private, no-store");
  } else {
    headers.set("Cache-Control", privateCacheControl(headers.get("Cache-Control")));
  }
  const vary = (headers.get("Vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!vary.includes("*")) {
    for (const header of AUTHENTICATED_RESPONSE_VARY) {
      if (!vary.some((value) => value.toLowerCase() === header.toLowerCase())) {
        vary.push(header);
      }
    }
  }
  if (vary.length > 0) {
    headers.set("Vary", vary.join(", "));
  }
}

function privateCacheControl(value: string | null): string {
  if (!value) {
    return "private";
  }
  const directives = value
    .split(",")
    .map((directive) => directive.trim())
    .filter((directive) => {
      const name = directive.split("=", 1)[0]?.toLowerCase();
      return name !== "public" && name !== "s-maxage" && name !== "proxy-revalidate";
    });
  if (!directives.some((directive) => directive.toLowerCase() === "private")) {
    directives.unshift("private");
  }
  return directives.join(", ");
}
