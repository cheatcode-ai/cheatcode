import { verifyInternalMaintenanceRequest } from "@cheatcode/auth";
import {
  APIError,
  readBoundedRequestText,
  readBoundedResponseJson,
} from "@cheatcode/observability";
import {
  InternalGatewayStateDeleteBodySchema,
  InternalStateDeleteResponseSchema,
  UserId as toUserId,
  type UserId,
} from "@cheatcode/types";
import { z } from "zod";
import { agentServiceRequest } from "./agent-forwarding";
import { authenticate, readRequiredSecret } from "./authenticate";
import type { GatewayApp, GatewayEnv } from "./gateway-env";
import { OPENAPI_DOCUMENT, openApiDocsHtml } from "./openapi";
import { rateLimit, rateLimitPublic, withRateLimitHeaders } from "./rate-limit";
import { createUserSkillRoute, deleteUserSkillRoute, listUserSkillsRoute } from "./skills-routes";
import { clientErrorRoute, clientUserEventRoute, vitalsRoute } from "./telemetry-routes";
import type { WaitUntilContext } from "./wait-until-context";

const InternalMaintenanceUserIdSchema = z.string().uuid();
const MAX_AGENT_HEALTH_RESPONSE_BYTES = 16 * 1024;
const MAX_INTERNAL_MAINTENANCE_BODY_BYTES = 1024;
const AgentHealthSchema = z
  .object({
    ok: z.literal(true),
    releaseSha: z.string().min(1),
    versionId: z.string().min(1).nullable(),
    worker: z.literal("agent"),
  })
  .strict();

export function registerCoreHttpRoutes(app: GatewayApp): void {
  registerHealthRoute(app);
  registerMaintenanceRoute(app);
  registerDiscoveryRoutes(app);
  registerTelemetryRoutes(app);
  registerOutputRoute(app);
  registerSkillRoutes(app);
}

function registerHealthRoute(app: GatewayApp): void {
  app.get("/health", async (c) => {
    const headers = await rateLimitPublic(c, "GET /health", "publicRead");
    const releaseSha = c.env.CHEATCODE_RELEASE_SHA ?? "development";
    const agent = await readAgentHealth(c.env);
    if (agent.releaseSha !== releaseSha) {
      throw new APIError(503, "unavailable_maintenance", "Release is still converging", {
        details: { agentReleaseSha: agent.releaseSha, gatewayReleaseSha: releaseSha },
        retriable: true,
      });
    }
    return withRateLimitHeaders(
      c.json({
        agent,
        ok: true,
        releaseSha,
        versionId: c.env.CF_VERSION_METADATA?.id ?? null,
      }),
      headers,
    );
  });
}

function registerMaintenanceRoute(app: GatewayApp): void {
  app.post("/internal/users/:userId/delete-state", async (c) => {
    const rawBody = await readBoundedRequestText(
      c.req.raw,
      MAX_INTERNAL_MAINTENANCE_BODY_BYTES,
      "Internal maintenance request",
    );
    const secret = await readRequiredSecret(
      c.env.INTERNAL_MAINTENANCE_SECRET,
      "INTERNAL_MAINTENANCE_SECRET",
    );
    await verifyInternalMaintenanceRequest({ rawBody, request: c.req.raw, secret });
    InternalGatewayStateDeleteBodySchema.parse(parseMaintenanceJson(rawBody));
    const userId = toUserId(InternalMaintenanceUserIdSchema.parse(c.req.param("userId")));
    const quotaTracker = c.env.QUOTA_TRACKER.get(c.env.QUOTA_TRACKER.idFromName(`quota:${userId}`));
    const response = await quotaTracker.fetch("https://quota.internal/delete-all", {
      method: "POST",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new APIError(503, "unavailable_maintenance", "Quota durable state deletion failed", {
        details: { status: response.status },
        retriable: true,
      });
    }
    await response.body?.cancel().catch(() => undefined);
    return c.json(InternalStateDeleteResponseSchema.parse({ ok: true }));
  });
}

function registerDiscoveryRoutes(app: GatewayApp): void {
  app.get("/openapi.json", async (c) => {
    const headers = await rateLimitPublic(c, "GET /openapi.json", "publicRead");
    return withRateLimitHeaders(
      new Response(JSON.stringify(OPENAPI_DOCUMENT), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      }),
      headers,
    );
  });
  app.get("/docs", async (c) => {
    await rateLimitPublic(c, "GET /docs", "publicRead");
    return c.html(openApiDocsHtml());
  });
}

function registerTelemetryRoutes(app: GatewayApp): void {
  app.post("/v1/client-error", async (c) => {
    await rateLimitPublic(c, "POST /v1/client-error", "publicWrite");
    return clientErrorRoute(c, optionalTelemetryUser);
  });
  app.post("/v1/vitals", async (c) => {
    await rateLimitPublic(c, "POST /v1/vitals", "publicWrite");
    return vitalsRoute(c);
  });
  app.post("/v1/user-events", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/user-events");
    return clientUserEventRoute(c, async () => userId);
  });
}

function registerOutputRoute(app: GatewayApp): void {
  app.get("/v1/outputs/:outputId/download", async (c) => {
    const headers = await rateLimitPublic(c, "GET /v1/outputs/:outputId/download", "publicRead");
    return withRateLimitHeaders(await c.env.AGENT.fetch(agentServiceRequest(c.req.raw)), headers);
  });
}

async function readAgentHealth(env: GatewayEnv): Promise<z.infer<typeof AgentHealthSchema>> {
  let response: Response;
  try {
    response = await env.AGENT.fetch(
      new Request("https://agent.internal/health", { signal: AbortSignal.timeout(3_000) }),
    );
  } catch {
    throw new APIError(503, "unavailable_maintenance", "Agent service is unavailable", {
      retriable: true,
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new APIError(503, "unavailable_maintenance", "Agent service is unhealthy", {
      details: { status: response.status },
      retriable: true,
    });
  }
  try {
    return AgentHealthSchema.parse(
      await readBoundedResponseJson(response, MAX_AGENT_HEALTH_RESPONSE_BYTES, "Agent health"),
    );
  } catch {
    throw new APIError(503, "unavailable_maintenance", "Agent health response is invalid", {
      retriable: true,
    });
  }
}

function registerSkillRoutes(app: GatewayApp): void {
  app.get("/v1/skills", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "GET /v1/skills");
    return listUserSkillsRoute(c.env, c.executionCtx, userId);
  });
  app.post("/v1/skills", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "POST /v1/skills");
    return createUserSkillRoute(c.env, c.executionCtx, c.req.raw, userId);
  });
  app.delete("/v1/skills/:skillId", async (c) => {
    const userId = await authenticate(c.req.raw, c.env, c.executionCtx);
    await rateLimit(c, userId, "DELETE /v1/skills/:skillId");
    return deleteUserSkillRoute(c.env, c.executionCtx, userId, c.req.param("skillId"));
  });
}

async function optionalTelemetryUser(
  request: Request,
  env: GatewayEnv,
  ctx: WaitUntilContext,
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

function parseMaintenanceJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new APIError(400, "invalid_request_body", "Internal maintenance body must be JSON", {
      retriable: false,
    });
  }
}
