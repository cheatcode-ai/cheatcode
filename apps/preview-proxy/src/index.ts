import { resolveWorkerSecret } from "@cheatcode/env";
import {
  APIError,
  createLogger,
  emitErrorEvent,
  emitPerformanceMetric,
  toAPIError,
  withErrorHandler,
} from "@cheatcode/observability";
import { type PreviewProxyEnv, PreviewProxyEnvSchema } from "./env";
import { parsePreviewHost } from "./host";
import { proxyPreviewRequest } from "./proxy";
import { authorizePreviewRequest } from "./token";

const COOKIE_TOKEN_NAME = "cc_pt";
const QUERY_TOKEN_PARAM = "__cc_pt";
const WORKER_NAME = "preview-proxy";

async function handlePreviewRequest(request: Request, env: PreviewProxyEnv): Promise<Response> {
  PreviewProxyEnvSchema.parse(env);
  const url = new URL(request.url);
  const originalHost = request.headers.get("Host") ?? url.host;
  const target = parsePreviewHost(originalHost);
  if (!target) {
    throw new APIError(400, "invalid_request_body", "Malformed preview host", {
      hint: "Preview hosts look like {sandboxId}--{port}.trycheatcode.com.",
      retriable: false,
    });
  }

  const secret = await resolveWorkerSecret(env.PREVIEW_TOKEN_SECRET);
  if (!secret) {
    throw new APIError(500, "internal_error", "Preview token secret is not configured", {
      retriable: false,
    });
  }

  const authorized = await authorizePreviewRequest({ request, secret, target, url });
  // The query token must never reach the origin; persist it as a cookie instead.
  url.searchParams.delete(QUERY_TOKEN_PARAM);
  const setCookie = authorized.fromQuery
    ? buildSessionCookie(authorized.token, authorized.verified.exp)
    : undefined;

  return proxyPreviewRequest({
    env,
    originalHost,
    request,
    target,
    url,
    ...(setCookie ? { setCookie } : {}),
  });
}

function buildSessionCookie(token: string, exp: number): string {
  const maxAgeSeconds = Math.max(0, Math.floor((exp - Date.now()) / 1000));
  // SameSite=None is required because the preview is loaded in a cross-site
  // iframe (top-level web.trycheatcode.com -> {id}--{port}.trycheatcode.com).
  return `${COOKIE_TOKEN_NAME}=${token}; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=${maxAgeSeconds}`;
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
      const response = withRequestId(await handlePreviewRequest(request, env), id);
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
        ...(error instanceof Error ? { message: error.message } : {}),
      });
      createLogger({ requestId: id }).error("preview_proxy_request_failed", {
        code: apiError.code,
        httpStatus: apiError.status,
      });
      return apiError.toResponse(id);
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
