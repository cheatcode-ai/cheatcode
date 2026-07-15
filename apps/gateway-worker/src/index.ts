import { GatewayWorkerEnvSchema } from "@cheatcode/env";
import {
  APIError,
  createLogger,
  emitErrorEvent,
  emitPerformanceMetric,
  readBoundedResponseJson,
  safeErrorTelemetry,
  toAPIError,
  withErrorHandler,
} from "@cheatcode/observability";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { registerAccountHttpRoutes } from "./account-http-routes";
import { registerAgentHttpRoutes } from "./agent-http-routes";
import { registerBillingHttpRoutes } from "./billing-http-routes";
import { registerCoreHttpRoutes } from "./core-http-routes";
import { resolveCorsOrigin } from "./cors";
import { IdempotencyStore } from "./durable-objects/idempotency";
import { QuotaTracker } from "./durable-objects/quota-tracker";
import { RateLimiter } from "./durable-objects/rate-limiter";
import { formatGatewayRouteError } from "./error-handling";
import type { GatewayContext, GatewayEnv } from "./gateway-env";
import { registerIntegrationHttpRoutes } from "./integration-http-routes";
import {
  localPreviewOriginRequest,
  resolveLocalPreviewProxyRequest,
  resolveLocalSandboxPreviewHost,
  rewriteLocalPreviewRequest,
  withLocalPreviewCookie,
} from "./local-preview-proxy";
import {
  assertOpenApiRouteParity,
  gatewayOperationIdForRegisteredRoute,
  gatewayOperationIdForRequest,
  UNMATCHED_GATEWAY_ROUTE,
} from "./openapi-route-parity";
import { registerProjectHttpRoutes } from "./project-http-routes";
import { registerProviderHttpRoutes } from "./provider-http-routes";
import { withRateLimitErrorHeaders } from "./rate-limit";

export { IdempotencyStore, QuotaTracker, RateLimiter };

const LocalPreviewOriginResponseSchema = z.object({
  originalHost: z.string().min(1),
  signed: z.boolean(),
  token: z.string(),
  url: z.string().url(),
});
type LocalPreviewOriginResponse = z.infer<typeof LocalPreviewOriginResponseSchema>;

interface LocalPreviewOriginRequestInput {
  clientHost: string;
  cookie?: string;
  host: string;
  origin?: string;
  url: string;
}
const ReleaseGateAgentHealthSchema = z
  .object({
    ok: z.literal(true),
    releaseSha: z.string().min(1),
    versionId: z.string().min(1).nullable(),
    worker: z.literal("agent"),
  })
  .strict();
const DAYTONA_TOKEN_HEADER = "x-daytona-preview-token";
const DAYTONA_SKIP_WARNING_HEADER = "X-Daytona-Skip-Preview-Warning";
const FORWARDED_HOST_HEADER = "X-Forwarded-Host";
const INTERNAL_USER_DELETE_PATH = /^\/internal\/users\/[^/]+\/delete-state$/u;
const MAX_AGENT_HEALTH_RESPONSE_BYTES = 16 * 1024;
const MAX_LOCAL_PREVIEW_ORIGIN_RESPONSE_BYTES = 32 * 1024;
const CORS_EXPOSED_HEADERS = [
  "Content-Disposition",
  "Location",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
  "Retry-After",
  "X-Request-Id",
];
const GATEWAY_SECURITY_HEADERS = {
  contentSecurityPolicy: {
    baseUri: ["'self'"],
    connectSrc: [
      "'self'",
      "https://gateway.trycheatcode.com",
      "https://trycheatcode.com",
      "http://localhost:3000",
      "http://localhost:8787",
      "ws://localhost:8787",
      "wss://*.trycheatcode.com",
    ],
    defaultSrc: ["'self'"],
    fontSrc: ["'self'", "data:"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    frameSrc: ["'none'"],
    imgSrc: ["'self'", "data:", "https:"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    workerSrc: ["'none'"],
  },
  referrerPolicy: "strict-origin-when-cross-origin",
  strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
  xFrameOptions: "DENY",
};

const gatewayApp = new Hono<{ Bindings: GatewayEnv }>();

gatewayApp.onError((error, c) => {
  const id = c.req.header("X-Request-Id") ?? requestId();
  const apiError = toAPIError(error);
  emitErrorEvent(c.env, {
    errorCategory: "gateway",
    errorCode: apiError.code,
    httpStatus: apiError.status,
    route: routeNameForContext(c),
    workerName: "gateway",
    ...safeErrorTelemetry(error),
  });
  return withRateLimitErrorHeaders(formatGatewayRouteError(error, id), error);
});

gatewayApp.use("*", secureHeaders(GATEWAY_SECURITY_HEADERS));
gatewayApp.use(
  "/v1/*",
  cors({
    allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: CORS_EXPOSED_HEADERS,
    maxAge: 86_400,
    origin: (origin, c) =>
      resolveCorsOrigin(
        origin,
        (c.env as Pick<GatewayEnv, "CHEATCODE_ENVIRONMENT">).CHEATCODE_ENVIRONMENT,
      ),
  }),
);
gatewayApp.use("*", async (c, next) => {
  const startedAt = performance.now();
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } finally {
    emitPerformanceMetric(c.env, {
      route: routeNameForContext(c),
      statusClass: statusClass(status),
      totalMs: performance.now() - startedAt,
      workerName: "gateway",
    });
  }
});

registerCoreHttpRoutes(gatewayApp);
registerAccountHttpRoutes(gatewayApp);
registerProjectHttpRoutes(gatewayApp);
registerProviderHttpRoutes(gatewayApp);
registerIntegrationHttpRoutes(gatewayApp);
registerBillingHttpRoutes(gatewayApp);
registerAgentHttpRoutes(gatewayApp);
assertOpenApiRouteParity(gatewayApp.routes);

function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "")}`;
}

function withRequestId(response: Response, id: string): Response {
  if (response.status === 101 || response.webSocket) {
    return response;
  }
  const wrapped = new Response(response.body, response);
  wrapped.headers.set("X-Request-Id", id);
  return wrapped;
}

function routeName(request: Request): string {
  return gatewayOperationIdForRequest(request);
}

function routeNameForContext(c: GatewayContext): string {
  try {
    return gatewayOperationIdForRegisteredRoute(c.req.method, routePath(c, -1));
  } catch {
    return UNMATCHED_GATEWAY_ROUTE;
  }
}

function statusClass(status: number): string {
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 300) return "3xx";
  return "2xx";
}

const gatewayHandler = {
  async fetch(request: Request, env: GatewayEnv, ctx: ExecutionContext): Promise<Response> {
    const id = requestId();
    const startedAt = performance.now();
    const logger = createLogger({ requestId: id });
    try {
      GatewayWorkerEnvSchema.parse(env);
      return await routeGatewayRequest(request, env, ctx, id, startedAt);
    } catch (error) {
      const apiError = toAPIError(error);
      emitErrorEvent(env, {
        errorCategory: "gateway",
        errorCode: apiError.code,
        httpStatus: apiError.status,
        route: routeName(request),
        workerName: "gateway",
        ...safeErrorTelemetry(error),
      });
      logger.error("gateway_request_failed", {
        apiCode: apiError.code,
        ...safeErrorTelemetry(error),
      });
      return apiError.toResponse(id);
    }
  },
};

async function routeGatewayRequest(
  request: Request,
  env: GatewayEnv,
  ctx: ExecutionContext,
  id: string,
  startedAt: number,
): Promise<Response> {
  const releaseGate = await releaseGateResponse(request, env, id);
  if (releaseGate) {
    emitPerformanceMetric(env, {
      route: routeName(request),
      statusClass: "5xx",
      totalMs: performance.now() - startedAt,
      workerName: "gateway",
    });
    return releaseGate;
  }
  const originalLocalPreviewHost = resolveLocalSandboxPreviewHost(request);
  const requestWithId = isWebSocketUpgrade(request) ? request : new Request(request);
  if (!isWebSocketUpgrade(requestWithId)) {
    requestWithId.headers.set("X-Request-Id", id);
  }
  const websocketResponse = await localPreviewWebSocketResponse(request, env);
  if (websocketResponse) {
    return websocketResponse;
  }
  const localPreviewProxy = resolveLocalPreviewProxyRequest(requestWithId);
  if (localPreviewProxy) {
    return withLocalPreviewCookie(
      await env.AGENT.fetch(localPreviewProxy.request),
      id,
      localPreviewProxy.encodedHost,
    );
  }
  const localPreviewHost =
    originalLocalPreviewHost ?? resolveLocalSandboxPreviewHost(requestWithId);
  if (localPreviewHost) {
    return withRequestId(
      await env.AGENT.fetch(rewriteLocalPreviewRequest(requestWithId, localPreviewHost)),
      id,
    );
  }
  return withRequestId(await gatewayApp.fetch(requestWithId, env, ctx), id);
}

async function localPreviewWebSocketResponse(
  request: Request,
  env: GatewayEnv,
): Promise<Response | undefined> {
  if (!isWebSocketUpgrade(request)) {
    return undefined;
  }
  const originRequest = localPreviewOriginRequest(request);
  return originRequest ? proxyLocalPreviewWebSocket(request, env, originRequest) : undefined;
}

async function releaseGateResponse(
  request: Request,
  env: GatewayEnv,
  requestIdValue: string,
): Promise<Response | undefined> {
  if (env.CHEATCODE_RELEASE_GATE !== "closed" || isInternalLifecycleRequest(request)) {
    return undefined;
  }
  const url = new URL(request.url);
  const details: Record<string, unknown> = {
    releaseGate: "closed",
    releaseSha: env.CHEATCODE_RELEASE_SHA ?? null,
    versionId: env.CF_VERSION_METADATA?.id ?? null,
    worker: "gateway",
  };
  if (request.method === "GET" && url.pathname === "/health") {
    details["agent"] = await readReleaseGateAgentHealth(env);
  }
  const response = new APIError(503, "unavailable_maintenance", "Release is in progress", {
    details,
    retriable: true,
  }).toResponse(requestIdValue);
  applyReleaseGateHeaders(request, response, env.CHEATCODE_ENVIRONMENT);
  return response;
}

function isInternalLifecycleRequest(request: Request): boolean {
  // HMAC-authenticated deletion must remain available while public traffic is drained.
  return request.method === "POST" && INTERNAL_USER_DELETE_PATH.test(new URL(request.url).pathname);
}

async function readReleaseGateAgentHealth(env: GatewayEnv): Promise<Record<string, unknown>> {
  try {
    const response = await env.AGENT.fetch(
      new Request("https://agent.internal/health", { signal: AbortSignal.timeout(3_000) }),
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return unavailableAgentHealth(response.status);
    }
    const health = ReleaseGateAgentHealthSchema.parse(
      await readBoundedResponseJson(
        response,
        MAX_AGENT_HEALTH_RESPONSE_BYTES,
        "Agent release health",
      ),
    );
    return { ...health, status: response.status };
  } catch {
    return unavailableAgentHealth(null);
  }
}

function unavailableAgentHealth(status: number | null): Record<string, unknown> {
  return { ok: false, releaseSha: null, status, versionId: null, worker: "agent" };
}

function applyReleaseGateHeaders(
  request: Request,
  response: Response,
  environment: GatewayEnv["CHEATCODE_ENVIRONMENT"],
): void {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Retry-After", "5");
  response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  const origin = resolveCorsOrigin(request.headers.get("Origin") ?? undefined, environment);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.append("Vary", "Origin");
  }
}

async function proxyLocalPreviewWebSocket(
  request: Request,
  env: GatewayEnv,
  originRequest: LocalPreviewOriginRequestInput,
): Promise<Response> {
  const originResponse = await env.AGENT.fetch(
    new Request("http://agent.internal/__internal/local-preview-origin", {
      headers: localPreviewOriginHeaders(originRequest),
    }),
  );
  if (!originResponse.ok) {
    return originResponse;
  }
  const origin = LocalPreviewOriginResponseSchema.parse(
    await readBoundedResponseJson(
      originResponse,
      MAX_LOCAL_PREVIEW_ORIGIN_RESPONSE_BYTES,
      "Agent local preview origin",
    ),
  );
  const websocketRequest = buildLocalPreviewWebSocketRequest(request, originRequest, origin);
  const response = await fetch(websocketRequest);
  if (response.webSocket) {
    return new Response(null, { status: 101, webSocket: response.webSocket });
  }
  return response;
}

function localPreviewOriginHeaders(originRequest: LocalPreviewOriginRequestInput): Headers {
  const headers = new Headers({
    "X-Cheatcode-Local-Preview-Client-Host": originRequest.clientHost,
    "X-Cheatcode-Local-Preview-Host": originRequest.host,
    "X-Cheatcode-Local-Preview-Url": originRequest.url,
  });
  if (originRequest.cookie) headers.set("X-Cheatcode-Local-Preview-Cookie", originRequest.cookie);
  if (originRequest.origin) headers.set("Origin", originRequest.origin);
  return headers;
}

function buildLocalPreviewWebSocketRequest(
  request: Request,
  originRequest: LocalPreviewOriginRequestInput,
  origin: LocalPreviewOriginResponse,
): Request {
  const localUrl = new URL(originRequest.url);
  const upstreamUrl = localPreviewUpstreamUrl(origin.url, localUrl);
  const websocketRequest = new Request(upstreamUrl.toString(), request);
  websocketRequest.headers.delete("Host");
  websocketRequest.headers.delete("Cookie");
  if (!origin.signed) {
    websocketRequest.headers.set(DAYTONA_TOKEN_HEADER, origin.token);
  }
  websocketRequest.headers.set(DAYTONA_SKIP_WARNING_HEADER, "true");
  websocketRequest.headers.set(FORWARDED_HOST_HEADER, origin.originalHost);
  const browserOrigin =
    request.headers.get("Origin") ??
    `${new URL(originRequest.url).protocol}//${origin.originalHost}`;
  const browserProtocol = new URL(browserOrigin).protocol.replace(":", "");
  websocketRequest.headers.set("Origin", browserOrigin);
  websocketRequest.headers.set("Forwarded", `host=${origin.originalHost};proto=${browserProtocol}`);
  websocketRequest.headers.set("X-Forwarded-Proto", browserProtocol);
  return websocketRequest;
}

function localPreviewUpstreamUrl(originUrl: string, requestUrl: URL): URL {
  const upstreamUrl = new URL(originUrl);
  const requestParams = new URLSearchParams(requestUrl.search);
  upstreamUrl.pathname = requestUrl.pathname;
  for (const [key, value] of requestParams) {
    upstreamUrl.searchParams.append(key, value);
  }
  upstreamUrl.searchParams.delete("__cc_pt");
  upstreamUrl.searchParams.delete("cc_preview_reload");
  return upstreamUrl;
}

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

export default withErrorHandler(gatewayHandler, {
  errorCategory: "gateway",
  requestId: (request) => request.headers.get("X-Request-Id"),
  routeName,
  workerName: "gateway",
});
