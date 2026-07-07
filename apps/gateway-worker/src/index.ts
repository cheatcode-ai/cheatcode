import { verifyInternalMaintenanceRequest } from "@cheatcode/auth";
import {
  deleteProviderKey,
  listProviderKeys,
  setProviderKey,
  validateProviderKey,
} from "@cheatcode/byok";
import { createDb, withUserContext } from "@cheatcode/db";
import { GatewayWorkerEnvSchema, type WorkerSecret } from "@cheatcode/env";
import {
  type AnalyticsBindings,
  APIError,
  createLogger,
  emitErrorEvent,
  emitPerformanceMetric,
  emitUserEvent,
  toAPIError,
  withErrorHandler,
} from "@cheatcode/observability";
import {
  ProviderSchema,
  UserId as toUserId,
  UpsertProviderKeySchema,
  type UserId,
} from "@cheatcode/types";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { getMeRoute, updateMeRoute } from "./account-routes";
import { decideRunApprovalRoute, readSandboxConsoleRoute } from "./agent-proxy-routes";
import { authenticate, readRequiredSecret, requireVerifiedClerkEmail } from "./authenticate";
import {
  createAutomationRoute,
  deleteAutomationRoute,
  getAutomationRoute,
  listAutomationRunsRoute,
  listAutomationsRoute,
  runAutomationNowRoute,
  updateAutomationRoute,
} from "./automations-routes";
import {
  billingCancelRoute,
  billingCatalogRoute,
  billingCheckoutRoute,
  billingPortalRoute,
  billingReactivateRoute,
  billingStateRoute,
  myUsageRoute,
} from "./billing-routes";
import { resolveCorsOrigin } from "./cors";
import { IdempotencyStore } from "./durable-objects/idempotency";
import { QuotaTracker } from "./durable-objects/quota-tracker";
import { RateLimiter } from "./durable-objects/rate-limiter";
import { formatGatewayRouteError } from "./error-handling";
import { greetingRoute } from "./greeting-routes";
import {
  completeIdempotentRunRequest,
  type IdempotencyBindings,
  prepareIdempotentRunRequest,
} from "./idempotency";
import {
  connectIntegration,
  deleteIntegration,
  listIntegrationSummaries,
  parseIntegrationName,
} from "./integrations";
import { getIntegrationCatalog, listToolkitActions } from "./integrations-catalog";
import { buildLimitsSnapshot, enforceByokProviderSlotLimit } from "./limits";
import {
  localPreviewOriginRequest,
  resolveLocalPreviewProxyRequest,
  resolveLocalSandboxPreviewHost,
  rewriteLocalPreviewRequest,
  withLocalPreviewCookie,
} from "./local-preview-proxy";
import { listAgentsRoute, listToolsRoute } from "./metadata-routes";
import { OPENAPI_DOCUMENT, openApiDocsHtml } from "./openapi";
import { getMyProfileRoute, updateMyProfileRoute } from "./profile-routes";
import {
  createChatRoute,
  createProjectRoute,
  deleteProjectRoute,
  deleteThreadRoute,
  getProjectRoute,
  getThreadRoute,
  listProjectsRoute,
  listProjectThreadsRoute,
  listThreadMessagesRoute,
  parseProjectParam,
  parseThreadParam,
  updateProjectRoute,
  updateThreadRoute,
} from "./project-routes";
import { ensureFallbackRateLimitHeaders, rateLimit, withRateLimitHeaders } from "./rate-limit";
import { listRecentThreadsRoute, searchWorkspaceRoute } from "./search-routes";
import { createUserSkillRoute, deleteUserSkillRoute, listUserSkillsRoute } from "./skills-routes";
import { clientErrorRoute, clientUserEventRoute, vitalsRoute } from "./telemetry-routes";
import { listUsageDailyRoute } from "./usage-routes";

export { IdempotencyStore, QuotaTracker, RateLimiter };

export interface GatewayEnv extends AnalyticsBindings, IdempotencyBindings {
  AGENT: Fetcher;
  CLERK_JWT_KEY?: WorkerSecret;
  CLERK_SECRET_KEY?: WorkerSecret;
  COMPOSIO_API_KEY?: WorkerSecret;
  COMPOSIO_AUTH_CONFIGS?: WorkerSecret;
  ENTITLEMENTS_CACHE: KVNamespace;
  HYPERDRIVE: Hyperdrive;
  IDEMPOTENCY: DurableObjectNamespace<IdempotencyStore>;
  INTERNAL_MAINTENANCE_SECRET?: WorkerSecret;
  POLAR_ACCESS_TOKEN?: WorkerSecret;
  POLAR_PRODUCT_ID_MAX?: string;
  POLAR_PRODUCT_ID_PREMIUM?: string;
  POLAR_PRODUCT_ID_PRO?: string;
  POLAR_PRODUCT_ID_ULTRA?: string;
  QUOTA_TRACKER: DurableObjectNamespace<QuotaTracker>;
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;
}

type GatewayContext = Context<{ Bindings: GatewayEnv }>;
const InternalMaintenanceBodySchema = z.object({}).strict();
const InternalMaintenanceUserIdSchema = z.string().uuid();
const LocalPreviewOriginResponseSchema = z.object({
  originalHost: z.string().min(1),
  signed: z.boolean(),
  token: z.string(),
  url: z.string().url(),
});
const DAYTONA_TOKEN_HEADER = "x-daytona-preview-token";
const DAYTONA_SKIP_WARNING_HEADER = "X-Daytona-Skip-Preview-Warning";
const FORWARDED_HOST_HEADER = "X-Forwarded-Host";
const GATEWAY_SECURITY_HEADERS = {
  contentSecurityPolicy: {
    baseUri: ["'self'"],
    connectSrc: [
      "'self'",
      "https://gateway.trycheatcode.com",
      "https://web.trycheatcode.com",
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

function parseMaintenanceJson(rawBody: string): unknown {
  try {
    return rawBody.trim() ? (JSON.parse(rawBody) as unknown) : {};
  } catch {
    throw new APIError(400, "invalid_request_body", "Internal maintenance body must be JSON", {
      retriable: false,
    });
  }
}

function errorLogFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const cause = error.cause;
    return {
      causeMessage: cause instanceof Error ? cause.message : undefined,
      causeName: cause instanceof Error ? cause.name : undefined,
      errorMessage: error.message,
      errorName: error.name,
    };
  }
  return { errorType: typeof error };
}

function errorEventDetails(error: unknown): { message?: string; stack?: string } {
  if (!(error instanceof Error)) {
    return {};
  }
  return {
    message: error.message,
    ...(error.stack ? { stack: error.stack } : {}),
  };
}

async function forwardAgentRequest(c: GatewayContext, route: string): Promise<Response> {
  const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
  const headers = await rateLimit(c, userId, route);
  const forwarded = new Request(c.req.raw);
  forwarded.headers.set("X-Cheatcode-User-Id", userId);
  return withRateLimitHeaders(await c.env.AGENT.fetch(forwarded), headers);
}

export const gatewayApp = new Hono<{ Bindings: GatewayEnv }>();

gatewayApp.onError((error, c) => {
  const id = c.req.header("X-Request-Id") ?? requestId();
  const apiError = toAPIError(error);
  emitErrorEvent(c.env, {
    errorCategory: "gateway",
    errorCode: apiError.code,
    httpStatus: apiError.status,
    route: routeName(c.req.raw),
    workerName: "gateway",
    ...errorEventDetails(error),
  });
  return formatGatewayRouteError(error, id);
});

gatewayApp.use("*", secureHeaders(GATEWAY_SECURITY_HEADERS));
gatewayApp.use(
  "/v1/*",
  cors({
    origin: resolveCorsOrigin,
    credentials: true,
    allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);
gatewayApp.use("*", async (c, next) => {
  await next();
  ensureFallbackRateLimitHeaders(c.res.headers, c.req.raw);
});
gatewayApp.use("*", async (c, next) => {
  const startedAt = performance.now();
  let status = 500;
  try {
    await next();
    status = c.res.status;
  } finally {
    emitPerformanceMetric(c.env, {
      route: routeName(c.req.raw),
      statusClass: statusClass(status),
      totalMs: performance.now() - startedAt,
      workerName: "gateway",
    });
  }
});

export const gatewayRoutes = gatewayApp
  .get("/health", (c) => c.json({ ok: true, version: "0.0.0" }))
  .post("/internal/users/:userId/delete-state", async (c) => {
    const rawBody = await c.req.raw.text();
    const secret = await readRequiredSecret(
      c.env.INTERNAL_MAINTENANCE_SECRET,
      "INTERNAL_MAINTENANCE_SECRET",
    );
    await verifyInternalMaintenanceRequest({ rawBody, request: c.req.raw, secret });
    InternalMaintenanceBodySchema.parse(parseMaintenanceJson(rawBody));
    const userId = toUserId(InternalMaintenanceUserIdSchema.parse(c.req.param("userId")));
    const quotaTracker = c.env.QUOTA_TRACKER.get(c.env.QUOTA_TRACKER.idFromName(`quota:${userId}`));
    const response = await quotaTracker.fetch("https://quota.internal/delete-all", {
      method: "POST",
    });
    if (!response.ok) {
      throw new APIError(503, "unavailable_maintenance", "Quota durable state deletion failed", {
        details: { status: response.status },
        retriable: true,
      });
    }
    return c.json({ ok: true, quotaStateDeleted: true });
  })
  .get(
    "/openapi.json",
    () =>
      new Response(JSON.stringify(OPENAPI_DOCUMENT), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
  )
  .get("/docs", (c) => c.html(openApiDocsHtml()))
  .post("/v1/client-error", async (c) => {
    return clientErrorRoute(c, optionalTelemetryUser);
  })
  .post("/v1/vitals", async (c) => {
    return vitalsRoute(c);
  })
  .post("/v1/user-events", async (c) => {
    return clientUserEventRoute(c, optionalTelemetryUser);
  })
  .get("/v1/outputs/:outputId/download", (c) => c.env.AGENT.fetch(c.req.raw))
  .get("/v1/skills", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/skills");
    return listUserSkillsRoute(c.env, c.executionCtx, userId);
  })
  .post("/v1/skills", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/skills");
    return createUserSkillRoute(c.env, c.executionCtx, c.req.raw, userId);
  })
  .delete("/v1/skills/:skillId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/skills/:skillId");
    return deleteUserSkillRoute(c.env, c.executionCtx, userId, c.req.param("skillId"));
  })
  .get("/v1/me", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/me");
    return getMeRoute(c.env, c.executionCtx, userId);
  })

  .patch("/v1/me", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "PATCH /v1/me");
    return updateMeRoute(c.env, c.executionCtx, c.req.raw, userId);
  })

  .get("/v1/me/profile", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/me/profile");
    return getMyProfileRoute(c.env, c.executionCtx, userId);
  })

  .patch("/v1/me/profile", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "PATCH /v1/me/profile");
    return updateMyProfileRoute(c.env, c.executionCtx, c.req.raw, userId);
  })

  .get("/v1/me/usage", async (c) => {
    return myUsageRoute(c, { authenticate, readRequiredSecret });
  })

  .get("/v1/limits", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/limits");
    const { db, close } = createDb(c.env.HYPERDRIVE);
    try {
      const snapshot = await withUserContext(db, userId, (tx) =>
        buildLimitsSnapshot(c.env, tx, userId),
      );
      return c.json(snapshot);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  })

  .get("/v1/usage/daily", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/usage/daily");
    return listUsageDailyRoute(c.env, c.executionCtx, c.req.raw, userId);
  })

  .get("/v1/search", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/search");
    return searchWorkspaceRoute(c.env, c.executionCtx, c.req.raw, userId);
  })
  .get("/v1/threads", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/threads");
    return listRecentThreadsRoute(c.env, c.executionCtx, c.req.raw, userId);
  })

  .get("/v1/greeting", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/greeting");
    return greetingRoute(c.env, c.executionCtx, c.req.raw, userId);
  })

  .get("/v1/projects", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/projects");
    return listProjectsRoute(c.env, c.executionCtx, c.req.raw, userId);
  })

  .post("/v1/projects", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/projects");
    return createProjectRoute(c.env, c.executionCtx, c.req.raw, userId);
  })

  .get("/v1/projects/:projectId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/projects/:projectId");
    return getProjectRoute(
      c.env,
      c.executionCtx,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  })

  .patch("/v1/projects/:projectId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "PATCH /v1/projects/:projectId");
    return updateProjectRoute(
      c.env,
      c.executionCtx,
      c.req.raw,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  })

  .delete("/v1/projects/:projectId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/projects/:projectId");
    return deleteProjectRoute(
      c.env,
      c.executionCtx,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  })

  .get("/v1/projects/:projectId/threads", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/projects/:projectId/threads");
    return listProjectThreadsRoute(
      c.env,
      c.executionCtx,
      c.req.raw,
      parseProjectParam(c.req.param("projectId")),
      userId,
    );
  })

  .post("/v1/threads", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/threads");
    return createChatRoute(c.env, c.executionCtx, c.req.raw, userId);
  })

  .get("/v1/threads/:threadId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/threads/:threadId");
    return getThreadRoute(c.env, c.executionCtx, parseThreadParam(c.req.param("threadId")), userId);
  })

  .patch("/v1/threads/:threadId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "PATCH /v1/threads/:threadId");
    return updateThreadRoute(
      c.env,
      c.executionCtx,
      c.req.raw,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  })

  .delete("/v1/threads/:threadId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/threads/:threadId");
    return deleteThreadRoute(
      c.env,
      c.executionCtx,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  })

  .get("/v1/threads/:threadId/messages", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/threads/:threadId/messages");
    return listThreadMessagesRoute(
      c.env,
      c.executionCtx,
      c.req.raw,
      parseThreadParam(c.req.param("threadId")),
      userId,
    );
  })

  .get("/v1/automations", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/automations");
    return listAutomationsRoute(c.env, c.executionCtx, userId);
  })

  .post("/v1/automations", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/automations");
    return createAutomationRoute(c.env, c.executionCtx, c.req.raw, userId);
  })

  .get("/v1/automations/:automationId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/automations/:automationId");
    return getAutomationRoute(c.env, c.executionCtx, userId, c.req.param("automationId"));
  })

  .patch("/v1/automations/:automationId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "PATCH /v1/automations/:automationId");
    return updateAutomationRoute(
      c.env,
      c.executionCtx,
      c.req.raw,
      userId,
      c.req.param("automationId"),
    );
  })

  .delete("/v1/automations/:automationId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/automations/:automationId");
    return deleteAutomationRoute(c.env, c.executionCtx, userId, c.req.param("automationId"));
  })

  .post("/v1/automations/:automationId/run", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/automations/:automationId/run");
    return runAutomationNowRoute(c.env, c.executionCtx, userId, c.req.param("automationId"));
  })

  .get("/v1/automations/:automationId/runs", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/automations/:automationId/runs");
    return listAutomationRunsRoute(c.env, c.executionCtx, userId, c.req.param("automationId"));
  })

  .get("/v1/tools", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/tools");
    return listToolsRoute(c.req.query("domain"));
  })

  .get("/v1/agents", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/agents");
    return listAgentsRoute();
  })

  .get("/v1/provider-keys", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/provider-keys");
    const { db, close } = createDb(c.env.HYPERDRIVE);
    try {
      const keys = await withUserContext(db, userId, (tx) => listProviderKeys(tx));
      return c.json(keys);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  })

  .post("/v1/provider-keys", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/provider-keys");
    const parsedInput = UpsertProviderKeySchema.safeParse(await c.req.json());
    if (!parsedInput.success) {
      throw new APIError(400, "invalid_request_body", "Invalid provider key payload", {
        details: { issues: parsedInput.error.issues.map((issue) => issue.message) },
        retriable: false,
      });
    }
    const input = parsedInput.data;
    await validateProviderKey(input.provider, input.key);
    const { db, close } = createDb(c.env.HYPERDRIVE);
    try {
      const result = await withUserContext(db, userId, async (tx) => {
        const existingKeys = await listProviderKeys(tx);
        await enforceByokProviderSlotLimit(c.env, tx, userId, input.provider, existingKeys);
        await setProviderKey(tx, input.provider, input.key);
        const keys = await listProviderKeys(tx);
        const summary =
          keys.find((key) => key.provider === input.provider) ??
          existingKeys.find((key) => key.provider === input.provider);
        return { summary, wasFirstProviderKey: existingKeys.length === 0 };
      });
      if (!result.summary) {
        throw new APIError(500, "internal_error", "Provider key was not stored", {
          retriable: true,
        });
      }
      if (result.wasFirstProviderKey) {
        emitUserEvent(c.env, {
          eventName: "first_byok_key_added",
          userId,
        });
      }
      return c.json(result.summary, 201);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  })

  .delete("/v1/provider-keys/:provider", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/provider-keys/:provider");
    const parsedProvider = ProviderSchema.safeParse(c.req.param("provider"));
    if (!parsedProvider.success) {
      throw new APIError(400, "invalid_path_param", "Invalid provider", {
        details: { issues: parsedProvider.error.issues.map((issue) => issue.message) },
        retriable: false,
      });
    }
    const provider = parsedProvider.data;
    const { db, close } = createDb(c.env.HYPERDRIVE);
    try {
      await withUserContext(db, userId, (tx) => deleteProviderKey(tx, provider));
      return c.body(null, 204);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  })

  .get("/v1/integrations", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/integrations");
    const { db, close } = createDb(c.env.HYPERDRIVE);
    try {
      const integrations = await withUserContext(db, userId, (tx) =>
        listIntegrationSummaries(tx, userId),
      );
      return c.json(integrations);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  })

  .get("/v1/integrations/catalog", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/integrations/catalog");
    const { db, close } = createDb(c.env.HYPERDRIVE);
    try {
      const catalog = await withUserContext(db, userId, (tx) =>
        getIntegrationCatalog(tx, c.env, userId),
      );
      return c.json(catalog);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  })

  .get("/v1/integrations/:name/tools", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/integrations/:name/tools");
    const integration = parseIntegrationName(c.req.param("name"));
    const actions = await listToolkitActions(c.env, integration);
    return c.json(actions);
  })

  .post("/v1/integrations/:name/connect", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/integrations/:name/connect");
    const integration = parseIntegrationName(c.req.param("name"));
    const { db, close } = createDb(c.env.HYPERDRIVE);
    try {
      return await withUserContext(db, userId, (tx) =>
        connectIntegration({
          db: tx,
          env: c.env,
          integration,
          request: c.req.raw,
          userId,
        }),
      );
    } finally {
      c.executionCtx.waitUntil(close());
    }
  })

  .delete("/v1/integrations/:name", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/integrations/:name");
    const integration = parseIntegrationName(c.req.param("name"));
    const { db, close } = createDb(c.env.HYPERDRIVE);
    try {
      await withUserContext(db, userId, (tx) =>
        deleteIntegration({ db: tx, env: c.env, integration, userId }),
      );
      return c.body(null, 204);
    } finally {
      c.executionCtx.waitUntil(close());
    }
  })

  .get("/v1/billing/catalog", async (c) => {
    return billingCatalogRoute(c, { authenticate, readRequiredSecret });
  })

  .post("/v1/billing/checkout", async (c) => {
    return billingCheckoutRoute(c, { authenticate, readRequiredSecret });
  })

  .post("/v1/billing/portal", async (c) => {
    return billingPortalRoute(c, { authenticate, readRequiredSecret });
  })

  .get("/v1/billing/state", async (c) => {
    return billingStateRoute(c, { authenticate, readRequiredSecret });
  })

  .post("/v1/billing/cancel", async (c) => {
    return billingCancelRoute(c, { authenticate, readRequiredSecret });
  })

  .post("/v1/billing/reactivate", async (c) => {
    return billingReactivateRoute(c, { authenticate, readRequiredSecret });
  })

  .post("/v1/threads/:threadId/runs", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    const rateLimitHeaders = await rateLimit(c, userId, "POST /v1/threads/:threadId/runs");
    await requireVerifiedClerkEmail(c.req.raw, c.env);
    const prepared = await prepareIdempotentRunRequest(c.env, c.req.raw, userId);
    if (prepared.replay) {
      return withRateLimitHeaders(prepared.replay, rateLimitHeaders);
    }
    const forwarded = new Request(c.req.raw.url, {
      body: prepared.body,
      headers: c.req.raw.headers,
      method: c.req.raw.method,
    });
    forwarded.headers.set("X-Cheatcode-User-Id", userId);
    const response = await c.env.AGENT.fetch(forwarded);
    c.executionCtx.waitUntil(completeIdempotentRunRequest(c.env, userId, prepared.key, response));
    return withRateLimitHeaders(response, rateLimitHeaders);
  })

  .get("/v1/threads/:threadId/runs/stream", async (c) => {
    return forwardAgentRequest(c, "GET /v1/threads/:threadId/runs/stream");
  })

  .get("/v1/threads/:threadId/runs/status", async (c) => {
    return forwardAgentRequest(c, "GET /v1/threads/:threadId/runs/status");
  })

  .post("/v1/runs/:runId/cancel", async (c) => {
    return forwardAgentRequest(c, "POST /v1/runs/:runId/cancel");
  })

  .post("/v1/runs/:runId/takeover", async (c) => {
    return forwardAgentRequest(c, "POST /v1/runs/:runId/takeover");
  })

  .post("/v1/runs/:runId/resume", async (c) => {
    return forwardAgentRequest(c, "POST /v1/runs/:runId/resume");
  })

  .post("/v1/runs/:runId/approvals/:approvalId", async (c) => {
    return decideRunApprovalRoute(c);
  })

  .get("/v1/threads/:threadId/sandbox/files", async (c) => {
    return forwardAgentRequest(c, "GET /v1/threads/:threadId/sandbox/files");
  })

  .get("/v1/threads/:threadId/sandbox/ide", async (c) => {
    return forwardAgentRequest(c, "GET /v1/threads/:threadId/sandbox/ide");
  })

  .post("/v1/threads/:threadId/sandbox/preview/wake", async (c) => {
    return forwardAgentRequest(c, "POST /v1/threads/:threadId/sandbox/preview/wake");
  })

  .get("/v1/threads/:threadId/sandbox/preview/status", async (c) => {
    return forwardAgentRequest(c, "GET /v1/threads/:threadId/sandbox/preview/status");
  })

  .get("/v1/threads/:threadId/sandbox/file", async (c) => {
    return forwardAgentRequest(c, "GET /v1/threads/:threadId/sandbox/file");
  })

  .get("/v1/threads/:threadId/sandbox/file-preview", async (c) => {
    return forwardAgentRequest(c, "GET /v1/threads/:threadId/sandbox/file-preview");
  })

  .patch("/v1/threads/:threadId/sandbox/file", async (c) => {
    return forwardAgentRequest(c, "PATCH /v1/threads/:threadId/sandbox/file");
  })

  .get("/v1/threads/:threadId/sandbox/files/:fileKey", async (c) => {
    return forwardAgentRequest(c, "GET /v1/threads/:threadId/sandbox/files/:fileKey");
  })

  .patch("/v1/threads/:threadId/sandbox/files/:fileKey", async (c) => {
    return forwardAgentRequest(c, "PATCH /v1/threads/:threadId/sandbox/files/:fileKey");
  })

  .get("/v1/threads/:threadId/sandbox/terminal/context", async (c) => {
    return forwardAgentRequest(c, "GET /v1/threads/:threadId/sandbox/terminal/context");
  })

  .post("/v1/threads/:threadId/sandbox/terminal", async (c) => {
    return forwardAgentRequest(c, "POST /v1/threads/:threadId/sandbox/terminal");
  })

  .get("/v1/threads/:threadId/sandbox/console", async (c) => {
    return readSandboxConsoleRoute(c);
  });

export type GatewayAppType = typeof gatewayRoutes;

async function optionalTelemetryUser(
  request: Request,
  env: GatewayEnv,
  ctx: ExecutionContext,
): Promise<UserId | "anonymous"> {
  if (!request.headers.has("Authorization")) {
    return "anonymous";
  }
  try {
    return await authenticate(request, env, ctx);
  } catch {
    return "anonymous";
  }
}

function routeName(request: Request): string {
  const url = new URL(request.url);
  return `${request.method} ${url.pathname}`;
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

const gatewayHandler = {
  async fetch(request: Request, env: GatewayEnv, ctx: ExecutionContext): Promise<Response> {
    const id = requestId();
    const logger = createLogger({ requestId: id });
    try {
      GatewayWorkerEnvSchema.parse(env);
      const originalLocalPreviewHost = resolveLocalSandboxPreviewHost(request);
      const requestWithId = isWebSocketUpgrade(request) ? request : new Request(request);
      if (!isWebSocketUpgrade(requestWithId)) {
        requestWithId.headers.set("X-Request-Id", id);
      }
      if (isWebSocketUpgrade(request)) {
        const originRequest = localPreviewOriginRequest(request);
        if (originRequest) {
          return await proxyLocalPreviewWebSocket(request, env, originRequest);
        }
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
      const response = await gatewayApp.fetch(requestWithId, env, ctx);
      return withRequestId(response, id);
    } catch (error) {
      const apiError = toAPIError(error);
      emitErrorEvent(env, {
        errorCategory: "gateway",
        errorCode: apiError.code,
        httpStatus: apiError.status,
        route: routeName(request),
        workerName: "gateway",
        ...errorEventDetails(error),
      });
      logger.error("gateway_request_failed", { code: apiError.code, ...errorLogFields(error) });
      return apiError.toResponse(id);
    }
  },
};

async function proxyLocalPreviewWebSocket(
  request: Request,
  env: GatewayEnv,
  originRequest: {
    clientHost: string;
    cookie?: string;
    host: string;
    origin?: string;
    referer?: string;
    url: string;
  },
): Promise<Response> {
  const headers = new Headers({
    "X-Cheatcode-Local-Preview-Client-Host": originRequest.clientHost,
    "X-Cheatcode-Local-Preview-Host": originRequest.host,
    "X-Cheatcode-Local-Preview-Url": originRequest.url,
  });
  if (originRequest.cookie) {
    headers.set("X-Cheatcode-Local-Preview-Cookie", originRequest.cookie);
  }
  if (originRequest.origin) {
    headers.set("Origin", originRequest.origin);
  }
  if (originRequest.referer) {
    headers.set("Referer", originRequest.referer);
  }
  const originResponse = await env.AGENT.fetch(
    new Request("http://agent.internal/__internal/local-preview-origin", { headers }),
  );
  if (!originResponse.ok) {
    return originResponse;
  }
  const origin = LocalPreviewOriginResponseSchema.parse(await originResponse.json());
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
  const response = await fetch(websocketRequest);
  if (response.webSocket) {
    return new Response(null, { status: 101, webSocket: response.webSocket });
  }
  return response;
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
