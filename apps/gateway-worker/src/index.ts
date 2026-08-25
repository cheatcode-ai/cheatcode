import { createDatabaseHandle, type DatabaseHandle } from "@cheatcode/db";
import { GatewayWorkerEnvSchema, PRODUCTION_APP_ORIGIN } from "@cheatcode/env";
import {
  APIError,
  createPerformanceMetricMiddleware,
  createPerformanceRecorder,
  createWorkerRuntime,
  reportWorkerError,
  requestId,
  safeServerTiming,
} from "@cheatcode/observability";
import { normalizeTelemetryPath } from "@cheatcode/types";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { routePath } from "hono/route";
import { secureHeaders } from "hono/secure-headers";
import { registerActivityHttpRoutes } from "./activity-http-routes";
import { registerAgentHttpRoutes } from "./agent-http-routes";
import { resolveGatewayPrincipal } from "./authenticate";
import { registerBillingHttpRoutes } from "./billing-http-routes";
import { registerBootstrapHttpRoutes } from "./bootstrap-http-routes";
import { registerCoreHttpRoutes } from "./core-http-routes";
import { resolveCorsOrigin } from "./cors";
import { IdempotencyStore } from "./durable-objects/idempotency";
import { RateLimiter } from "./durable-objects/rate-limiter";
import { formatGatewayRouteError } from "./error-handling";
import {
  type GatewayContext,
  type GatewayEnv,
  type GatewayHonoEnv,
  requestPerformance,
} from "./gateway-env";
import { registerGreetingHttpRoutes } from "./greeting-http-routes";
import { registerIntegrationHttpRoutes } from "./integration-http-routes";
import { resolveLocalPreviewRoute } from "./local-preview-routing";
import { registerProfileHttpRoutes } from "./profile-http-routes";
import { registerProjectHttpRoutes } from "./project-http-routes";
import { registerProviderHttpRoutes } from "./provider-http-routes";
import { withRateLimitErrorHeaders } from "./rate-limit";
import { registerSearchHttpRoutes } from "./search-http-routes";

export { IdempotencyStore, RateLimiter };

const CORS_EXPOSED_HEADERS = [
  "Content-Disposition",
  "Location",
  "RateLimit-Limit",
  "RateLimit-Remaining",
  "RateLimit-Reset",
  "Retry-After",
  "Server-Timing",
  "X-Request-Id",
];
const GATEWAY_SECURITY_HEADERS = {
  contentSecurityPolicy: {
    baseUri: ["'self'"],
    connectSrc: [
      "'self'",
      "https://gateway.trycheatcode.com",
      PRODUCTION_APP_ORIGIN,
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
  crossOriginResourcePolicy: false,
  referrerPolicy: "strict-origin-when-cross-origin",
  strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
  xFrameOptions: "DENY",
};

const gatewayApp = new Hono<GatewayHonoEnv>();

gatewayApp.use("*", async (c, next) => {
  const recorder = createPerformanceRecorder();
  let principal: ReturnType<typeof resolveGatewayPrincipal> | undefined;
  c.set("performance", recorder);
  c.set("principal", () => {
    principal ??= resolveGatewayPrincipal(c);
    return principal;
  });
  await next();
});

// Answer route errors in-band: cors() stages its headers on the context before
// the route runs and secureHeaders() applies after it, so the error response
// must flow back through the middleware stack. Rethrowing to the runtime's
// catch-all would strip CORS from every cross-origin error the SPA reads.
gatewayApp.onError((error, context) => {
  const id = context.req.header("X-Request-Id") ?? requestId();
  reportWorkerError(context.env, {
    error,
    errorLogName: "gateway_request_failed",
    requestId: id,
    route: routeNameForContext(context),
    workerName: "gateway",
  });
  return withRateLimitErrorHeaders(formatGatewayRouteError(error, id), error);
});

gatewayApp.use("*", secureHeaders(GATEWAY_SECURITY_HEADERS));
gatewayApp.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Cross-Origin-Resource-Policy")) {
    c.res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
});
gatewayApp.use("/v1/*", async (c, next) => {
  let handle: DatabaseHandle | undefined;
  c.set("database", () => {
    handle ??= createDatabaseHandle(c.env, {
      onTiming: (phase, durationMs) => {
        const recorder = requestPerformance(c);
        const performancePhase =
          phase === "connection"
            ? "databaseConnection"
            : phase === "context"
              ? "databaseContext"
              : "databaseQuery";
        recorder.add(performancePhase, durationMs);
      },
    });
    return handle;
  });
  try {
    await next();
  } finally {
    await handle?.close();
  }
});
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
gatewayApp.use("/v1/*", async (c, next) => {
  await next();
  if (c.req.method !== "OPTIONS" && !c.res.headers.has("Cache-Control")) {
    c.res.headers.set("Cache-Control", "private, no-store");
  }
});
gatewayApp.use(
  "*",
  createPerformanceMetricMiddleware<GatewayEnv, GatewayContext>({
    decorateResponse: (c, recorder) => {
      if (recorder) c.header("Server-Timing", safeServerTiming(recorder));
      const timingOrigin = resolveCorsOrigin(c.req.header("Origin"), c.env.CHEATCODE_ENVIRONMENT);
      if (timingOrigin) c.header("Timing-Allow-Origin", timingOrigin);
    },
    metricFields: (c) => {
      const colo = requestColo(c.req.raw);
      const placement = c.req.header("cf-placement");
      const reconnectState = requestReconnectState(c.req.raw);
      const versionTag = c.env.CF_VERSION_METADATA?.id ?? c.env.CHEATCODE_RELEASE_SHA;
      return {
        ...(colo ? { colo } : {}),
        envTag: c.env.CHEATCODE_ENVIRONMENT,
        ...(placement ? { placement } : {}),
        ...(reconnectState ? { reconnectState } : {}),
        ...(versionTag ? { versionTag } : {}),
      };
    },
    recorder: requestPerformance,
    routeName: routeNameForContext,
    workerName: "gateway",
  }),
);

registerCoreHttpRoutes(gatewayApp);
registerActivityHttpRoutes(gatewayApp);
registerProfileHttpRoutes(gatewayApp);
registerBootstrapHttpRoutes(gatewayApp);
registerSearchHttpRoutes(gatewayApp);
registerGreetingHttpRoutes(gatewayApp);
registerProjectHttpRoutes(gatewayApp);
registerProviderHttpRoutes(gatewayApp);
registerIntegrationHttpRoutes(gatewayApp);
registerBillingHttpRoutes(gatewayApp);
registerAgentHttpRoutes(gatewayApp);

function routeName(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${normalizeTelemetryPath(url.pathname)}`;
}

function requestReconnectState(request: Request): "new" | "reconnect" | undefined {
  const pathname = new URL(request.url).pathname;
  if (request.method === "POST" && pathname.endsWith("/runs")) return "new";
  if (request.method === "GET" && pathname.endsWith("/runs/stream")) return "reconnect";
  return undefined;
}

function routeNameForContext(c: GatewayContext): string {
  try {
    return `${c.req.method} ${routePath(c, -1)}`;
  } catch {
    return routeName(c.req.raw);
  }
}

function requestColo(request: Request): string | undefined {
  const colo = request.cf?.colo;
  return typeof colo === "string" ? colo : undefined;
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
      throw new APIError(
        503,
        "service_maintenance_unavailable",
        "Local preview proxy is not configured",
        {
          retriable: false,
        },
      );
    }
    return env.PREVIEW_PROXY.fetch(localPreview.request);
  }
  return gatewayApp.fetch(request, env, ctx);
}

export default gatewayHandler;
