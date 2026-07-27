import { GatewayWorkerEnvSchema } from "@cheatcode/env";
import {
  APIError,
  createPerformanceMetricMiddleware,
  createWorkerRuntime,
  routeWorkerError,
} from "@cheatcode/observability";
import { normalizeTelemetryPath } from "@cheatcode/types";
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
import { registerProjectHttpRoutes } from "./project-http-routes";
import { registerProviderHttpRoutes } from "./provider-http-routes";
import { withRateLimitErrorHeaders } from "./rate-limit";

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

gatewayApp.onError((error, context) => {
  throw routeWorkerError(error, routeNameForContext(context));
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
gatewayApp.use(
  "*",
  createPerformanceMetricMiddleware<GatewayEnv, GatewayContext>({
    routeName: routeNameForContext,
    workerName: "gateway",
  }),
);

registerCoreHttpRoutes(gatewayApp);
registerAccountHttpRoutes(gatewayApp);
registerProjectHttpRoutes(gatewayApp);
registerProviderHttpRoutes(gatewayApp);
registerIntegrationHttpRoutes(gatewayApp);
registerBillingHttpRoutes(gatewayApp);
registerAgentHttpRoutes(gatewayApp);

function routeName(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${normalizeTelemetryPath(url.pathname)}`;
}

function routeNameForContext(c: GatewayContext): string {
  try {
    return `${c.req.method} ${routePath(c, -1)}`;
  } catch {
    return routeName(c.req.raw);
  }
}

const gatewayHandler = createWorkerRuntime<GatewayEnv, ExecutionContext>({
  errorCategory: "gateway",
  errorLogName: "gateway_request_failed",
  fetch: async (request, env, ctx) => {
    GatewayWorkerEnvSchema.parse(env);
    return routeGatewayRequest(request, env, ctx);
  },
  formatError: ({ error, requestId: id }) =>
    withRateLimitErrorHeaders(formatGatewayRouteError(error, id), error),
  routeName,
  workerName: "gateway",
});

async function routeGatewayRequest(
  request: Request,
  env: GatewayEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const localPreview =
    env.CHEATCODE_ENVIRONMENT === "development" ? resolveLocalPreviewRoute(request) : null;
  if (localPreview?.kind === "redirect") {
    return localPreview.response;
  }
  if (localPreview?.kind === "proxy") {
    if (!env.PREVIEW_PROXY) {
      throw new APIError(503, "unavailable_maintenance", "Local preview proxy is not configured", {
        retriable: false,
      });
    }
    return env.PREVIEW_PROXY.fetch(localPreview.request);
  }
  return gatewayApp.fetch(request, env, ctx);
}

export default gatewayHandler;
