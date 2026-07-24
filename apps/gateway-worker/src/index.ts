import { GatewayWorkerEnvSchema } from "@cheatcode/env";
import {
  APIError,
  createLogger,
  emitErrorEvent,
  emitPerformanceMetric,
  safeErrorTelemetry,
  toAPIError,
  withErrorHandler,
} from "@cheatcode/observability";
import {
  INTERNAL_DATABASE_READINESS_PATH,
  INTERNAL_DURABLE_OBJECT_STORAGE_PATH,
} from "@cheatcode/types";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
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
import { resolveLocalPreviewRoute } from "./local-preview-routing";
import {
  assertOpenApiRouteParity,
  gatewayOperationIdForRegisteredRoute,
  gatewayOperationIdForRequest,
  UNMATCHED_GATEWAY_ROUTE,
} from "./openapi-route-parity";
import { registerProjectHttpRoutes } from "./project-http-routes";
import { registerProviderHttpRoutes } from "./provider-http-routes";
import { withRateLimitErrorHeaders } from "./rate-limit";
import { type DownstreamWorker, readDownstreamReleaseHealth } from "./release-health";

export { IdempotencyStore, QuotaTracker, RateLimiter };

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
      "http://localhost:3001",
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
  const requestWithId = isWebSocketUpgrade(request) ? request : new Request(request);
  if (!isWebSocketUpgrade(requestWithId)) {
    requestWithId.headers.set("X-Request-Id", id);
  }
  const localPreview =
    env.CHEATCODE_ENVIRONMENT === "development" ? resolveLocalPreviewRoute(requestWithId) : null;
  if (localPreview?.kind === "redirect") {
    return withRequestId(localPreview.response, id);
  }
  if (localPreview?.kind === "proxy") {
    if (!env.PREVIEW_PROXY) {
      throw new APIError(503, "unavailable_maintenance", "Local preview proxy is not configured", {
        retriable: false,
      });
    }
    return withRequestId(await env.PREVIEW_PROXY.fetch(localPreview.request), id);
  }
  return withRequestId(await gatewayApp.fetch(requestWithId, env, ctx), id);
}

async function releaseGateResponse(
  request: Request,
  env: GatewayEnv,
  requestIdValue: string,
): Promise<Response | undefined> {
  if (env.CHEATCODE_RELEASE_GATE !== "closed") {
    return undefined;
  }
  const url = new URL(request.url);
  if (
    request.method === "POST" &&
    (url.pathname === INTERNAL_DATABASE_READINESS_PATH ||
      url.pathname === INTERNAL_DURABLE_OBJECT_STORAGE_PATH)
  ) {
    return undefined;
  }
  const details: Record<string, unknown> = {
    releaseGate: "closed",
    releaseSha: env.CHEATCODE_RELEASE_SHA ?? null,
    versionId: env.CF_VERSION_METADATA?.id ?? null,
    worker: "gateway",
  };
  if (request.method === "GET" && url.pathname === "/health") {
    const [agent, webhooks] = await Promise.all([
      readReleaseGateDownstreamHealth(env, "agent"),
      readReleaseGateDownstreamHealth(env, "webhooks"),
    ]);
    details["agent"] = agent;
    details["webhooks"] = webhooks;
  }
  const response = new APIError(503, "unavailable_maintenance", "Release is in progress", {
    details,
    retriable: true,
  }).toResponse(requestIdValue);
  applyReleaseGateHeaders(request, response, env.CHEATCODE_ENVIRONMENT);
  return response;
}

async function readReleaseGateDownstreamHealth(
  env: GatewayEnv,
  worker: DownstreamWorker,
): Promise<Record<string, unknown>> {
  try {
    const { health, status } = await readDownstreamReleaseHealth(env, worker);
    return { ...health, status };
  } catch {
    return unavailableDownstreamHealth(worker);
  }
}

function unavailableDownstreamHealth(worker: DownstreamWorker): Record<string, unknown> {
  return { ok: false, releaseSha: null, status: null, versionId: null, worker };
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

function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get("Upgrade") ?? "").toLowerCase() === "websocket";
}

export default withErrorHandler(gatewayHandler, {
  errorCategory: "gateway",
  requestId: (request) => request.headers.get("X-Request-Id"),
  routeName,
  workerName: "gateway",
});
