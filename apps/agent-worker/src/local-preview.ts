import {
  mintPreviewCapability,
  PreviewCapabilityError,
  type PreviewCapabilityKind,
  verifyPreviewCapability,
} from "@cheatcode/auth";
import { resolveWorkerSecret, type WorkerSecret } from "@cheatcode/env";
import { APIError, readBoundedResponseText } from "@cheatcode/observability";
import {
  CODE_SERVER_PORT,
  injectCodeServerParentBridge,
  isCodeServerWorkbenchHtml,
  MAX_CODE_SERVER_HTML_BYTES,
} from "@cheatcode/preview-bridge";
import { DaytonaClient } from "@cheatcode/tools-code";

interface LocalPreviewEnv {
  DAYTONA_API_KEY: WorkerSecret;
  DAYTONA_API_URL: string;
  DAYTONA_ORG_ID?: string;
  DAYTONA_TARGET: string;
  PREVIEW_TOKEN_SECRET: WorkerSecret;
}

interface LocalPreviewTarget {
  port: string;
  sandboxId: string;
}

interface LocalPreviewAuthorization {
  fromQuery: boolean;
}

interface ResolvedLocalPreviewOrigin {
  authorization: LocalPreviewAuthorization;
  originalHost: string;
  origin: {
    signed: boolean;
    token: string;
    url: string;
  };
  target: LocalPreviewTarget;
  url: URL;
}

interface LocalPreviewRequestContext {
  audience: string;
  authorization: LocalPreviewAuthorization;
  originalHost: string;
  secret: string;
  target: LocalPreviewTarget;
  url: URL;
}

const DAYTONA_TOKEN_HEADER = "x-daytona-preview-token";
const DAYTONA_SKIP_WARNING_HEADER = "X-Daytona-Skip-Preview-Warning";
const FORWARDED_HOST_HEADER = "X-Forwarded-Host";
const LOCAL_PREVIEW_CLIENT_HOST_HEADER = "X-Cheatcode-Local-Preview-Client-Host";
const LOCAL_PREVIEW_HOST_SUFFIX = ".localhost";
const LOCAL_PREVIEW_HOST_PATTERN = /^([a-z0-9-]+)--(\d{1,5})$/;
const PREVIEW_TOKEN_COOKIE = "cc_pt";
const PREVIEW_TOKEN_QUERY = "__cc_pt";
const LOCAL_CODE_SERVER_PARENT_ORIGIN = "http://localhost:3000";

export async function tryHandleLocalPreviewRequest(
  request: Request,
  env: LocalPreviewEnv,
): Promise<Response | null> {
  const context = await resolveLocalPreviewRequestContext(request, env);
  if (!context) return null;
  if (context.authorization.fromQuery) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      throw new APIError(
        400,
        "invalid_request_body",
        "Preview handoff requires a navigation request",
        { retriable: false },
      );
    }
    const session = await mintPreviewCapability({
      kind: "session",
      secret: context.secret,
      target: capabilityTarget(context.audience, context.target),
    });
    return localPreviewSessionRedirect(
      context.url,
      context.originalHost,
      localPreviewSessionCookie(session.token, session.expiresAt),
    );
  }
  const origin = await resolveLocalDaytonaOrigin(context.target, env);
  const upstreamUrl = localPreviewUpstreamUrl(origin.url, context.url);
  if (isWebSocketUpgrade(request)) {
    return fetchLocalPreviewWebSocket(request, upstreamUrl, origin, context.originalHost);
  }
  return fetchLocalPreviewOrigin(
    request,
    upstreamUrl,
    origin,
    context.originalHost,
    context.target.port === String(CODE_SERVER_PORT),
  );
}

export async function resolveLocalPreviewOrigin(
  request: Request,
  env: LocalPreviewEnv,
): Promise<ResolvedLocalPreviewOrigin | null> {
  const context = await resolveLocalPreviewRequestContext(request, env);
  if (!context) {
    return null;
  }
  const origin = await resolveLocalDaytonaOrigin(context.target, env);
  return {
    authorization: context.authorization,
    origin,
    originalHost: context.originalHost,
    target: context.target,
    url: context.url,
  };
}

async function resolveLocalPreviewRequestContext(
  request: Request,
  env: LocalPreviewEnv,
): Promise<LocalPreviewRequestContext | null> {
  const url = new URL(request.url);
  const audience = request.headers.get("Host") ?? url.host;
  const target = parseLocalPreviewHost(audience);
  if (!target) {
    return null;
  }
  const secret = await requireLocalPreviewSecret(env);
  const authorization = await authorizeLocalPreview(request, url, target, secret);
  return {
    audience,
    authorization,
    originalHost: localPreviewClientHost(request, url),
    secret,
    target,
    url,
  };
}

async function resolveLocalDaytonaOrigin(target: LocalPreviewTarget, env: LocalPreviewEnv) {
  const client = await localDaytonaClient(env);
  return {
    ...(await client.getPreviewLink(target.sandboxId, Number(target.port))),
    signed: false,
  };
}

function localPreviewClientHost(request: Request, url: URL): string {
  return (
    request.headers.get(LOCAL_PREVIEW_CLIENT_HOST_HEADER) ?? request.headers.get("Host") ?? url.host
  );
}

function parseLocalPreviewHost(host: string): LocalPreviewTarget | null {
  const hostname = (host.split(":")[0] ?? "").toLowerCase();
  if (!hostname.endsWith(LOCAL_PREVIEW_HOST_SUFFIX)) {
    return null;
  }
  const label = hostname.slice(0, hostname.length - LOCAL_PREVIEW_HOST_SUFFIX.length);
  const match = LOCAL_PREVIEW_HOST_PATTERN.exec(label);
  const sandboxId = match?.[1];
  const port = match?.[2];
  if (!sandboxId || !port) {
    return null;
  }
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) {
    return null;
  }
  return { port, sandboxId };
}

async function authorizeLocalPreview(
  request: Request,
  url: URL,
  target: LocalPreviewTarget,
  secret: string,
): Promise<LocalPreviewAuthorization> {
  const queryToken = url.searchParams.get(PREVIEW_TOKEN_QUERY);
  const cookieToken = readCookie(request.headers.get("Cookie"), PREVIEW_TOKEN_COOKIE);
  const raw = queryToken ?? cookieToken;
  if (!raw) {
    throw new APIError(401, "auth_token_missing", "Missing preview access token", {
      retriable: false,
    });
  }
  const kind: PreviewCapabilityKind = queryToken ? "handoff" : "session";
  try {
    await verifyPreviewCapability({
      expectedKind: kind,
      secret,
      target: capabilityTarget(request.headers.get("Host") ?? url.host, target),
      token: raw,
    });
    return { fromQuery: kind === "handoff" };
  } catch (error) {
    if (error instanceof PreviewCapabilityError && error.reason === "expired") {
      throw new APIError(401, "auth_token_expired", "Preview access token has expired", {
        retriable: false,
      });
    }
    if (error instanceof PreviewCapabilityError) {
      throw invalidPreviewToken();
    }
    throw error;
  }
}

function capabilityTarget(audience: string, target: LocalPreviewTarget) {
  return {
    audience,
    port: Number(target.port),
    sandboxId: target.sandboxId,
  };
}

async function requireLocalPreviewSecret(env: LocalPreviewEnv): Promise<string> {
  const secret = await resolveWorkerSecret(env.PREVIEW_TOKEN_SECRET);
  if (!secret) {
    throw new APIError(500, "internal_error", "Preview token secret is not configured", {
      retriable: false,
    });
  }
  return secret;
}

async function localDaytonaClient(env: LocalPreviewEnv): Promise<DaytonaClient> {
  const apiKey = await resolveWorkerSecret(env.DAYTONA_API_KEY);
  if (!apiKey) {
    throw new APIError(502, "upstream_sandbox_failed", "Daytona API key is not configured", {
      retriable: false,
    });
  }
  return new DaytonaClient({
    apiKey,
    apiUrl: env.DAYTONA_API_URL,
    target: env.DAYTONA_TARGET,
    ...(env.DAYTONA_ORG_ID ? { organizationId: env.DAYTONA_ORG_ID } : {}),
  });
}

async function fetchLocalPreviewOrigin(
  request: Request,
  upstreamUrl: URL,
  origin: { signed: boolean; token: string },
  originalHost: string,
  isCodeServer: boolean,
): Promise<Response> {
  const response = await fetch(upstreamUrl, localPreviewRequestInit(request, origin, originalHost));
  if (!isCodeServer || request.method !== "GET" || !isHtmlResponse(response)) {
    return response;
  }
  const text = await readBoundedResponseText(
    response,
    MAX_CODE_SERVER_HTML_BYTES,
    "Code-server HTML",
  );
  const action = daytonaWarningAcceptAction(text);
  if (!action) {
    return codePreviewHtmlResponse(text, response);
  }
  const acceptCookie = await acceptDaytonaPreviewWarning(upstreamUrl, action, origin);
  const retryResponse = await fetch(
    upstreamUrl,
    localPreviewRequestInit(request, origin, originalHost, acceptCookie),
  );
  if (!isHtmlResponse(retryResponse)) {
    return retryResponse;
  }
  const retryText = await readBoundedResponseText(
    retryResponse,
    MAX_CODE_SERVER_HTML_BYTES,
    "Code-server HTML",
  );
  return codePreviewHtmlResponse(retryText, retryResponse);
}

async function fetchLocalPreviewWebSocket(
  request: Request,
  upstreamUrl: URL,
  origin: { signed: boolean; token: string; url: string },
  originalHost: string,
): Promise<Response> {
  const wsRequest = new Request(upstreamUrl.toString(), request);
  wsRequest.headers.delete("Host");
  wsRequest.headers.delete("Cookie");
  if (!origin.signed) {
    wsRequest.headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  }
  wsRequest.headers.set(DAYTONA_SKIP_WARNING_HEADER, "true");
  wsRequest.headers.set(FORWARDED_HOST_HEADER, originalHost);
  const browserOrigin =
    request.headers.get("Origin") ?? `${new URL(request.url).protocol}//${originalHost}`;
  const browserProtocol = new URL(browserOrigin).protocol.replace(":", "");
  wsRequest.headers.set("Origin", browserOrigin);
  wsRequest.headers.set("Forwarded", `host=${originalHost};proto=${browserProtocol}`);
  wsRequest.headers.set("X-Forwarded-Proto", browserProtocol);
  const response = await fetch(wsRequest);
  if (response.webSocket) {
    return new Response(null, { status: 101, webSocket: response.webSocket });
  }
  return response;
}

function localPreviewRequestInit(
  request: Request,
  origin: { signed: boolean; token: string },
  originalHost: string,
  cookie?: string | null,
): RequestInit {
  const headers = new Headers(request.headers);
  headers.delete("Host");
  headers.delete("Cookie");
  if (!origin.signed) {
    headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  }
  headers.set(DAYTONA_SKIP_WARNING_HEADER, "true");
  headers.set(FORWARDED_HOST_HEADER, originalHost);
  const browserOrigin =
    request.headers.get("Origin") ?? `${new URL(request.url).protocol}//${originalHost}`;
  const browserProtocol = new URL(browserOrigin).protocol.replace(":", "");
  headers.set("Forwarded", `host=${originalHost};proto=${browserProtocol}`);
  headers.set("X-Forwarded-Proto", browserProtocol);
  headers.set("Accept-Encoding", "identity");
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  const init: RequestInit = {
    headers,
    method: request.method,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }
  return init;
}

function localPreviewUpstreamUrl(originUrl: string, requestUrl: URL): URL {
  const upstreamUrl = new URL(originUrl);
  const requestParams = new URLSearchParams(requestUrl.search);
  upstreamUrl.pathname = requestUrl.pathname;
  for (const [key, value] of requestParams) {
    upstreamUrl.searchParams.append(key, value);
  }
  upstreamUrl.searchParams.delete(PREVIEW_TOKEN_QUERY);
  upstreamUrl.searchParams.delete("cc_preview_reload");
  upstreamUrl.searchParams.delete("cc_theme");
  return upstreamUrl;
}

function isHtmlResponse(response: Response): boolean {
  return response.headers.get("Content-Type")?.toLowerCase().includes("text/html") ?? false;
}

function codePreviewHtmlResponse(html: string, response: Response): Response {
  if (!isCodeServerWorkbenchHtml(html)) {
    return textResponse(html, response);
  }
  return textResponse(
    injectCodeServerParentBridge(html, LOCAL_CODE_SERVER_PARENT_ORIGIN),
    response,
  );
}

function textResponse(text: string, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.set("Cache-Control", "no-store");
  return new Response(text, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function daytonaWarningAcceptAction(html: string): string | null {
  if (!html.includes("Preview URL Warning")) {
    return null;
  }
  const match = /<form\s+action="([^"]*accept-daytona-preview-warning[^"]*)"/iu.exec(html);
  return match?.[1]?.replaceAll("&amp;", "&") ?? null;
}

async function acceptDaytonaPreviewWarning(
  upstreamUrl: URL,
  action: string,
  origin: { signed: boolean; token: string },
): Promise<string | null> {
  let acceptUrl: URL;
  try {
    acceptUrl = new URL(action, upstreamUrl.origin);
  } catch {
    return null;
  }
  if (acceptUrl.origin !== upstreamUrl.origin || acceptUrl.username || acceptUrl.password) {
    return null;
  }
  const headers = new Headers({ [DAYTONA_SKIP_WARNING_HEADER]: "true" });
  if (!origin.signed) {
    headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  }
  const response = await fetch(acceptUrl, {
    headers,
    method: "POST",
    redirect: "manual",
  });
  const cookie = response.headers.get("Set-Cookie")?.split(";", 1)[0] ?? null;
  await response.body?.cancel().catch(() => undefined);
  return cookie;
}

function localPreviewSessionRedirect(url: URL, originalHost: string, setCookie: string): Response {
  const location = new URL(url);
  location.host = originalHost;
  location.searchParams.delete(PREVIEW_TOKEN_QUERY);
  return new Response(null, {
    headers: {
      "Cache-Control": "private, no-store",
      Location: location.toString(),
      "Set-Cookie": setCookie,
    },
    status: 302,
  });
}

function localPreviewSessionCookie(token: string, expiresAt: number): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  // Local HTTP cannot use the Secure-required __Host- prefix; retain the same
  // host-only, HttpOnly, Strict transport semantics under a dev-only name.
  return `${PREVIEW_TOKEN_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Strict`;
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

function invalidPreviewToken(): APIError {
  return new APIError(401, "auth_token_invalid", "Invalid preview access token", {
    retriable: false,
  });
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  for (const cookie of cookieHeader.split(";")) {
    const trimmed = cookie.trim();
    const separator = trimmed.indexOf("=");
    if (separator !== -1 && trimmed.slice(0, separator) === name) {
      return trimmed.slice(separator + 1);
    }
  }
  return null;
}
