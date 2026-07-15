import { resolveWorkerSecret } from "@cheatcode/env";
import {
  APIError,
  createLogger,
  emitErrorEvent,
  emitPerformanceMetric,
  safeErrorTelemetry,
  toAPIError,
  withErrorHandler,
} from "@cheatcode/observability";
import { type PreviewProxyEnv, PreviewProxyEnvSchema } from "./env";
import { type PreviewTarget, parsePreviewHost } from "./host";
import {
  CHEATCODE_APP_ORIGIN,
  PREVIEW_SESSION_COOKIE,
  PREVIEW_SESSION_PATH,
  PREVIEW_TOKEN_QUERY,
} from "./preview-session";
import { proxyPreviewRequest } from "./proxy";
import { assertPreviewRequestContext } from "./request-context";
import { authorizePreviewRequest, mintPreviewSessionToken } from "./token";

const WORKER_NAME = "preview-proxy";
const SECURITY_VARY_HEADERS = [
  "Origin",
  "Referer",
  "Sec-Fetch-Site",
  "Sec-Fetch-Mode",
  "Sec-Fetch-Dest",
];

async function handlePreviewRequest(request: Request, env: PreviewProxyEnv): Promise<Response> {
  PreviewProxyEnvSchema.parse(env);
  const url = new URL(request.url);
  const originalHost = url.host;
  if (request.method === "GET" && url.pathname === "/health") {
    return healthResponse(env);
  }
  const target = requirePreviewTarget(url.hostname, env.PREVIEW_HOSTNAME);
  const secret = await requirePreviewSecret(env);
  const authorized = await authorizePreviewRequest({
    audience: originalHost,
    request,
    secret,
    target,
    url,
  });
  assertPreviewRequestContext({ fromQuery: authorized.fromQuery, request, url });
  assertNavigationHandoff(authorized.fromQuery, request.method);
  // Exchange a query token for a host-only cookie before sandbox content runs so the
  // credential leaves the visible URL and can never reach the origin.
  url.searchParams.delete(PREVIEW_TOKEN_QUERY);
  const session = await mintHandoffSession(authorized.fromQuery, originalHost, secret, target);
  const setCookie = session ? buildSessionCookie(session.token, session.expiresAt) : undefined;
  if (url.pathname === PREVIEW_SESSION_PATH) {
    if (!setCookie) {
      throw new APIError(400, "invalid_request_body", "Preview session refresh requires a token", {
        retriable: false,
      });
    }
    return previewSessionRefresh(setCookie);
  }
  if (setCookie && (request.method === "GET" || request.method === "HEAD")) {
    return previewSessionRedirect(url, setCookie);
  }

  return proxyPreviewRequest({
    env,
    originalHost,
    request,
    sessionExpiresAt: session?.expiresAt ?? authorized.verified.expiresAt,
    target,
    url,
    ...(setCookie ? { setCookie } : {}),
  });
}

async function mintHandoffSession(
  isFromQuery: boolean,
  audience: string,
  secret: string,
  target: PreviewTarget,
) {
  return isFromQuery ? mintPreviewSessionToken({ audience, secret, target }) : undefined;
}

function assertNavigationHandoff(isFromQuery: boolean, method: string): void {
  if (isFromQuery && method !== "GET" && method !== "HEAD") {
    throw new APIError(
      400,
      "invalid_request_body",
      "Preview handoff requires a navigation request",
      { retriable: false },
    );
  }
}

function healthResponse(env: PreviewProxyEnv): Response {
  return Response.json({
    ok: true,
    releaseSha: env.CHEATCODE_RELEASE_SHA ?? "development",
    versionId: env.CF_VERSION_METADATA?.id ?? null,
    worker: WORKER_NAME,
  });
}

function requirePreviewTarget(hostname: string, previewHostname: string) {
  const target = parsePreviewHost(hostname, previewHostname);
  if (!target) {
    throw new APIError(400, "invalid_request_body", "Malformed preview host", {
      hint: `Preview hosts look like {sandboxId}--{port}.${previewHostname}.`,
      retriable: false,
    });
  }
  return target;
}

async function requirePreviewSecret(env: PreviewProxyEnv): Promise<string> {
  const secret = await resolveWorkerSecret(env.PREVIEW_TOKEN_SECRET);
  if (!secret) {
    throw new APIError(500, "internal_error", "Preview token secret is not configured", {
      retriable: false,
    });
  }
  return secret;
}

function previewSessionRefresh(setCookie: string): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "private, no-store",
      "Set-Cookie": setCookie,
    },
    status: 204,
  });
}

function previewSessionRedirect(url: URL, setCookie: string): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "private, no-store",
      Location: url.toString(),
      "Set-Cookie": setCookie,
    },
    status: 302,
  });
}

function buildSessionCookie(token: string, exp: number): string {
  const maxAgeSeconds = Math.max(0, Math.floor((exp - Date.now()) / 1000));
  // Partition the third-party iframe credential by the top-level app site. The
  // __Host- prefix and Secure/Path attributes keep it host-only.
  return `${PREVIEW_SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${maxAgeSeconds}`;
}

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function withRequestId(response: Response, id: string): Response {
  // A 101 WebSocket upgrade response cannot be cloned/re-headered, so pass it through.
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("X-Request-Id", id);
  return wrapped;
}

function withPreviewSecurityHeaders(response: Response): Response {
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const wrapped = new Response(response.body, response);
  wrapped.headers.append(
    "Content-Security-Policy",
    `frame-ancestors 'self' ${CHEATCODE_APP_ORIGIN}`,
  );
  wrapped.headers.set("Origin-Agent-Cluster", "?1");
  wrapped.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (!wrapped.headers.has("Cache-Control")) {
    wrapped.headers.set("Cache-Control", "private, no-store");
  }
  appendSecurityVary(wrapped.headers);
  return wrapped;
}

function appendSecurityVary(headers: Headers): void {
  const vary = (headers.get("Vary") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (vary.includes("*")) {
    return;
  }
  for (const header of SECURITY_VARY_HEADERS) {
    if (!vary.some((value) => value.toLowerCase() === header.toLowerCase())) {
      vary.push(header);
    }
  }
  headers.set("Vary", vary.join(", "));
}

function routeName(request: Request): string {
  return `${request.method} ${new URL(request.url).pathname}`;
}

function statusClass(status: number): string {
  if (status >= 500) {
    return "5xx";
  }
  if (status >= 400) {
    return "4xx";
  }
  if (status >= 300) {
    return "3xx";
  }
  return "2xx";
}

const previewProxyHandler = {
  async fetch(request: Request, env: PreviewProxyEnv): Promise<Response> {
    const id = requestId();
    const startedAt = performance.now();
    let status = 500;
    try {
      const response = withPreviewSecurityHeaders(
        withRequestId(await handlePreviewRequest(request, env), id),
      );
      status = response.status;
      return response;
    } catch (error) {
      const apiError = toAPIError(error);
      status = apiError.status;
      emitErrorEvent(env, {
        errorCategory: WORKER_NAME,
        errorCode: apiError.code,
        httpStatus: apiError.status,
        route: routeName(request),
        workerName: WORKER_NAME,
        ...safeErrorTelemetry(error),
      });
      createLogger({ requestId: id }).error("preview_proxy_request_failed", {
        apiCode: apiError.code,
        httpStatus: apiError.status,
        ...safeErrorTelemetry(error),
      });
      return withPreviewSecurityHeaders(apiError.toResponse(id));
    } finally {
      emitPerformanceMetric(env, {
        route: WORKER_NAME,
        statusClass: statusClass(status),
        totalMs: performance.now() - startedAt,
        workerName: WORKER_NAME,
      });
    }
  },
};

export default withErrorHandler(previewProxyHandler, {
  errorCategory: WORKER_NAME,
  requestId: (request) => request.headers.get("X-Request-Id"),
  routeName,
  workerName: WORKER_NAME,
});
